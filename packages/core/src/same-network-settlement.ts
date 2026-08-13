import type { AssetId, AtomicAmount, IdentityId, IsoTimestamp, NetworkId, NetworkType, SettlementId } from "./model.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { parseAtomicAmount } from "./invariants.js";
import { requestFingerprint } from "./idempotency.js";
import { RegistryError } from "./registry-errors.js";

export interface SameNetworkSettlementLeg {
  id: string;
  assetId: AssetId;
  sender: IdentityId;
  receiver: IdentityId;
  amount: AtomicAmount;
}

export interface SameNetworkSettlementRequest {
  id: SettlementId;
  idempotencyKey: string;
  networkId: NetworkId;
  networkType: NetworkType;
  legs: readonly [SameNetworkSettlementLeg, SameNetworkSettlementLeg];
  expiresAt: IsoTimestamp;
  createdAt: IsoTimestamp;
}

export interface NativeAtomicSettlementEvidence {
  externalTransactionId: string;
  observedPosition: string;
  evidence: readonly string[];
  finalizedAt: IsoTimestamp;
}

export type NativeAtomicSettlementResult =
  | { outcome: "COMMITTED" | "ALREADY_COMMITTED"; evidence: NativeAtomicSettlementEvidence }
  | { outcome: "REJECTED"; reasonCode: string; evidence: readonly string[] }
  | { outcome: "UNCERTAIN"; reasonCode: string; evidence: readonly string[] };

/** Implementations must execute both legs in one native transaction and deduplicate by request.id. */
export interface NativeAtomicSettlementExecutor {
  readonly networkId: NetworkId;
  readonly networkType: NetworkType;
  executeAtomically(request: SameNetworkSettlementRequest): Promise<NativeAtomicSettlementResult>;
}

export type SameNetworkSettlementStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED" | "MANUAL_REVIEW";
export interface SameNetworkSettlementRecord {
  request: SameNetworkSettlementRequest;
  requestHash: string;
  status: SameNetworkSettlementStatus;
  result?: NativeAtomicSettlementResult;
  recordedAt: IsoTimestamp;
}

export type SettlementClaim =
  | { outcome: "CLAIMED" | "REPLAY"; record: SameNetworkSettlementRecord }
  | { outcome: "CONFLICT"; record: SameNetworkSettlementRecord };

export interface SameNetworkSettlementStore {
  claim(request: SameNetworkSettlementRequest, requestHash: string, recordedAt: IsoTimestamp): Promise<SettlementClaim>;
  finish(id: SettlementId, requestHash: string, status: Exclude<SameNetworkSettlementStatus, "IN_PROGRESS">, result: NativeAtomicSettlementResult, recordedAt: IsoTimestamp): Promise<SameNetworkSettlementRecord>;
  get(id: SettlementId): Promise<SameNetworkSettlementRecord | undefined>;
}

export class SameNetworkSettlementService {
  readonly #executors: ReadonlyMap<NetworkId, NativeAtomicSettlementExecutor>;

  constructor(executors: readonly NativeAtomicSettlementExecutor[], readonly store: SameNetworkSettlementStore, readonly now: () => Date = () => new Date()) {
    const configured = new Map<NetworkId, NativeAtomicSettlementExecutor>();
    for (const executor of executors) {
      if (configured.has(executor.networkId)) throw new RegistryError("CONFLICT", `duplicate settlement executor: ${executor.networkId}`);
      configured.set(executor.networkId, executor);
    }
    this.#executors = configured;
  }

  async execute(request: SameNetworkSettlementRequest): Promise<SameNetworkSettlementRecord> {
    assertRequest(request);
    const executor = this.#executors.get(request.networkId);
    if (!executor || executor.networkType !== request.networkType) throw new RegistryError("NOT_FOUND", `native atomic settlement executor not configured: ${request.networkId}`);
    const hash = requestFingerprint(request);
    const claim = await this.store.claim(structuredClone(request), hash, this.now().toISOString());
    if (claim.outcome === "CONFLICT") throw new RegistryError("CONFLICT", `settlement ID was reused with different content: ${request.id}`);
    if (claim.record.status !== "IN_PROGRESS") return structuredClone(claim.record);
    if (this.now().getTime() >= Date.parse(request.expiresAt)) {
      const expired: NativeAtomicSettlementResult = { outcome: "REJECTED", reasonCode: "SETTLEMENT_EXPIRED", evidence: [] };
      return this.store.finish(request.id, hash, "FAILED", expired, this.now().toISOString());
    }

    let result: NativeAtomicSettlementResult;
    try { result = await executor.executeAtomically(structuredClone(request)); }
    catch { result = { outcome: "UNCERTAIN", reasonCode: "EXECUTOR_ERROR", evidence: [] }; }
    assertResult(result);
    const status = result.outcome === "COMMITTED" || result.outcome === "ALREADY_COMMITTED" ? "COMPLETED" : result.outcome === "REJECTED" ? "FAILED" : "MANUAL_REVIEW";
    return this.store.finish(request.id, hash, status, structuredClone(result), this.now().toISOString());
  }
}

