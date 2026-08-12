import type { BridgeOperationId, IsoTimestamp, PolicyDecision } from "./model.js";
import type { DurableBridgeOperation, DurableTransactionEngine, TransactionStore } from "./transaction-engine.js";
import type { SqlExecutor } from "./transaction-engine.js";
import type { VerifiedThresholdAttestation } from "./lock-mint-coordinator.js";
import { RegistryError } from "./registry-errors.js";

export type BurnReleaseStage = "SOURCE_BURN" | "SOURCE_CONFIRMATION" | "SOURCE_FINALITY" | "ATTESTATION" | "DESTINATION_RELEASE" | "DESTINATION_CONFIRMATION" | "DESTINATION_FINALITY" | "RECONCILIATION";
export interface BurnReleaseStageEvidence { operationId: BridgeOperationId; stage: BurnReleaseStage; recordedAt: IsoTimestamp; data: Readonly<Record<string, string | boolean>> }
export interface BurnReleaseEvidenceStore { get(operationId: BridgeOperationId, stage: BurnReleaseStage): Promise<BurnReleaseStageEvidence | undefined>; put(evidence: BurnReleaseStageEvidence): Promise<BurnReleaseStageEvidence> }
export interface BurnReleasePolicyService { evaluate(operation: DurableBridgeOperation): Promise<PolicyDecision> }
export interface EvmBurnService {
  burn(operation: DurableBridgeOperation): Promise<{ transactionId: string; outcome: "EXECUTED" | "ALREADY_PROCESSED" }>;
  confirm(operation: DurableBridgeOperation, transactionId: string): Promise<{ confirmed: boolean; blockNumber: string }>;
  finalize(operation: DurableBridgeOperation, transactionId: string): Promise<{ finalized: boolean; position: string; evidenceId: string }>;
}
export interface BurnReleaseAttestationService { attest(operation: DurableBridgeOperation, sourceFinality: BurnReleaseStageEvidence): Promise<{ satisfied: boolean; attestation: VerifiedThresholdAttestation }> }
export interface CantonReleaseService {
  release(operation: DurableBridgeOperation, attestation: VerifiedThresholdAttestation): Promise<{ transactionId: string; authorizationId: string; outcome: "EXECUTED" | "ALREADY_PROCESSED" }>;
  confirm(operation: DurableBridgeOperation, transactionId: string): Promise<{ confirmed: boolean; position: string }>;
  finalize(operation: DurableBridgeOperation, transactionId: string): Promise<{ finalized: boolean; position: string; evidenceId: string }>;
}
export interface BurnReleaseReconciliationService { reconcile(operation: DurableBridgeOperation): Promise<{ matched: boolean; sourceBacking: string; destinationSupply: string; releasedAmount: string; evidenceId: string }> }
export interface BurnReleaseCoordinatorDependencies {
  transactions: DurableTransactionEngine; transactionStore: TransactionStore; evidence: BurnReleaseEvidenceStore;
  policy: BurnReleasePolicyService; source: EvmBurnService; attestations: BurnReleaseAttestationService;
  destination: CantonReleaseService; reconciliation: BurnReleaseReconciliationService; now: () => Date; actor?: string;
}

