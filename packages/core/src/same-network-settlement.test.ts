import assert from "node:assert/strict";
import test from "node:test";
import { requestFingerprint } from "./idempotency.js";
import type { NativeAtomicSettlementExecutor, NativeAtomicSettlementResult, SameNetworkSettlementRecord, SameNetworkSettlementRequest, SameNetworkSettlementStore, SettlementClaim } from "./same-network-settlement.js";
import { SameNetworkSettlementService } from "./same-network-settlement.js";

class Store implements SameNetworkSettlementStore {
  values = new Map<string, SameNetworkSettlementRecord>();
  async claim(request: SameNetworkSettlementRequest, requestHash: string, recordedAt: string): Promise<SettlementClaim> {
    const existing = this.values.get(request.id);
    if (existing) return { outcome: existing.requestHash === requestHash ? "REPLAY" : "CONFLICT", record: structuredClone(existing) };
    const record: SameNetworkSettlementRecord = { request: structuredClone(request), requestHash, status: "IN_PROGRESS", recordedAt };
    this.values.set(request.id, record); return { outcome: "CLAIMED", record: structuredClone(record) };
  }
  async finish(id: SameNetworkSettlementRequest["id"], requestHash: string, status: "COMPLETED" | "FAILED" | "MANUAL_REVIEW", result: NativeAtomicSettlementResult, recordedAt: string) {
    const existing = this.values.get(id); if (!existing || existing.requestHash !== requestHash) throw new Error("claim mismatch");
    if (existing.status !== "IN_PROGRESS") return structuredClone(existing);
    const record: SameNetworkSettlementRecord = { ...existing, status, result: structuredClone(result), recordedAt };
    this.values.set(id, record); return structuredClone(record);
  }
  async get(id: SameNetworkSettlementRequest["id"]) { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
}

const base: SameNetworkSettlementRequest = {
  id: "IW:SETTLEMENT:trade-1", idempotencyKey: "trade-1", networkId: "IW:NETWORK:canton", networkType: "CANTON",
  legs: [
    { id: "delivery", assetId: "IW:ASSET:bond", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", amount: "10" },
    { id: "payment", assetId: "IW:ASSET:cash", sender: "IW:IDENTITY:bob", receiver: "IW:IDENTITY:alice", amount: "1000" }
  ], createdAt: "2026-08-12T12:00:00.000Z", expiresAt: "2026-08-12T13:00:00.000Z"
};
const evidence = { externalTransactionId: "tx-1", observedPosition: "offset-42", evidence: ["native-receipt"], finalizedAt: "2026-08-12T12:01:00.000Z" };
function executor(networkId = base.networkId, networkType = base.networkType, outcome: NativeAtomicSettlementResult = { outcome: "COMMITTED", evidence }) {
  let calls = 0;
  const value: NativeAtomicSettlementExecutor = { networkId, networkType, executeAtomically: async () => { calls++; return structuredClone(outcome); } };
  return { value, calls: () => calls };
}

test("Canton executor atomically commits reciprocal delivery-versus-payment legs", async () => {
  const native = executor(); const service = new SameNetworkSettlementService([native.value], new Store(), () => new Date("2026-08-12T12:02:00.000Z"));
  const result = await service.execute(base);
  assert.equal(result.status, "COMPLETED"); assert.equal(result.result?.outcome, "COMMITTED"); assert.equal(native.calls(), 1);
});

test("the same network-neutral contract dispatches to an EVM atomic executor", async () => {
  const request = { ...base, id: "IW:SETTLEMENT:evm-1" as const, networkId: "IW:NETWORK:evm" as const, networkType: "EVM" as const };
  const native = executor(request.networkId, request.networkType); const result = await new SameNetworkSettlementService([native.value], new Store(), () => new Date("2026-08-12T12:02:00.000Z")).execute(request);
  assert.equal(result.status, "COMPLETED"); assert.equal(native.calls(), 1);
});

test("completed replay returns immutable evidence without another native execution", async () => {
  const native = executor(); const service = new SameNetworkSettlementService([native.value], new Store(), () => new Date("2026-08-12T12:02:00.000Z"));
  await service.execute(base); const replay = await service.execute(base);
  assert.equal(replay.result?.outcome, "COMMITTED"); assert.equal(native.calls(), 1);
});

test("restart resumes an in-progress claim and accepts already-committed native evidence", async () => {
  const store = new Store(); await store.claim(base, requestFingerprint(base), "2026-08-12T12:01:00.000Z");
  const native = executor(base.networkId, base.networkType, { outcome: "ALREADY_COMMITTED", evidence });
  const result = await new SameNetworkSettlementService([native.value], store, () => new Date("2026-08-12T12:03:00.000Z")).execute(base);
  assert.equal(result.status, "COMPLETED"); assert.equal(result.result?.outcome, "ALREADY_COMMITTED"); assert.equal(native.calls(), 1);
});

test("invalid structures, expiry, and conflicting ID reuse are rejected", async () => {
  const native = executor(); const store = new Store(); const service = new SameNetworkSettlementService([native.value], store, () => new Date("2026-08-12T12:02:00.000Z"));
  const bad = { ...base, legs: [base.legs[0], { ...base.legs[1], receiver: "IW:IDENTITY:carol" }] as SameNetworkSettlementRequest["legs"] };
  await assert.rejects(service.execute(bad), /reciprocal/);
  const expired = { ...base, id: "IW:SETTLEMENT:expired" as const, expiresAt: "2026-08-12T12:01:00.000Z" };
  assert.equal((await service.execute(expired)).result?.outcome, "REJECTED");
  await service.execute(base); await assert.rejects(service.execute({ ...base, idempotencyKey: "different" }), /reused with different content/);
});

test("rejection fails closed and uncertainty requires manual review", async () => {
  const rejected = executor(base.networkId, base.networkType, { outcome: "REJECTED", reasonCode: "INSUFFICIENT_HOLDINGS", evidence: ["native-rejection"] });
  assert.equal((await new SameNetworkSettlementService([rejected.value], new Store(), () => new Date("2026-08-12T12:02:00.000Z")).execute(base)).status, "FAILED");
  const uncertain = executor(base.networkId, base.networkType, { outcome: "UNCERTAIN", reasonCode: "FINALITY_UNAVAILABLE", evidence: ["tx-submitted"] });
  const request = { ...base, id: "IW:SETTLEMENT:uncertain" as const };
  assert.equal((await new SameNetworkSettlementService([uncertain.value], new Store(), () => new Date("2026-08-12T12:02:00.000Z")).execute(request)).status, "MANUAL_REVIEW");
});
