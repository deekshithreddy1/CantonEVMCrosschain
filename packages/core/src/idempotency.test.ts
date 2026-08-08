import assert from "node:assert/strict";
import test from "node:test";
import { IdempotentWriteCoordinator, ReplayProtectedDestination, requestFingerprint } from "./idempotency.js";
import type { AtomicDestinationExecutor, DestinationEffect, DestinationExecutionRequest, DestinationExecutionResult, IdempotencyClaim, IdempotencyRecord, IdempotencyStore } from "./idempotency.js";
import { RegistryError } from "./registry-errors.js";

class TestIdempotencyStore implements IdempotencyStore {
  readonly records = new Map<string, IdempotencyRecord>();
  async claim<Response>(record: IdempotencyRecord<Response>): Promise<IdempotencyClaim<Response>> {
    const key = `${record.scope}|${record.key}`; const existing = this.records.get(key) as IdempotencyRecord<Response> | undefined;
    if (!existing) { this.records.set(key, structuredClone(record)); return { outcome: "CLAIMED", record: structuredClone(record) }; }
    if (existing.requestHash !== record.requestHash || existing.operationId !== record.operationId) return { outcome: "CONFLICT", record: structuredClone(existing) };
    if (existing.status === "FAILED") { const retry: IdempotencyRecord<Response> = { scope: existing.scope, key: existing.key, requestHash: existing.requestHash, operationId: existing.operationId, status: "IN_PROGRESS", createdAt: existing.createdAt, updatedAt: record.updatedAt }; this.records.set(key, retry); return { outcome: "CLAIMED", record: structuredClone(retry) }; }
    return { outcome: existing.status === "COMPLETED" ? "REPLAY" : "IN_PROGRESS", record: structuredClone(existing) };
  }
  async complete<Response>(scope: string, key: string, hash: string, response: Response, updatedAt: string): Promise<IdempotencyRecord<Response>> { return this.finish(scope, key, hash, { status: "COMPLETED", response, updatedAt }); }
  async fail(scope: string, key: string, hash: string, errorCode: string, updatedAt: string): Promise<IdempotencyRecord> { return this.finish(scope, key, hash, { status: "FAILED", errorCode, updatedAt }); }
  private finish<Response>(scope: string, key: string, hash: string, patch: { status: "COMPLETED"; response: Response; updatedAt: string } | { status: "FAILED"; errorCode: string; updatedAt: string }): IdempotencyRecord<Response> {
    const mapKey = `${scope}|${key}`; const existing = this.records.get(mapKey) as IdempotencyRecord<Response> | undefined; if (!existing) throw new RegistryError("NOT_FOUND", "missing"); if (existing.requestHash !== hash) throw new RegistryError("CONFLICT", "hash"); if (existing.status === "COMPLETED") return structuredClone(existing);
    const updated = { ...existing, ...patch } as IdempotencyRecord<Response>; this.records.set(mapKey, updated); return structuredClone(updated);
  }
}

test("request fingerprints are canonical and payload changes conflict", async () => {
  assert.equal(requestFingerprint({ amount: "10", receiver: "bob" }), requestFingerprint({ receiver: "bob", amount: "10" }));
  const store = new TestIdempotencyStore(); const coordinator = new IdempotentWriteCoordinator(store, () => new Date("2026-08-08T00:00:00.000Z"));
  const first = await coordinator.begin({ scope: "tenant-a:bridge", key: "request-0001", operationId: "IW:BRIDGE:one", request: { amount: "10" } }); assert.equal(first.outcome, "CLAIMED");
  const concurrent = await coordinator.begin({ scope: "tenant-a:bridge", key: "request-0001", operationId: "IW:BRIDGE:one", request: { amount: "10" } }); assert.equal(concurrent.outcome, "IN_PROGRESS");
  const conflict = await coordinator.begin({ scope: "tenant-a:bridge", key: "request-0001", operationId: "IW:BRIDGE:one", request: { amount: "11" } }); assert.equal(conflict.outcome, "CONFLICT");
  const completed = await coordinator.complete(first.record, { operationId: "IW:BRIDGE:one" });
  const replay = await coordinator.begin({ scope: "tenant-a:bridge", key: "request-0001", operationId: "IW:BRIDGE:one", request: { amount: "10" } }); assert.equal(replay.outcome, "REPLAY"); assert.deepEqual(replay.record.response, completed.response);
});

test("failed writes can be claimed for retry with the same request", async () => {
  const store = new TestIdempotencyStore(); const coordinator = new IdempotentWriteCoordinator(store, () => new Date("2026-08-08T00:00:00.000Z"));
  const claim = await coordinator.begin({ scope: "tenant-a:settlement", key: "request-0002", operationId: "IW:BRIDGE:two", request: { amount: "20" } }); await coordinator.fail(claim.record, "TEMPORARY_UNAVAILABLE");
  assert.equal((await coordinator.begin({ scope: "tenant-a:settlement", key: "request-0002", operationId: "IW:BRIDGE:two", request: { amount: "20" } })).outcome, "CLAIMED");
});

class AtomicEffectTarget implements AtomicDestinationExecutor {
  readonly processed = new Map<string, DestinationExecutionResult>(); readonly counts: Record<DestinationEffect, number> = { MINT: 0, RELEASE: 0, PAYMENT: 0, SETTLEMENT: 0 };
  async executeOnce(request: DestinationExecutionRequest): Promise<DestinationExecutionResult> { const key = `${request.operationId}|${request.effect}`; const prior = this.processed.get(key); if (prior) return { ...prior, outcome: "ALREADY_PROCESSED" }; this.counts[request.effect]++; const result: DestinationExecutionResult = { outcome: "EXECUTED", operationId: request.operationId, effect: request.effect, transactionId: `tx-${request.effect}` }; this.processed.set(key, result); return structuredClone(result); }
  async isProcessed(id: `IW:BRIDGE:${string}`, effect: DestinationEffect): Promise<boolean> { return this.processed.has(`${id}|${effect}`); }
}

test("retrying destination stages cannot duplicate financial effects", async () => {
  const target = new AtomicEffectTarget(); const destination = new ReplayProtectedDestination(target);
  for (const effect of ["MINT", "RELEASE", "PAYMENT", "SETTLEMENT"] as const) {
    const request = { operationId: `IW:BRIDGE:${effect.toLowerCase()}` as const, effect, payloadHash: `sha256:${effect}` };
    assert.equal((await destination.execute(request)).outcome, "EXECUTED"); assert.equal((await destination.execute(request)).outcome, "ALREADY_PROCESSED"); assert.equal(target.counts[effect], 1);
  }
});
