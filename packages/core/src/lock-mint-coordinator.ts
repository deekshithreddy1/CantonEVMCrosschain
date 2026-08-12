import type { BridgeOperationId, IsoTimestamp, PolicyDecision } from "./model.js";
import type { DurableBridgeOperation, DurableTransactionEngine, TransactionStore } from "./transaction-engine.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { RegistryError } from "./registry-errors.js";

export type LockMintStage = "SOURCE_LOCK" | "SOURCE_CONFIRMATION" | "SOURCE_FINALITY" | "ATTESTATION" | "DESTINATION_MINT" | "DESTINATION_CONFIRMATION" | "DESTINATION_FINALITY" | "RECONCILIATION";
export interface LockMintStageEvidence { operationId: BridgeOperationId; stage: LockMintStage; recordedAt: IsoTimestamp; data: Readonly<Record<string, string | boolean>> }
export interface LockMintEvidenceStore {
  get(operationId: BridgeOperationId, stage: LockMintStage): Promise<LockMintStageEvidence | undefined>;
  put(evidence: LockMintStageEvidence): Promise<LockMintStageEvidence>;
}
export interface LockMintPolicyService { evaluate(operation: DurableBridgeOperation): Promise<PolicyDecision> }
export interface CantonLockService {
  lock(operation: DurableBridgeOperation): Promise<{ transactionId: string; lockId: string }>;
  confirm(operation: DurableBridgeOperation, transactionId: string): Promise<{ confirmed: boolean; position: string }>;
  finalize(operation: DurableBridgeOperation, transactionId: string): Promise<{ finalized: boolean; position: string; evidenceId: string }>;
}
export interface VerifiedThresholdAttestation { digest: string; validatorSetId: string; signatureCount: string; threshold: string; expiresAt: IsoTimestamp }
export interface LockMintAttestationService { attest(operation: DurableBridgeOperation, sourceFinality: LockMintStageEvidence): Promise<{ satisfied: boolean; attestation: VerifiedThresholdAttestation }> }
export interface EvmMintService {
  mint(operation: DurableBridgeOperation, attestation: VerifiedThresholdAttestation): Promise<{ transactionId: string; outcome: "EXECUTED" | "ALREADY_PROCESSED" }>;
  confirm(operation: DurableBridgeOperation, transactionId: string): Promise<{ confirmed: boolean; blockNumber: string }>;
  finalize(operation: DurableBridgeOperation, transactionId: string): Promise<{ finalized: boolean; position: string; evidenceId: string }>;
}
export interface LockMintReconciliationService { reconcile(operation: DurableBridgeOperation): Promise<{ matched: boolean; sourceLocked: string; destinationSupply: string; evidenceId: string }> }

export interface LockMintCoordinatorDependencies {
  transactions: DurableTransactionEngine; transactionStore: TransactionStore; evidence: LockMintEvidenceStore;
  policy: LockMintPolicyService; source: CantonLockService; attestations: LockMintAttestationService;
  destination: EvmMintService; reconciliation: LockMintReconciliationService; now: () => Date; actor?: string;
}

export class CantonToEvmLockMintCoordinator {
  readonly actor: string;
  constructor(readonly dependencies: LockMintCoordinatorDependencies) { this.actor = dependencies.actor ?? "lock-mint-coordinator"; }

