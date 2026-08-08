import assert from "node:assert/strict";
import test from "node:test";
import { CantonEventNormalizer, CheckpointedEventProcessor, EvmEventNormalizer } from "./domain-events.js";
import type { DomainEventId, DomainEventStore, IndexerCheckpoint, NormalizedDomainEvent } from "./domain-events.js";
import type { CantonEvent } from "./canton-adapter.js";
import type { ParsedEvmEvent } from "./evm-adapter.js";
import { RegistryError } from "./registry-errors.js";

const networkId = "IW:NETWORK:evm-test" as const; const assetId = "IW:ASSET:usd" as const;
const parsed: ParsedEvmEvent = { name: "Transfer", signature: "Transfer(address,address,uint256)", address: "0x0000000000000000000000000000000000000001", arguments: { from: "alice", to: "bob", value: 5n }, log: { address: "0x0000000000000000000000000000000000000001", topics: [], data: "0x", blockNumber: 10n, blockHash: `0x${"a".repeat(64)}`, transactionHash: `0x${"b".repeat(64)}`, logIndex: 2n, removed: false } };

test("EVM normalization produces stable identity and preserves reorg removals", () => {
  const normalizer = new EvmEventNormalizer(networkId, { decode: () => ({ type: "AssetTransferred", assetId, payload: { from: "alice", to: "bob", amount: "5" } }) });
  const input = { blockTimestamp: "2026-08-08T00:00:00.000Z", ingestionTimestamp: "2026-08-08T00:00:01.000Z", chainId: "1" };
  const first = normalizer.normalize(parsed, input); const repeated = normalizer.normalize(structuredClone(parsed), input);
  assert.equal(first?.id, repeated?.id); assert.equal(first?.position.kind, "EVM_LOG");
  const removed = normalizer.normalize({ ...parsed, log: { ...parsed.log, removed: true } }, input); assert.equal(removed?.id, first?.id); assert.equal(removed?.observation, "REMOVED");
});

test("Canton normalization includes offset, event index, and visibility provenance", () => {
  const event: CantonEvent = { offset: "42", transactionId: "tx-canton", kind: "CREATED", templateOrInterfaceId: "Token:Transfer", payload: {}, witnessedBy: ["Bob::p", "Alice::p"] };
  const normalizer = new CantonEventNormalizer("IW:NETWORK:canton", { decode: () => ({ type: "AssetReleased", assetId, payload: { owner: "bob", amount: "5" } }) });
  const normalized = normalizer.normalize(event, { eventIndex: "0", eventTimestamp: "2026-08-08T00:00:00.000Z", ingestionTimestamp: "2026-08-08T00:00:01.000Z", participantId: "participant-1" });
  assert.equal(normalized?.position.kind, "CANTON_OFFSET"); assert.equal(normalized?.provenance.witnessedBy, "Alice::p,Bob::p");
});

class TestEventStore implements DomainEventStore {
  readonly events = new Map<string, NormalizedDomainEvent>(); readonly checkpoints = new Map<string, IndexerCheckpoint>();
  async ingest(event: NormalizedDomainEvent): Promise<"INSERTED" | "DUPLICATE"> { const key = `${event.networkId}|${event.sourceEventKey}`; if (this.events.has(key)) return "DUPLICATE"; this.events.set(key, structuredClone(event)); return "INSERTED"; }
  async get(id: DomainEventId): Promise<NormalizedDomainEvent | undefined> { const event = [...this.events.values()].find((item) => item.id === id); return event ? structuredClone(event) : undefined; }
  async loadCheckpoint(indexerId: string, id: typeof networkId): Promise<IndexerCheckpoint | undefined> { const value = this.checkpoints.get(`${indexerId}|${id}`); return value ? structuredClone(value) : undefined; }
  async saveCheckpoint(checkpoint: IndexerCheckpoint, expected?: string): Promise<IndexerCheckpoint> { const key = `${checkpoint.indexerId}|${checkpoint.networkId}`; const current = this.checkpoints.get(key); if (expected !== undefined && current?.sequence !== expected) throw new RegistryError("CONFLICT", "stale"); if (current && BigInt(checkpoint.sequence) < BigInt(current.sequence)) throw new RegistryError("CONFLICT", "backwards"); this.checkpoints.set(key, structuredClone(checkpoint)); return structuredClone(checkpoint); }
}

test("deduplication and persisted checkpoints make reprocessing safe", async () => {
  const normalizer = new EvmEventNormalizer(networkId, { decode: () => ({ type: "AssetTransferred", assetId, payload: { amount: "5" } }) }); const store = new TestEventStore();
  const normalize = (source: ParsedEvmEvent) => normalizer.normalize(source, { blockTimestamp: "2026-08-08T00:00:00.000Z", ingestionTimestamp: "2026-08-08T00:00:01.000Z", chainId: "1" });
  const first = new CheckpointedEventProcessor(store, "evm-indexer", networkId, normalize, () => new Date("2026-08-08T00:00:02.000Z"));
  assert.deepEqual(await first.process([{ source: parsed, sequence: "1" }]), { inserted: 1, duplicates: 0, checkpoint: { indexerId: "evm-indexer", networkId, cursor: `evm:${parsed.log.transactionHash}:2`, sequence: "1", updatedAt: "2026-08-08T00:00:02.000Z" } });
  const restarted = new CheckpointedEventProcessor(store, "evm-indexer", networkId, normalize, () => new Date("2026-08-08T00:00:03.000Z"));
  const result = await restarted.process([{ source: parsed, sequence: "1" }, { source: parsed, sequence: "2" }]); assert.equal(result.inserted, 0); assert.equal(result.duplicates, 1); assert.equal(result.checkpoint?.sequence, "2"); assert.equal(store.events.size, 1);
});
