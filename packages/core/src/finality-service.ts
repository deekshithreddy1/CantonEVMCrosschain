import type { FinalityPolicy, IsoTimestamp, NetworkId, NetworkType } from "./model.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { RegistryError } from "./registry-errors.js";

export type FinalityAssessmentId = `IW:FINALITY:${string}`;
export interface EvmFinalityObservation {
  kind: "EVM"; networkId: NetworkId; chainId: string; transactionId: string; receiptStatus: "SUCCESS" | "REVERTED";
  transactionBlockNumber: string; transactionBlockHash: string; canonicalBlockHash: string; observedHead: string;
  confirmations: number; includedInFinalizedChain: boolean; finalizedBlockNumber?: string; finalizedBlockHash?: string;
  provider: string; observedAt: IsoTimestamp;
}
export interface CantonFinalityObservation {
  kind: "CANTON"; networkId: NetworkId; transactionId: string; status: "COMMITTED" | "REJECTED" | "UNKNOWN";
  completionOffset?: string; updateId?: string; synchronizerId?: string; participantId: string;
  partyScope: readonly string[]; observedAt: IsoTimestamp;
}
export type NetworkFinalityObservation = EvmFinalityObservation | CantonFinalityObservation;
export interface FinalityNetworkConfiguration { networkId: NetworkId; networkType: NetworkType; chainId?: string; policy: FinalityPolicy; enabled: boolean }
export type FinalityOutcome = "SATISFIED" | "PENDING" | "REJECTED" | "UNCERTAIN";
export interface FinalityAssessment {
  id: FinalityAssessmentId; networkId: NetworkId; networkType: NetworkType; transactionId: string;
  policy: FinalityPolicy; outcome: FinalityOutcome; reasonCodes: readonly string[];
  observedPosition: string; evidence: readonly string[]; observation: NetworkFinalityObservation; assessedAt: IsoTimestamp;
}
export interface FinalityAssessmentStore { save(assessment: FinalityAssessment): Promise<void>; get(id: FinalityAssessmentId): Promise<FinalityAssessment | undefined> }

export class FinalityService {
  readonly #networks: ReadonlyMap<NetworkId, FinalityNetworkConfiguration>;
  constructor(readonly store: FinalityAssessmentStore, networks: readonly FinalityNetworkConfiguration[], readonly now: () => Date = () => new Date()) {
    const configured = new Map<NetworkId, FinalityNetworkConfiguration>();
    for (const network of networks) { if (configured.has(network.networkId)) throw new RegistryError("CONFLICT", `duplicate finality network: ${network.networkId}`); configured.set(network.networkId, structuredClone(network)); }
    this.#networks = configured;
  }
  async assess(input: { id: FinalityAssessmentId; transactionId: string; observation: NetworkFinalityObservation }): Promise<FinalityAssessment> {
    const assessedAt = this.now().toISOString();
    const configuration = this.#networks.get(input.observation.networkId);
    if (!configuration) throw new RegistryError("NOT_FOUND", `finality network not configured: ${input.observation.networkId}`);
    assertCommon(input, configuration, assessedAt);
    const evaluated = !configuration.enabled ? evaluation("REJECTED", ["NETWORK_DISABLED"], "disabled", input.observation)
      : input.observation.kind === "EVM" ? evaluateEvm(configuration.policy, input.observation, configuration.chainId) : evaluateCanton(configuration.policy, input.observation);
    const assessment: FinalityAssessment = { id: input.id, networkId: input.observation.networkId, networkType: configuration.networkType, transactionId: input.transactionId, policy: structuredClone(configuration.policy), outcome: evaluated.outcome, reasonCodes: evaluated.reasonCodes, observedPosition: evaluated.observedPosition, evidence: evaluated.evidence, observation: structuredClone(input.observation), assessedAt };
    await this.store.save(assessment);
    return structuredClone(assessment);
  }
}

function evaluateEvm(policy: FinalityPolicy, observation: EvmFinalityObservation, expectedChainId?: string) {
  if (policy.kind !== "EVM_CONFIRMATIONS") return evaluation("REJECTED", ["POLICY_TYPE_MISMATCH"], observation.transactionBlockNumber, observation);
  if (!expectedChainId || observation.chainId !== expectedChainId) return evaluation("REJECTED", ["CHAIN_ID_MISMATCH"], observation.transactionBlockNumber, observation);
  if (observation.receiptStatus === "REVERTED") return evaluation("REJECTED", ["TRANSACTION_REVERTED"], observation.transactionBlockNumber, observation);
  if (observation.transactionBlockHash.toLowerCase() !== observation.canonicalBlockHash.toLowerCase()) return evaluation("UNCERTAIN", ["BLOCK_NOT_CANONICAL"], observation.transactionBlockNumber, observation);
  if (!Number.isSafeInteger(observation.confirmations) || observation.confirmations < 0) return evaluation("REJECTED", ["INVALID_CONFIRMATION_EVIDENCE"], observation.transactionBlockNumber, observation);
  const reasons: string[] = [];
  if (observation.confirmations < policy.confirmations) reasons.push("CONFIRMATIONS_PENDING");
  if (policy.requireFinalizedTag && (!observation.includedInFinalizedChain || !observation.finalizedBlockNumber || !observation.finalizedBlockHash)) reasons.push("FINALIZED_TAG_PENDING");
  const position = observation.includedInFinalizedChain && observation.finalizedBlockNumber ? `finalized:${observation.finalizedBlockNumber}` : `head:${observation.observedHead}`;
  return evaluation(reasons.length ? "PENDING" : "SATISFIED", reasons, position, observation);
}

