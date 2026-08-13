import type { AssetId, AtomicAmount, IdentityId, IsoTimestamp, NetworkId, SettlementId } from "./model.js";
import { parseAtomicAmount } from "./invariants.js";
import { requestFingerprint } from "./idempotency.js";
import { RegistryError } from "./registry-errors.js";
import type { SqlExecutor } from "./transaction-engine.js";

export type CrossNetworkSettlementState = "CREATED" | "POLICY_CHECKED" | "DELIVERY_RESERVED" | "DELIVERY_RESERVATION_VERIFIED" | "PAYMENT_SUBMITTED" | "PAYMENT_FINALIZED" | "PAYMENT_ATTESTED" | "DELIVERY_RELEASED" | "DELIVERY_FINALIZED" | "RECONCILED" | "COMPLETED" | "COMPENSATED" | "FAILED" | "EXPIRED" | "MANUAL_REVIEW";
export interface CrossNetworkLeg { assetId: AssetId; networkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount }
export interface CrossNetworkSettlementRequest { id: SettlementId; idempotencyKey: string; delivery: CrossNetworkLeg; payment: CrossNetworkLeg; policyVersion: string; createdAt: IsoTimestamp; expiresAt: IsoTimestamp }
export interface SettlementStepEvidence { transactionId: string; position: string; evidence: readonly string[]; observedAt: IsoTimestamp }
export interface CrossNetworkTransition { sequence: number; state: CrossNetworkSettlementState; occurredAt: IsoTimestamp; evidence: readonly string[]; reason: string }
export interface CrossNetworkSettlementRecord {
  request: CrossNetworkSettlementRequest; requestHash: string; state: CrossNetworkSettlementState; version: number;
  guarantee: "CROSS_NETWORK_SAGA_NON_ATOMIC"; compensation: "CANCEL_DELIVERY_BEFORE_PAYMENT_FINALITY_ONLY";
  transitions: readonly CrossNetworkTransition[];
}
export interface CrossNetworkSettlementStore {
  create(request: CrossNetworkSettlementRequest, requestHash: string, transition: CrossNetworkTransition): Promise<CrossNetworkSettlementRecord>;
  get(id: SettlementId): Promise<CrossNetworkSettlementRecord | undefined>;
  transition(id: SettlementId, expectedVersion: number, transition: CrossNetworkTransition): Promise<CrossNetworkSettlementRecord>;
}
export interface CrossNetworkSettlementPolicy { check(request: CrossNetworkSettlementRequest): Promise<{ outcome: "ALLOW" | "DENY"; evidence: readonly string[]; reason: string }> }
export interface CrossNetworkSettlementActions {
  reserveDelivery(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
  verifyDeliveryReservation(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
  reserveOrTransferPayment(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
  verifyPaymentFinality(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
  attestPayment(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
  releaseDelivery(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
  verifyDelivery(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
  reconcile(request: CrossNetworkSettlementRequest): Promise<{ outcome: "MATCH" | "MISMATCH"; evidence: readonly string[] }>;
  cancelDeliveryReservation(request: CrossNetworkSettlementRequest): Promise<SettlementStepEvidence>;
}

const terminal = new Set<CrossNetworkSettlementState>(["COMPLETED", "COMPENSATED", "FAILED", "EXPIRED", "MANUAL_REVIEW"]);
export class CrossNetworkSettlementService {
  constructor(readonly store: CrossNetworkSettlementStore, readonly policy: CrossNetworkSettlementPolicy, readonly actions: CrossNetworkSettlementActions, readonly now: () => Date = () => new Date()) {}
  async execute(request: CrossNetworkSettlementRequest): Promise<CrossNetworkSettlementRecord> {
    validate(request); const hash = requestFingerprint(request); let record = await this.store.get(request.id);
    if (!record) record = await this.store.create(structuredClone(request), hash, { sequence: 0, state: "CREATED", occurredAt: request.createdAt, evidence: [], reason: "saga created" });
    else if (record.requestHash !== hash) throw new RegistryError("CONFLICT", `settlement ID was reused with different content: ${request.id}`);
    if (terminal.has(record.state)) return record;
    while (!terminal.has(record.state)) {
      if (this.now().getTime() >= Date.parse(request.expiresAt)) return this.expireOrCompensate(record);
      try { record = await this.advance(record); }
      catch (error) { return this.handleFailure(record, error); }
    }
    return record;
  }
  async advance(record: CrossNetworkSettlementRecord): Promise<CrossNetworkSettlementRecord> {
    const request = record.request;
    switch (record.state) {
      case "CREATED": { const result = await this.policy.check(request); if (result.outcome !== "ALLOW") return this.move(record, "FAILED", result.evidence, result.reason || "policy denied"); return this.move(record, "POLICY_CHECKED", result.evidence, "policy allowed"); }
      case "POLICY_CHECKED": return this.effect(record, "DELIVERY_RESERVED", () => this.actions.reserveDelivery(request));
      case "DELIVERY_RESERVED": return this.effect(record, "DELIVERY_RESERVATION_VERIFIED", () => this.actions.verifyDeliveryReservation(request));
      case "DELIVERY_RESERVATION_VERIFIED": return this.effect(record, "PAYMENT_SUBMITTED", () => this.actions.reserveOrTransferPayment(request));
      case "PAYMENT_SUBMITTED": return this.effect(record, "PAYMENT_FINALIZED", () => this.actions.verifyPaymentFinality(request));
      case "PAYMENT_FINALIZED": return this.effect(record, "PAYMENT_ATTESTED", () => this.actions.attestPayment(request));
      case "PAYMENT_ATTESTED": return this.effect(record, "DELIVERY_RELEASED", () => this.actions.releaseDelivery(request));
      case "DELIVERY_RELEASED": return this.effect(record, "DELIVERY_FINALIZED", () => this.actions.verifyDelivery(request));
      case "DELIVERY_FINALIZED": { const result = await this.actions.reconcile(request); return this.move(record, result.outcome === "MATCH" ? "RECONCILED" : "MANUAL_REVIEW", result.evidence, result.outcome === "MATCH" ? "reconciled" : "reconciliation mismatch"); }
      case "RECONCILED": return this.move(record, "COMPLETED", [], "saga completed");
      default: return record;
    }
  }
  async effect(record: CrossNetworkSettlementRecord, state: CrossNetworkSettlementState, work: () => Promise<SettlementStepEvidence>) { const result = await work(); validateEvidence(result); return this.move(record, state, [...result.evidence, result.transactionId, result.position], `entered ${state}`); }
  async expireOrCompensate(record: CrossNetworkSettlementRecord) {
    if (beforePaymentFinality(record.state) && record.state !== "CREATED" && record.state !== "POLICY_CHECKED") {
      try { const result = await this.actions.cancelDeliveryReservation(record.request); validateEvidence(result); return this.move(record, "COMPENSATED", [...result.evidence, result.transactionId, result.position], "expired; delivery reservation cancelled"); }
      catch { return this.move(record, "MANUAL_REVIEW", [], "expiry compensation uncertain"); }
    }
    return this.move(record, beforePaymentFinality(record.state) ? "EXPIRED" : "MANUAL_REVIEW", [], beforePaymentFinality(record.state) ? "expired before reservation" : "expired after payment finality; automatic reversal prohibited");
  }
  async handleFailure(record: CrossNetworkSettlementRecord, error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown saga failure";
    if (beforePaymentFinality(record.state) && record.state !== "CREATED" && record.state !== "POLICY_CHECKED") {
      try { const result = await this.actions.cancelDeliveryReservation(record.request); validateEvidence(result); return this.move(record, "COMPENSATED", [...result.evidence, result.transactionId, result.position], `failure compensated: ${reason}`); }
      catch { return this.move(record, "MANUAL_REVIEW", [], `failure and compensation uncertain: ${reason}`); }
    }
    return this.move(record, beforePaymentFinality(record.state) ? "FAILED" : "MANUAL_REVIEW", [], beforePaymentFinality(record.state) ? reason : `post-payment-finality failure: ${reason}`);
  }
  move(record: CrossNetworkSettlementRecord, state: CrossNetworkSettlementState, evidence: readonly string[], reason: string) { return this.store.transition(record.request.id, record.version, { sequence: record.version + 1, state, occurredAt: this.now().toISOString(), evidence, reason }); }
}

function beforePaymentFinality(state: CrossNetworkSettlementState) { return ["CREATED", "POLICY_CHECKED", "DELIVERY_RESERVED", "DELIVERY_RESERVATION_VERIFIED", "PAYMENT_SUBMITTED"].includes(state); }
function validate(request: CrossNetworkSettlementRequest) {
  if (!request.id.startsWith("IW:SETTLEMENT:") || !request.idempotencyKey.trim() || !request.policyVersion.trim()) throw new RegistryError("INVALID_ARGUMENT", "settlement ID, idempotency key, and policy version are required");
  if (request.delivery.networkId === request.payment.networkId) throw new RegistryError("INVALID_ARGUMENT", "cross-network settlement requires different networks");
  if (request.delivery.sender !== request.payment.receiver || request.delivery.receiver !== request.payment.sender || request.delivery.sender === request.delivery.receiver) throw new RegistryError("INVALID_ARGUMENT", "settlement legs must have reciprocal distinct counterparties");
  if (parseAtomicAmount(request.delivery.amount) <= 0n || parseAtomicAmount(request.payment.amount) <= 0n) throw new RegistryError("INVALID_ARGUMENT", "settlement amounts must be positive");
  if (!Number.isFinite(Date.parse(request.createdAt)) || Date.parse(request.expiresAt) <= Date.parse(request.createdAt)) throw new RegistryError("INVALID_ARGUMENT", "settlement validity interval is invalid");
}
function validateEvidence(value: SettlementStepEvidence) { if (!value.transactionId.trim() || !value.position.trim() || value.evidence.length === 0 || !Number.isFinite(Date.parse(value.observedAt))) throw new RegistryError("INVALID_ARGUMENT", "saga step requires verifiable evidence"); }

export class InMemoryCrossNetworkSettlementStore implements CrossNetworkSettlementStore {
  readonly records = new Map<SettlementId, CrossNetworkSettlementRecord>();
  async create(request: CrossNetworkSettlementRequest, requestHash: string, transition: CrossNetworkTransition) { const existing = this.records.get(request.id); if (existing) return structuredClone(existing); const value: CrossNetworkSettlementRecord = { request, requestHash, state: "CREATED", version: 0, guarantee: "CROSS_NETWORK_SAGA_NON_ATOMIC", compensation: "CANCEL_DELIVERY_BEFORE_PAYMENT_FINALITY_ONLY", transitions: [transition] }; this.records.set(request.id, value); return structuredClone(value); }
  async get(id: SettlementId) { const value = this.records.get(id); return value ? structuredClone(value) : undefined; }
  async transition(id: SettlementId, expectedVersion: number, transition: CrossNetworkTransition) { const value = this.records.get(id); if (!value) throw new RegistryError("NOT_FOUND", `settlement not found: ${id}`); if (value.version !== expectedVersion) throw new RegistryError("CONFLICT", "stale settlement version"); const next = { ...value, state: transition.state, version: expectedVersion + 1, transitions: [...value.transitions, transition] }; this.records.set(id, next); return structuredClone(next); }
}

type CrossNetworkRow = { record: CrossNetworkSettlementRecord };
export class PostgresCrossNetworkSettlementStore implements CrossNetworkSettlementStore {
  constructor(readonly db: SqlExecutor) {}
  async create(request: CrossNetworkSettlementRequest, requestHash: string, transition: CrossNetworkTransition) {
    return this.db.transaction(async (client) => {
      const record: CrossNetworkSettlementRecord = { request, requestHash, state: "CREATED", version: 0, guarantee: "CROSS_NETWORK_SAGA_NON_ATOMIC", compensation: "CANCEL_DELIVERY_BEFORE_PAYMENT_FINALITY_ONLY", transitions: [transition] };
      const inserted = await client.query("INSERT INTO cross_network_settlements (id,request_hash,state,version,record) VALUES ($1,$2,'CREATED',0,$3::jsonb) ON CONFLICT (id) DO NOTHING", [request.id, requestHash, JSON.stringify(record)]);
      if (inserted.rowCount === 0) { const found = await client.query<CrossNetworkRow>("SELECT record FROM cross_network_settlements WHERE id=$1", [request.id]); const existing = found.rows[0]?.record; if (!existing) throw new RegistryError("CONFLICT", "settlement create conflict"); return structuredClone(existing); }
      await client.query("INSERT INTO cross_network_settlement_transitions (settlement_id,sequence,state,occurred_at,evidence,reason) VALUES ($1,0,'CREATED',$2,$3::jsonb,$4)", [request.id, transition.occurredAt, JSON.stringify(transition.evidence), transition.reason]);
      return structuredClone(record);
    });
  }
  async get(id: SettlementId) { const result = await this.db.query<CrossNetworkRow>("SELECT record FROM cross_network_settlements WHERE id=$1", [id]); const value = result.rows[0]?.record; return value ? structuredClone(value) : undefined; }
  async transition(id: SettlementId, expectedVersion: number, transition: CrossNetworkTransition) {
    return this.db.transaction(async (client) => {
      const found = await client.query<CrossNetworkRow>("SELECT record FROM cross_network_settlements WHERE id=$1 FOR UPDATE", [id]); const record = found.rows[0]?.record;
      if (!record) throw new RegistryError("NOT_FOUND", `settlement not found: ${id}`); if (record.version !== expectedVersion) throw new RegistryError("CONFLICT", "stale settlement version");
      const next: CrossNetworkSettlementRecord = { ...record, state: transition.state, version: expectedVersion + 1, transitions: [...record.transitions, transition] };
      await client.query("INSERT INTO cross_network_settlement_transitions (settlement_id,sequence,state,occurred_at,evidence,reason) VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [id, transition.sequence, transition.state, transition.occurredAt, JSON.stringify(transition.evidence), transition.reason]);
      const updated = await client.query("UPDATE cross_network_settlements SET state=$2,version=$3,record=$4::jsonb,updated_at=$5 WHERE id=$1 AND version=$6", [id, transition.state, expectedVersion + 1, JSON.stringify(next), transition.occurredAt, expectedVersion]);
      if (updated.rowCount !== 1) throw new RegistryError("CONFLICT", "stale settlement version"); return structuredClone(next);
    });
  }
}