  async run(operationId: BridgeOperationId): Promise<DurableBridgeOperation> {
    let operation = await this.#operation(operationId);
    for (let guard = 0; guard < 24 && operation.state !== "COMPLETED"; guard++) {
      if (!isTerminal(operation.state) && this.dependencies.now().getTime() >= Date.parse(operation.expiresAt)) {
        operation = await this.#transition(operation, "EXPIRED", "bridge operation expired before completion");
        continue;
      }
      switch (operation.state) {
        case "CREATED": {
          const decision = await this.dependencies.policy.evaluate(operation);
          operation = await this.#transition(operation, decision.outcome === "ALLOW" ? "POLICY_CHECKED" : "POLICY_REJECTED", "policy evaluated", decision);
          break;
        }
        case "POLICY_CHECKED": operation = await this.#transition(operation, "SOURCE_PREPARING", "prepare Canton lock"); break;
        case "SOURCE_PREPARING": {
          const evidence = await this.#evidence(operation, "SOURCE_LOCK", async () => {
            const result = await this.dependencies.source.lock(operation); requireText(result.transactionId, "source transaction ID"); requireText(result.lockId, "Canton lock ID");
            return { transactionId: result.transactionId, lockId: result.lockId };
          });
          operation = await this.#transition(operation, "SOURCE_SUBMITTED", `Canton lock submitted: ${evidence.data.transactionId}`); break;
        }
        case "SOURCE_SUBMITTED": {
          const source = await this.#requiredEvidence(operation.id, "SOURCE_LOCK");
          const evidence = await this.#evidence(operation, "SOURCE_CONFIRMATION", async () => { const result = await this.dependencies.source.confirm(operation, stringValue(source, "transactionId")); requireText(result.position, "source confirmation position"); return result; });
          operation = await this.#transition(operation, evidence.data.confirmed === true ? "SOURCE_CONFIRMED" : "SOURCE_FAILED", "Canton lock confirmation evaluated"); break;
        }
        case "SOURCE_CONFIRMED": {
          const source = await this.#requiredEvidence(operation.id, "SOURCE_LOCK");
          const evidence = await this.#evidence(operation, "SOURCE_FINALITY", async () => { const result = await this.dependencies.source.finalize(operation, stringValue(source, "transactionId")); requireText(result.position, "source finality position"); requireText(result.evidenceId, "source finality evidence ID"); return result; });
          operation = await this.#transition(operation, evidence.data.finalized === true ? "SOURCE_FINALIZED" : "SOURCE_FAILED", "Canton finality evaluated"); break;
        }
        case "SOURCE_FINALIZED": operation = await this.#transition(operation, "ATTESTATION_PENDING", "request independent validator attestations"); break;
        case "ATTESTATION_PENDING": {
          const finality = await this.#requiredEvidence(operation.id, "SOURCE_FINALITY");
          const evidence = await this.#evidence(operation, "ATTESTATION", async () => {
            const result = await this.dependencies.attestations.attest(operation, finality);
            return { satisfied: result.satisfied, digest: result.attestation.digest, validatorSetId: result.attestation.validatorSetId, signatureCount: result.attestation.signatureCount, threshold: result.attestation.threshold, expiresAt: result.attestation.expiresAt };
          });
          operation = await this.#transition(operation, evidence.data.satisfied === true ? "ATTESTED" : "ATTESTATION_FAILED", "threshold attestation evaluated"); break;
        }
        case "ATTESTED": operation = await this.#transition(operation, "DESTINATION_PREPARING", "prepare replay-protected EVM mint"); break;
        case "DESTINATION_PREPARING": {
          const attestation = attestationFrom(await this.#requiredEvidence(operation.id, "ATTESTATION"));
          if (this.dependencies.now().getTime() >= Date.parse(attestation.expiresAt)) { operation = await this.#transition(operation, "DESTINATION_FAILED", "threshold attestation expired before mint"); break; }
          const evidence = await this.#evidence(operation, "DESTINATION_MINT", async () => this.dependencies.destination.mint(operation, attestation));
          operation = await this.#transition(operation, "DESTINATION_SUBMITTED", `EVM mint ${evidence.data.outcome}`); break;
        }
        case "DESTINATION_SUBMITTED": {
          const mint = await this.#requiredEvidence(operation.id, "DESTINATION_MINT");
          const evidence = await this.#evidence(operation, "DESTINATION_CONFIRMATION", async () => { const result = await this.dependencies.destination.confirm(operation, stringValue(mint, "transactionId")); requireText(result.blockNumber, "destination confirmation block"); return result; });
          operation = await this.#transition(operation, evidence.data.confirmed === true ? "DESTINATION_CONFIRMED" : "DESTINATION_FAILED", "EVM mint confirmation evaluated"); break;
        }
        case "DESTINATION_CONFIRMED": {
          const mint = await this.#requiredEvidence(operation.id, "DESTINATION_MINT");
          const evidence = await this.#evidence(operation, "DESTINATION_FINALITY", async () => { const result = await this.dependencies.destination.finalize(operation, stringValue(mint, "transactionId")); requireText(result.position, "destination finality position"); requireText(result.evidenceId, "destination finality evidence ID"); return result; });
          operation = await this.#transition(operation, evidence.data.finalized === true ? "DESTINATION_FINALIZED" : "DESTINATION_FAILED", "EVM mint finality evaluated"); break;
        }
        case "DESTINATION_FINALIZED": operation = await this.#transition(operation, "RECONCILIATION_PENDING", "reconcile backing and representation supply"); break;
        case "RECONCILIATION_PENDING": {
          const evidence = await this.#evidence(operation, "RECONCILIATION", async () => this.dependencies.reconciliation.reconcile(operation));
          operation = await this.#transition(operation, evidence.data.matched === true ? "RECONCILED" : "RECONCILIATION_FAILED", "supply reconciliation evaluated"); break;
        }
        case "RECONCILED": operation = await this.#transition(operation, "COMPLETED", "lock-mint operation completed"); break;
        default: return operation;
      }
    }
    if (operation.state !== "COMPLETED") throw new RegistryError("CONFLICT", `lock-mint coordinator stopped in state: ${operation.state}`);
    return operation;
  }

  async #operation(id: BridgeOperationId) { const value = await this.dependencies.transactionStore.get(id); if (!value) throw new RegistryError("NOT_FOUND", `operation not found: ${id}`); return value; }
  #transition(operation: DurableBridgeOperation, to: Parameters<DurableTransactionEngine["transition"]>[0]["to"], reason: string, policyDecision?: PolicyDecision) {
    return this.dependencies.transactions.transition({ operationId: operation.id, transitionKey: `${operation.id}:${to}`, expectedVersion: operation.version, to, occurredAt: this.dependencies.now().toISOString(), reason, actor: this.actor, attempt: 1, ...(policyDecision ? { policyDecision } : {}) });
  }
  async #evidence(operation: DurableBridgeOperation, stage: LockMintStage, produce: () => Promise<Readonly<Record<string, string | boolean>>>): Promise<LockMintStageEvidence> {
    const existing = await this.dependencies.evidence.get(operation.id, stage); if (existing) return existing;
    const data = await produce(); return this.dependencies.evidence.put({ operationId: operation.id, stage, recordedAt: this.dependencies.now().toISOString(), data: structuredClone(data) });
  }
  async #requiredEvidence(operationId: BridgeOperationId, stage: LockMintStage) { const value = await this.dependencies.evidence.get(operationId, stage); if (!value) throw new RegistryError("NOT_FOUND", `missing durable stage evidence: ${stage}`); return value; }
}