export class EvmToCantonBurnReleaseCoordinator {
  readonly actor: string;
  constructor(readonly dependencies: BurnReleaseCoordinatorDependencies) { this.actor = dependencies.actor ?? "burn-release-coordinator"; }
  async run(operationId: BridgeOperationId): Promise<DurableBridgeOperation> {
    let operation = await this.#operation(operationId);
    for (let guard = 0; guard < 24 && operation.state !== "COMPLETED"; guard++) {
      if (!isTerminal(operation.state) && this.dependencies.now().getTime() >= Date.parse(operation.expiresAt)) { operation = await this.#transition(operation, "EXPIRED", "bridge operation expired before completion"); continue; }
      switch (operation.state) {
        case "CREATED": { const decision = await this.dependencies.policy.evaluate(operation); operation = await this.#transition(operation, decision.outcome === "ALLOW" ? "POLICY_CHECKED" : "POLICY_REJECTED", "policy evaluated", decision); break; }
        case "POLICY_CHECKED": operation = await this.#transition(operation, "SOURCE_PREPARING", "prepare replay-protected EVM burn"); break;
        case "SOURCE_PREPARING": {
          const evidence = await this.#evidence(operation, "SOURCE_BURN", async () => { const result = await this.dependencies.source.burn(operation); requireText(result.transactionId, "burn transaction ID"); return result; });
          operation = await this.#transition(operation, "SOURCE_SUBMITTED", `EVM burn ${evidence.data.outcome}`); break;
        }
        case "SOURCE_SUBMITTED": {
          const source = await this.#required(operation.id, "SOURCE_BURN"); const evidence = await this.#evidence(operation, "SOURCE_CONFIRMATION", async () => { const result = await this.dependencies.source.confirm(operation, text(source, "transactionId")); requireText(result.blockNumber, "burn confirmation block"); return result; });
          operation = await this.#transition(operation, evidence.data.confirmed === true ? "SOURCE_CONFIRMED" : "SOURCE_FAILED", "EVM burn confirmation evaluated"); break;
        }
        case "SOURCE_CONFIRMED": {
          const source = await this.#required(operation.id, "SOURCE_BURN"); const evidence = await this.#evidence(operation, "SOURCE_FINALITY", async () => { const result = await this.dependencies.source.finalize(operation, text(source, "transactionId")); requireText(result.position, "burn finality position"); requireText(result.evidenceId, "burn finality evidence ID"); return result; });
          operation = await this.#transition(operation, evidence.data.finalized === true ? "SOURCE_FINALIZED" : "SOURCE_FAILED", "EVM burn finality evaluated"); break;
        }
        case "SOURCE_FINALIZED": operation = await this.#transition(operation, "ATTESTATION_PENDING", "request independent burn attestations"); break;
        case "ATTESTATION_PENDING": {
          const finality = await this.#required(operation.id, "SOURCE_FINALITY"); const evidence = await this.#evidence(operation, "ATTESTATION", async () => { const result = await this.dependencies.attestations.attest(operation, finality); return { satisfied: result.satisfied, digest: result.attestation.digest, validatorSetId: result.attestation.validatorSetId, signatureCount: result.attestation.signatureCount, threshold: result.attestation.threshold, expiresAt: result.attestation.expiresAt }; });
          operation = await this.#transition(operation, evidence.data.satisfied === true ? "ATTESTED" : "ATTESTATION_FAILED", "threshold burn attestation evaluated"); break;
        }
        case "ATTESTED": operation = await this.#transition(operation, "DESTINATION_PREPARING", "prepare one-time Canton release"); break;
        case "DESTINATION_PREPARING": {
          const attestation = attestationFrom(await this.#required(operation.id, "ATTESTATION"));
          if (this.dependencies.now().getTime() >= Date.parse(attestation.expiresAt)) { operation = await this.#transition(operation, "DESTINATION_FAILED", "threshold attestation expired before release"); break; }
          const evidence = await this.#evidence(operation, "DESTINATION_RELEASE", async () => { const result = await this.dependencies.destination.release(operation, attestation); requireText(result.transactionId, "Canton release transaction ID"); requireText(result.authorizationId, "Canton release authorization ID"); return result; });
          operation = await this.#transition(operation, "DESTINATION_SUBMITTED", `Canton release ${evidence.data.outcome}`); break;
        }
        case "DESTINATION_SUBMITTED": {
          const release = await this.#required(operation.id, "DESTINATION_RELEASE"); const evidence = await this.#evidence(operation, "DESTINATION_CONFIRMATION", async () => { const result = await this.dependencies.destination.confirm(operation, text(release, "transactionId")); requireText(result.position, "release confirmation position"); return result; });
          operation = await this.#transition(operation, evidence.data.confirmed === true ? "DESTINATION_CONFIRMED" : "DESTINATION_FAILED", "Canton release confirmation evaluated"); break;
        }
        case "DESTINATION_CONFIRMED": {
          const release = await this.#required(operation.id, "DESTINATION_RELEASE"); const evidence = await this.#evidence(operation, "DESTINATION_FINALITY", async () => { const result = await this.dependencies.destination.finalize(operation, text(release, "transactionId")); requireText(result.position, "release finality position"); requireText(result.evidenceId, "release finality evidence ID"); return result; });
          operation = await this.#transition(operation, evidence.data.finalized === true ? "DESTINATION_FINALIZED" : "DESTINATION_FAILED", "Canton release finality evaluated"); break;
        }
        case "DESTINATION_FINALIZED": operation = await this.#transition(operation, "RECONCILIATION_PENDING", "reconcile burn, release, backing, and supply"); break;
        case "RECONCILIATION_PENDING": {
          const evidence = await this.#evidence(operation, "RECONCILIATION", async () => { const result = await this.dependencies.reconciliation.reconcile(operation); requireText(result.evidenceId, "reconciliation evidence ID"); return result; });
          operation = await this.#transition(operation, evidence.data.matched === true ? "RECONCILED" : "RECONCILIATION_FAILED", "round-trip supply reconciliation evaluated"); break;
        }
        case "RECONCILED": operation = await this.#transition(operation, "COMPLETED", "burn-release operation completed"); break;
        default: return operation;
      }
    }
    if (operation.state !== "COMPLETED") throw new RegistryError("CONFLICT", `burn-release coordinator stopped in state: ${operation.state}`);
    return operation;
  }
  async #operation(id: BridgeOperationId) { const value = await this.dependencies.transactionStore.get(id); if (!value) throw new RegistryError("NOT_FOUND", `operation not found: ${id}`); return value; }
  #transition(operation: DurableBridgeOperation, to: Parameters<DurableTransactionEngine["transition"]>[0]["to"], reason: string, policyDecision?: PolicyDecision) { return this.dependencies.transactions.transition({ operationId: operation.id, transitionKey: `${operation.id}:${to}`, expectedVersion: operation.version, to, occurredAt: this.dependencies.now().toISOString(), reason, actor: this.actor, attempt: 1, ...(policyDecision ? { policyDecision } : {}) }); }
  async #evidence(operation: DurableBridgeOperation, stage: BurnReleaseStage, produce: () => Promise<Readonly<Record<string, string | boolean>>>) { const existing = await this.dependencies.evidence.get(operation.id, stage); if (existing) return existing; return this.dependencies.evidence.put({ operationId: operation.id, stage, recordedAt: this.dependencies.now().toISOString(), data: structuredClone(await produce()) }); }
  async #required(operationId: BridgeOperationId, stage: BurnReleaseStage) { const value = await this.dependencies.evidence.get(operationId, stage); if (!value) throw new RegistryError("NOT_FOUND", `missing durable stage evidence: ${stage}`); return value; }
}

function requireText(value: string, name: string) { if (!value.trim()) throw new RegistryError("INVALID_ARGUMENT", `${name} is required`); }
function text(evidence: BurnReleaseStageEvidence, key: string) { const value = evidence.data[key]; if (typeof value !== "string" || !value.trim()) throw new RegistryError("INVALID_ARGUMENT", `invalid ${evidence.stage} evidence: ${key}`); return value; }
function attestationFrom(evidence: BurnReleaseStageEvidence): VerifiedThresholdAttestation { return { digest: text(evidence, "digest"), validatorSetId: text(evidence, "validatorSetId"), signatureCount: text(evidence, "signatureCount"), threshold: text(evidence, "threshold"), expiresAt: text(evidence, "expiresAt") }; }
function isTerminal(state: DurableBridgeOperation["state"]) { return ["COMPLETED", "POLICY_REJECTED", "SOURCE_FAILED", "ATTESTATION_FAILED", "DESTINATION_FAILED", "EXPIRED", "RECONCILIATION_FAILED", "MANUAL_REVIEW"].includes(state); }

type EvidenceRow = { evidence: BurnReleaseStageEvidence };
export class PostgresBurnReleaseEvidenceStore implements BurnReleaseEvidenceStore {
  constructor(readonly db: SqlExecutor) {}
  async get(operationId: BridgeOperationId, stage: BurnReleaseStage) { const result = await this.db.query<EvidenceRow>("SELECT evidence FROM bridge_stage_evidence WHERE operation_id=$1 AND stage=$2", [operationId, stage]); const value = result.rows[0]?.evidence; return value ? structuredClone(value) : undefined; }
  async put(evidence: BurnReleaseStageEvidence) { const result = await this.db.query<EvidenceRow>("INSERT INTO bridge_stage_evidence (operation_id,stage,evidence) VALUES ($1,$2,$3::jsonb) ON CONFLICT (operation_id,stage) DO UPDATE SET stage=EXCLUDED.stage WHERE bridge_stage_evidence.evidence=EXCLUDED.evidence RETURNING evidence", [evidence.operationId, evidence.stage, JSON.stringify(evidence)]); const stored = result.rows[0]?.evidence; if (!stored) throw new RegistryError("CONFLICT", `stage evidence differs from immutable record: ${evidence.stage}`); return structuredClone(stored); }
}
