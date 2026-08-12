import assert from "node:assert/strict";
import test from "node:test";
import type { FinalityAssessment, FinalityAssessmentId, FinalityAssessmentStore } from "./finality-service.js";
import { FinalityService } from "./finality-service.js";

class MemoryStore implements FinalityAssessmentStore {
  values = new Map<FinalityAssessmentId, FinalityAssessment>();
  async save(value: FinalityAssessment) { if (this.values.has(value.id)) throw new Error("duplicate"); this.values.set(value.id, structuredClone(value)); }
  async get(id: FinalityAssessmentId) { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
}
const now = () => new Date("2026-08-11T12:00:00.000Z");
const evmNetwork = { networkId: "IW:NETWORK:evm" as const, networkType: "EVM" as const, chainId: "1", policy: { kind: "EVM_CONFIRMATIONS" as const, confirmations: 6, requireFinalizedTag: true }, enabled: true };
const cantonNetwork = { networkId: "IW:NETWORK:canton" as const, networkType: "CANTON" as const, policy: { kind: "CANTON_COMPLETION" as const, synchronizerId: "sync-1" }, enabled: true };

test("EVM receipt, canonicality, confirmations, and finalized inclusion remain distinct", async () => {
  const store = new MemoryStore(); const service = new FinalityService(store, [evmNetwork], now);
  const base = { kind: "EVM" as const, networkId: "IW:NETWORK:evm" as const, chainId: "1", transactionId: "0xtx", receiptStatus: "SUCCESS" as const, transactionBlockNumber: "100", transactionBlockHash: "0xaaa", canonicalBlockHash: "0xaaa", observedHead: "110", confirmations: 11, includedInFinalizedChain: false, provider: "validator-rpc-1", observedAt: "2026-08-11T11:59:59.000Z" };
  const pending = await service.assess({ id: "IW:FINALITY:f1", transactionId: "0xtx", observation: base });
  assert.equal(pending.outcome, "PENDING"); assert.deepEqual(pending.reasonCodes, ["FINALIZED_TAG_PENDING"]);
  const final = await service.assess({ id: "IW:FINALITY:f2", transactionId: "0xtx", observation: { ...base, includedInFinalizedChain: true, finalizedBlockNumber: "105", finalizedBlockHash: "0xfff" } });
  assert.equal(final.outcome, "SATISFIED"); assert.equal((await store.get(final.id))?.outcome, "SATISFIED");
});

test("EVM reverts reject and canonical hash disagreements become uncertain", async () => {
  const service = new FinalityService(new MemoryStore(), [{ ...evmNetwork, policy: { ...evmNetwork.policy, confirmations: 1, requireFinalizedTag: false } }], now);
  const base = { kind: "EVM" as const, networkId: "IW:NETWORK:evm" as const, chainId: "1", transactionId: "0xtx", receiptStatus: "SUCCESS" as const, transactionBlockNumber: "100", transactionBlockHash: "0xaaa", canonicalBlockHash: "0xaaa", observedHead: "105", confirmations: 6, includedInFinalizedChain: false, provider: "rpc", observedAt: now().toISOString() };
  const reverted = await service.assess({ id: "IW:FINALITY:revert", transactionId: "0xtx", observation: { ...base, receiptStatus: "REVERTED" } });
  assert.equal(reverted.outcome, "REJECTED");
  const reorg = await service.assess({ id: "IW:FINALITY:reorg", transactionId: "0xtx", observation: { ...base, canonicalBlockHash: "0xbbb" } });
  assert.equal(reorg.outcome, "UNCERTAIN");
});

test("Canton requires committed, participant-scoped completion and matching synchronizer evidence", async () => {
  const service = new FinalityService(new MemoryStore(), [cantonNetwork], now);
  const base = { kind: "CANTON" as const, networkId: "IW:NETWORK:canton" as const, transactionId: "update-1", status: "COMMITTED" as const, completionOffset: "42", updateId: "update-1", synchronizerId: "sync-1", participantId: "participant-a", partyScope: ["Alice::1220"], observedAt: now().toISOString() };
  const final = await service.assess({ id: "IW:FINALITY:c1", transactionId: "update-1", observation: base });
  assert.equal(final.outcome, "SATISFIED"); assert.equal(final.observedPosition, "participant:participant-a:offset:42");
  const wrongSyncService = new FinalityService(new MemoryStore(), [{ ...cantonNetwork, policy: { kind: "CANTON_COMPLETION", synchronizerId: "sync-2" } }], now);
  const wrongSync = await wrongSyncService.assess({ id: "IW:FINALITY:c2", transactionId: "update-1", observation: base });
  assert.equal(wrongSync.outcome, "REJECTED");
  const invisible = await service.assess({ id: "IW:FINALITY:c3", transactionId: "update-1", observation: { ...base, partyScope: [] } });
  assert.equal(invisible.outcome, "REJECTED");
});