function evaluateCanton(policy: FinalityPolicy, observation: CantonFinalityObservation) {
  if (policy.kind !== "CANTON_COMPLETION") return evaluation("REJECTED", ["POLICY_TYPE_MISMATCH"], observation.completionOffset ?? "unknown", observation);
  if (observation.partyScope.length === 0) return evaluation("REJECTED", ["PARTY_SCOPE_REQUIRED"], observation.completionOffset ?? "unknown", observation);
  if (observation.status === "REJECTED") return evaluation("REJECTED", ["COMMAND_REJECTED"], observation.completionOffset ?? "unknown", observation);
  if (observation.status === "UNKNOWN") return evaluation("PENDING", ["COMPLETION_PENDING"], observation.completionOffset ?? "unknown", observation);
  if (!observation.completionOffset || !observation.updateId) return evaluation("UNCERTAIN", ["COMPLETION_EVIDENCE_INCOMPLETE"], observation.completionOffset ?? "unknown", observation);
  if (policy.synchronizerId && observation.synchronizerId !== policy.synchronizerId) return evaluation("REJECTED", ["SYNCHRONIZER_MISMATCH"], observation.completionOffset, observation);
  return evaluation("SATISFIED", [], `participant:${observation.participantId}:offset:${observation.completionOffset}`, observation);
}

function evaluation(outcome: FinalityOutcome, reasonCodes: readonly string[], observedPosition: string, observation: NetworkFinalityObservation) {
  const evidence = observation.kind === "EVM"
    ? [`provider=${observation.provider}`, `chainId=${observation.chainId}`, `transactionBlock=${observation.transactionBlockNumber}:${observation.transactionBlockHash}`, `canonicalBlockHash=${observation.canonicalBlockHash}`, `confirmations=${observation.confirmations}`, `finalizedBlock=${observation.finalizedBlockNumber ?? "none"}:${observation.finalizedBlockHash ?? "none"}`]
    : [`participant=${observation.participantId}`, `partyScope=${[...observation.partyScope].sort().join(",")}`, `completionOffset=${observation.completionOffset ?? "none"}`, `updateId=${observation.updateId ?? "none"}`, `synchronizerId=${observation.synchronizerId ?? "none"}`];
  return { outcome, reasonCodes, observedPosition, evidence };
}

function assertCommon(input: { id: string; transactionId: string; observation: NetworkFinalityObservation }, configuration: FinalityNetworkConfiguration, assessedAt: string): void {
  if (!input.id.startsWith("IW:FINALITY:") || input.id.length === "IW:FINALITY:".length) throw new RegistryError("INVALID_ARGUMENT", "invalid finality assessment ID");
  if (!input.transactionId.trim() || input.transactionId !== input.observation.transactionId) throw new RegistryError("INVALID_ARGUMENT", "finality transaction ID mismatch");
  if (configuration.networkType !== input.observation.kind) throw new RegistryError("INVALID_ARGUMENT", "finality network type mismatch");
  if (!Number.isFinite(Date.parse(input.observation.observedAt)) || !Number.isFinite(Date.parse(assessedAt))) throw new RegistryError("INVALID_ARGUMENT", "invalid finality timestamp");
  if (configuration.policy.kind === "EVM_CONFIRMATIONS" && (!Number.isSafeInteger(configuration.policy.confirmations) || configuration.policy.confirmations < 1)) throw new RegistryError("INVALID_ARGUMENT", "EVM finality confirmations must be positive");
}

type AssessmentRow = { assessment: FinalityAssessment };
export class PostgresFinalityAssessmentStore implements FinalityAssessmentStore {
  constructor(readonly db: SqlExecutor) {}
  async save(assessment: FinalityAssessment): Promise<void> {
    const result = await this.db.query("INSERT INTO finality_assessments (id,network_id,transaction_id,outcome,assessment) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO NOTHING", [assessment.id, assessment.networkId, assessment.transactionId, assessment.outcome, JSON.stringify(assessment)]);
    if (result.rowCount !== 1) throw new RegistryError("CONFLICT", `finality assessment is immutable: ${assessment.id}`);
  }
  async get(id: FinalityAssessmentId): Promise<FinalityAssessment | undefined> { const result = await this.db.query<AssessmentRow>("SELECT assessment FROM finality_assessments WHERE id=$1", [id]); const value = result.rows[0]?.assessment; return value ? structuredClone(value) : undefined; }
}