function assertRequest(request: SameNetworkSettlementRequest): void {
  if (!request.id.startsWith("IW:SETTLEMENT:") || !request.networkId.startsWith("IW:NETWORK:") || !request.idempotencyKey.trim()) throw new RegistryError("INVALID_ARGUMENT", "settlement, network, and idempotency identifiers are required");
  if (!Number.isFinite(Date.parse(request.createdAt)) || !Number.isFinite(Date.parse(request.expiresAt)) || Date.parse(request.expiresAt) <= Date.parse(request.createdAt)) throw new RegistryError("INVALID_ARGUMENT", "settlement validity interval is invalid");
  const [delivery, payment] = request.legs;
  if (!delivery?.id.trim() || !payment?.id.trim() || delivery.id === payment.id) throw new RegistryError("INVALID_ARGUMENT", "exactly two unique settlement legs are required");
  if (delivery.assetId === payment.assetId) throw new RegistryError("INVALID_ARGUMENT", "same-network asset-for-asset settlement requires distinct assets");
  if (delivery.sender !== payment.receiver || delivery.receiver !== payment.sender || delivery.sender === delivery.receiver) throw new RegistryError("INVALID_ARGUMENT", "settlement legs must have reciprocal distinct counterparties");
  for (const leg of request.legs) if (parseAtomicAmount(leg.amount) <= 0n) throw new RegistryError("INVALID_ARGUMENT", "settlement leg amounts must be positive");
}

function assertResult(result: NativeAtomicSettlementResult): void {
  if (result.outcome === "COMMITTED" || result.outcome === "ALREADY_COMMITTED") {
    if (!result.evidence.externalTransactionId.trim() || !result.evidence.observedPosition.trim() || result.evidence.evidence.length === 0 || !Number.isFinite(Date.parse(result.evidence.finalizedAt))) throw new RegistryError("INVALID_ARGUMENT", "committed atomic settlement requires finality evidence");
  } else if ((result.outcome === "REJECTED" || result.outcome === "UNCERTAIN") && !result.reasonCode.trim()) throw new RegistryError("INVALID_ARGUMENT", "non-committed atomic settlement requires a reason code");
}

type SettlementRow = { record: SameNetworkSettlementRecord };
export class PostgresSameNetworkSettlementStore implements SameNetworkSettlementStore {
  constructor(readonly db: SqlExecutor) {}
  async claim(request: SameNetworkSettlementRequest, requestHash: string, recordedAt: IsoTimestamp): Promise<SettlementClaim> {
    return this.db.transaction(async (client) => {
      const record: SameNetworkSettlementRecord = { request, requestHash, status: "IN_PROGRESS", recordedAt };
      const inserted = await client.query("INSERT INTO same_network_settlements (id,network_id,status,request_hash,record) VALUES ($1,$2,'IN_PROGRESS',$3,$4::jsonb) ON CONFLICT (id) DO NOTHING", [request.id, request.networkId, requestHash, JSON.stringify(record)]);
      if (inserted.rowCount === 1) return { outcome: "CLAIMED", record };
      const found = await client.query<SettlementRow>("SELECT record FROM same_network_settlements WHERE id=$1 FOR UPDATE", [request.id]);
      const existing = found.rows[0]?.record;
      if (!existing) throw new RegistryError("CONFLICT", `settlement claim disappeared: ${request.id}`);
      return { outcome: existing.requestHash === requestHash ? "REPLAY" : "CONFLICT", record: structuredClone(existing) };
    });
  }
  async finish(id: SettlementId, requestHash: string, status: Exclude<SameNetworkSettlementStatus, "IN_PROGRESS">, result: NativeAtomicSettlementResult, recordedAt: IsoTimestamp): Promise<SameNetworkSettlementRecord> {
    return this.db.transaction(async (client) => {
      const found = await client.query<SettlementRow>("SELECT record FROM same_network_settlements WHERE id=$1 FOR UPDATE", [id]);
      const existing = found.rows[0]?.record;
      if (!existing || existing.requestHash !== requestHash) throw new RegistryError("CONFLICT", `settlement claim does not match: ${id}`);
      if (existing.status !== "IN_PROGRESS") return structuredClone(existing);
      const record: SameNetworkSettlementRecord = { ...existing, status, result, recordedAt };
      await client.query("UPDATE same_network_settlements SET status=$2,record=$3::jsonb,recorded_at=$4 WHERE id=$1", [id, status, JSON.stringify(record), recordedAt]);
      return structuredClone(record);
    });
  }
  async get(id: SettlementId) { const result = await this.db.query<SettlementRow>("SELECT record FROM same_network_settlements WHERE id=$1", [id]); const value = result.rows[0]?.record; return value ? structuredClone(value) : undefined; }
}