function requireText(value: string, name: string) { if (!value.trim()) throw new RegistryError("INVALID_ARGUMENT", `${name} is required`); }
function isTerminal(state: DurableBridgeOperation["state"]) { return ["COMPLETED", "POLICY_REJECTED", "SOURCE_FAILED", "ATTESTATION_FAILED", "DESTINATION_FAILED", "EXPIRED", "RECONCILIATION_FAILED", "MANUAL_REVIEW"].includes(state); }
function stringValue(evidence: LockMintStageEvidence, key: string): string { const value = evidence.data[key]; if (typeof value !== "string" || !value.trim()) throw new RegistryError("INVALID_ARGUMENT", `invalid ${evidence.stage} evidence: ${key}`); return value; }
function attestationFrom(evidence: LockMintStageEvidence): VerifiedThresholdAttestation { return { digest: stringValue(evidence, "digest"), validatorSetId: stringValue(evidence, "validatorSetId"), signatureCount: stringValue(evidence, "signatureCount"), threshold: stringValue(evidence, "threshold"), expiresAt: stringValue(evidence, "expiresAt") }; }

type EvidenceRow = { evidence: LockMintStageEvidence };
export class PostgresLockMintEvidenceStore implements LockMintEvidenceStore {
  constructor(readonly db: SqlExecutor) {}
  async get(operationId: BridgeOperationId, stage: LockMintStage): Promise<LockMintStageEvidence | undefined> { const result = await this.db.query<EvidenceRow>("SELECT evidence FROM bridge_stage_evidence WHERE operation_id=$1 AND stage=$2", [operationId, stage]); const value = result.rows[0]?.evidence; return value ? structuredClone(value) : undefined; }
  async put(evidence: LockMintStageEvidence): Promise<LockMintStageEvidence> {
    const result = await this.db.query<EvidenceRow>("INSERT INTO bridge_stage_evidence (operation_id,stage,evidence) VALUES ($1,$2,$3::jsonb) ON CONFLICT (operation_id,stage) DO UPDATE SET stage=EXCLUDED.stage WHERE bridge_stage_evidence.evidence=EXCLUDED.evidence RETURNING evidence", [evidence.operationId, evidence.stage, JSON.stringify(evidence)]);
    const stored = result.rows[0]?.evidence; if (!stored) throw new RegistryError("CONFLICT", `stage evidence differs from immutable record: ${evidence.stage}`); return structuredClone(stored);
  }
}
