import { createHash } from "node:crypto";
import type { BridgeOperationId, IsoTimestamp } from "./model.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { RegistryError } from "./registry-errors.js";

export type IdempotencyStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";
export interface IdempotencyRecord<Response = unknown> {
  scope: string;
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  operationId: BridgeOperationId;
  response?: Response;
  errorCode?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
export type IdempotencyClaim<Response> =
  | { outcome: "CLAIMED"; record: IdempotencyRecord<Response> }
  | { outcome: "REPLAY"; record: IdempotencyRecord<Response> }
  | { outcome: "IN_PROGRESS"; record: IdempotencyRecord<Response> }
  | { outcome: "CONFLICT"; record: IdempotencyRecord<Response> };

export interface IdempotencyStore {
  claim<Response>(record: IdempotencyRecord<Response>): Promise<IdempotencyClaim<Response>>;
  complete<Response>(scope: string, key: string, requestHash: string, response: Response, updatedAt: IsoTimestamp): Promise<IdempotencyRecord<Response>>;
  fail(scope: string, key: string, requestHash: string, errorCode: string, updatedAt: IsoTimestamp): Promise<IdempotencyRecord>;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new RegistryError("INVALID_ARGUMENT", "idempotency payload contains a non-finite number"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>; const keys = Object.keys(object).sort();
    if (keys.some((key) => object[key] === undefined)) throw new RegistryError("INVALID_ARGUMENT", "idempotency payload contains undefined");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new RegistryError("INVALID_ARGUMENT", `idempotency payload contains unsupported type: ${typeof value}`);
}
export function requestFingerprint(request: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(request)).digest("hex")}`; }
export function assertIdempotencyKey(key: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new RegistryError("INVALID_ARGUMENT", "idempotency key must be 8-128 safe characters"); }

export class IdempotentWriteCoordinator {
  constructor(readonly store: IdempotencyStore, readonly now: () => Date) {}
  async begin<Response>(input: { scope: string; key: string; operationId: BridgeOperationId; request: unknown }): Promise<IdempotencyClaim<Response>> {
    assertIdempotencyKey(input.key); if (!input.scope.trim()) throw new RegistryError("INVALID_ARGUMENT", "idempotency scope is required");
    if (!input.operationId.startsWith("IW:BRIDGE:") || input.operationId.length === "IW:BRIDGE:".length) throw new RegistryError("INVALID_ARGUMENT", "immutable bridge operation ID is required");
    const timestamp = this.now().toISOString(); return this.store.claim({ scope: input.scope, key: input.key, requestHash: requestFingerprint(input.request), status: "IN_PROGRESS", operationId: input.operationId, createdAt: timestamp, updatedAt: timestamp });
  }
  complete<Response>(claim: IdempotencyRecord, response: Response): Promise<IdempotencyRecord<Response>> { return this.store.complete(claim.scope, claim.key, claim.requestHash, response, this.now().toISOString()); }
  fail(claim: IdempotencyRecord, errorCode: string): Promise<IdempotencyRecord> { if (!errorCode.trim()) throw new RegistryError("INVALID_ARGUMENT", "error code is required"); return this.store.fail(claim.scope, claim.key, claim.requestHash, errorCode, this.now().toISOString()); }
}

type IdempotencyRow = { record: IdempotencyRecord };
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(readonly db: SqlExecutor) {}
  async claim<Response>(record: IdempotencyRecord<Response>): Promise<IdempotencyClaim<Response>> {
    return this.db.transaction(async (client) => {
      const inserted = await client.query<IdempotencyRow>("INSERT INTO idempotency_records (scope, key, request_hash, status, operation_id, record) VALUES ($1,$2,$3,'IN_PROGRESS',$4,$5::jsonb) ON CONFLICT (scope,key) DO NOTHING RETURNING record", [record.scope, record.key, record.requestHash, record.operationId, JSON.stringify(record)]);
      if (inserted.rowCount > 0) return { outcome: "CLAIMED", record: structuredClone(record) };
      const found = await client.query<IdempotencyRow>("SELECT record FROM idempotency_records WHERE scope=$1 AND key=$2 FOR UPDATE", [record.scope, record.key]); const existing = found.rows[0]?.record as IdempotencyRecord<Response> | undefined;
      if (!existing) throw new RegistryError("CONFLICT", "idempotency record disappeared");
      if (existing.requestHash !== record.requestHash || existing.operationId !== record.operationId) return { outcome: "CONFLICT", record: structuredClone(existing) };
      if (existing.status === "FAILED") {
        const retry: IdempotencyRecord<Response> = { scope: existing.scope, key: existing.key, requestHash: existing.requestHash, status: "IN_PROGRESS", operationId: existing.operationId, createdAt: existing.createdAt, updatedAt: record.updatedAt };
        await client.query("UPDATE idempotency_records SET status='IN_PROGRESS', record=$3::jsonb, updated_at=$4 WHERE scope=$1 AND key=$2", [record.scope, record.key, JSON.stringify(retry), retry.updatedAt]);
        return { outcome: "CLAIMED", record: retry };
      }
      return { outcome: existing.status === "COMPLETED" ? "REPLAY" : "IN_PROGRESS", record: structuredClone(existing) };
    });
  }
  complete<Response>(scope: string, key: string, requestHash: string, response: Response, updatedAt: IsoTimestamp): Promise<IdempotencyRecord<Response>> { return this.#finish(scope, key, requestHash, { status: "COMPLETED", response, updatedAt }); }
  fail(scope: string, key: string, requestHash: string, errorCode: string, updatedAt: IsoTimestamp): Promise<IdempotencyRecord> { return this.#finish(scope, key, requestHash, { status: "FAILED", errorCode, updatedAt }); }
  async #finish<Response>(scope: string, key: string, requestHash: string, patch: { status: "COMPLETED"; response: Response; updatedAt: string } | { status: "FAILED"; errorCode: string; updatedAt: string }): Promise<IdempotencyRecord<Response>> {
    return this.db.transaction(async (client) => {
      const selected = await client.query<IdempotencyRow>("SELECT record FROM idempotency_records WHERE scope=$1 AND key=$2 FOR UPDATE", [scope, key]); const existing = selected.rows[0]?.record as IdempotencyRecord<Response> | undefined;
      if (!existing) throw new RegistryError("NOT_FOUND", "idempotency record not found"); if (existing.requestHash !== requestHash) throw new RegistryError("CONFLICT", "idempotency request hash mismatch");
      if (existing.status === "COMPLETED") return structuredClone(existing);
      const updated = { ...existing, ...patch } as IdempotencyRecord<Response>;
      await client.query("UPDATE idempotency_records SET status=$3, record=$4::jsonb, updated_at=$5 WHERE scope=$1 AND key=$2", [scope, key, updated.status, JSON.stringify(updated), updated.updatedAt]); return structuredClone(updated);
    });
  }
}

export type DestinationEffect = "MINT" | "RELEASE" | "PAYMENT" | "SETTLEMENT";
export interface DestinationExecutionRequest { operationId: BridgeOperationId; effect: DestinationEffect; payloadHash: string }
export interface DestinationExecutionResult { outcome: "EXECUTED" | "ALREADY_PROCESSED"; operationId: BridgeOperationId; effect: DestinationEffect; transactionId?: string }
/** The destination implementation MUST atomically record operationId with its financial effect. */
export interface AtomicDestinationExecutor { executeOnce(request: DestinationExecutionRequest): Promise<DestinationExecutionResult>; isProcessed(operationId: BridgeOperationId, effect: DestinationEffect): Promise<boolean> }

export class ReplayProtectedDestination {
  constructor(readonly executor: AtomicDestinationExecutor) {}
  async execute(request: DestinationExecutionRequest): Promise<DestinationExecutionResult> {
    if (!request.operationId.startsWith("IW:BRIDGE:") || !request.payloadHash.trim()) throw new RegistryError("INVALID_ARGUMENT", "operation ID and payload hash are required");
    return this.executor.executeOnce(request);
  }
}
