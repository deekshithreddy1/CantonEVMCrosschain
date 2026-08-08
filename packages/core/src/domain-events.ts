import { createHash } from "node:crypto";
import type { AssetId, IsoTimestamp, NetworkId } from "./model.js";
import type { CantonEvent } from "./canton-adapter.js";
import type { EvmLog, ParsedEvmEvent } from "./evm-adapter.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { RegistryError } from "./registry-errors.js";

export type DomainEventId = `IW:EVENT:${string}`;
export type DomainEventType = "AssetIssued" | "AssetBurned" | "AssetTransferred" | "AssetLocked" | "AssetReleased" | "SettlementCreated" | "SettlementCompleted" | "SettlementFailed" | "AttestationCreated" | "BridgeCompleted";
export interface NormalizedEventPayload { readonly [key: string]: string | boolean | null | readonly string[] }
export interface NormalizedDomainEvent {
  schemaVersion: "1";
  id: DomainEventId;
  type: DomainEventType;
  networkId: NetworkId;
  networkType: "CANTON" | "EVM";
  networkTransactionId: string;
  assetId: AssetId;
  position: { kind: "CANTON_OFFSET"; offset: string; eventIndex: string } | { kind: "EVM_LOG"; blockNumber: string; blockHash: string; logIndex: string };
  sourceEventKey: string;
  eventTimestamp: IsoTimestamp;
  payload: NormalizedEventPayload;
  ingestionTimestamp: IsoTimestamp;
  observation: "CANONICAL" | "REMOVED";
  provenance: Readonly<Record<string, string>>;
}

export interface DecodedDomainEvent { type: DomainEventType; assetId: AssetId; payload: NormalizedEventPayload }
export interface CantonDomainEventDecoder { decode(event: CantonEvent): DecodedDomainEvent | undefined }
export interface EvmDomainEventDecoder { decode(event: ParsedEvmEvent): DecodedDomainEvent | undefined }

function stableEventId(networkId: NetworkId, sourceEventKey: string): DomainEventId { return `IW:EVENT:${createHash("sha256").update(`${networkId}|${sourceEventKey}`).digest("hex")}`; }
function assertTimestamp(value: string, name: string): void { if (!Number.isFinite(Date.parse(value))) throw new RegistryError("INVALID_ARGUMENT", `${name} must be a valid timestamp`); }
function assertDecoded(decoded: DecodedDomainEvent): void { if (!decoded.assetId.startsWith("IW:ASSET:") || Object.keys(decoded.payload).length === 0) throw new RegistryError("INVALID_ARGUMENT", "decoded events require a logical asset and non-empty payload"); }

export class CantonEventNormalizer {
  constructor(readonly networkId: NetworkId, readonly decoder: CantonDomainEventDecoder) {}
  normalize(event: CantonEvent, input: { eventIndex: string; eventTimestamp: IsoTimestamp; ingestionTimestamp: IsoTimestamp; participantId: string }): NormalizedDomainEvent | undefined {
    const decoded = this.decoder.decode(event); if (!decoded) return undefined; assertDecoded(decoded); assertTimestamp(input.eventTimestamp, "event timestamp"); assertTimestamp(input.ingestionTimestamp, "ingestion timestamp");
    if (!event.transactionId.trim() || !event.offset.trim() || !input.eventIndex.trim()) throw new RegistryError("INVALID_ARGUMENT", "Canton event transaction, offset, and event index are required");
    const sourceEventKey = `canton:${event.transactionId}:${event.offset}:${input.eventIndex}`;
    return { schemaVersion: "1", id: stableEventId(this.networkId, sourceEventKey), type: decoded.type, networkId: this.networkId, networkType: "CANTON", networkTransactionId: event.transactionId, assetId: decoded.assetId, position: { kind: "CANTON_OFFSET", offset: event.offset, eventIndex: input.eventIndex }, sourceEventKey, eventTimestamp: input.eventTimestamp, payload: structuredClone(decoded.payload), ingestionTimestamp: input.ingestionTimestamp, observation: "CANONICAL", provenance: { participantId: input.participantId, templateOrInterfaceId: event.templateOrInterfaceId, witnessedBy: [...event.witnessedBy].sort().join(",") } };
  }
}

export class EvmEventNormalizer {
  constructor(readonly networkId: NetworkId, readonly decoder: EvmDomainEventDecoder) {}
  normalize(event: ParsedEvmEvent, input: { blockTimestamp: IsoTimestamp; ingestionTimestamp: IsoTimestamp; chainId: string }): NormalizedDomainEvent | undefined {
    const decoded = this.decoder.decode(event); if (!decoded) return undefined; assertDecoded(decoded); assertTimestamp(input.blockTimestamp, "block timestamp"); assertTimestamp(input.ingestionTimestamp, "ingestion timestamp");
    const log = event.log; const sourceEventKey = `evm:${log.transactionHash.toLowerCase()}:${log.logIndex.toString()}`;
    return { schemaVersion: "1", id: stableEventId(this.networkId, sourceEventKey), type: decoded.type, networkId: this.networkId, networkType: "EVM", networkTransactionId: log.transactionHash, assetId: decoded.assetId, position: { kind: "EVM_LOG", blockNumber: log.blockNumber.toString(), blockHash: log.blockHash, logIndex: log.logIndex.toString() }, sourceEventKey, eventTimestamp: input.blockTimestamp, payload: structuredClone(decoded.payload), ingestionTimestamp: input.ingestionTimestamp, observation: log.removed ? "REMOVED" : "CANONICAL", provenance: { chainId: input.chainId, contractAddress: event.address, eventSignature: event.signature } };
  }
}

export interface IndexerCheckpoint { indexerId: string; networkId: NetworkId; cursor: string; sequence: string; updatedAt: IsoTimestamp }
export interface DomainEventStore {
  ingest(event: NormalizedDomainEvent): Promise<"INSERTED" | "DUPLICATE">;
  get(id: DomainEventId): Promise<NormalizedDomainEvent | undefined>;
  loadCheckpoint(indexerId: string, networkId: NetworkId): Promise<IndexerCheckpoint | undefined>;
  saveCheckpoint(checkpoint: IndexerCheckpoint, expectedSequence?: string): Promise<IndexerCheckpoint>;
}

type EventRow = { event: NormalizedDomainEvent };
type CheckpointRow = { checkpoint: IndexerCheckpoint };
export class PostgresDomainEventStore implements DomainEventStore {
  constructor(readonly db: SqlExecutor) {}
  async ingest(event: NormalizedDomainEvent): Promise<"INSERTED" | "DUPLICATE"> {
    const result = await this.db.query("INSERT INTO normalized_events (id, network_id, source_event_key, event_type, event) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (network_id,source_event_key) DO NOTHING", [event.id, event.networkId, event.sourceEventKey, event.type, JSON.stringify(event)]); return result.rowCount === 1 ? "INSERTED" : "DUPLICATE";
  }
  async get(id: DomainEventId): Promise<NormalizedDomainEvent | undefined> { const result = await this.db.query<EventRow>("SELECT event FROM normalized_events WHERE id=$1", [id]); const event = result.rows[0]?.event; return event ? structuredClone(event) : undefined; }
  async loadCheckpoint(indexerId: string, networkId: NetworkId): Promise<IndexerCheckpoint | undefined> { const result = await this.db.query<CheckpointRow>("SELECT checkpoint FROM indexer_checkpoints WHERE indexer_id=$1 AND network_id=$2", [indexerId, networkId]); const checkpoint = result.rows[0]?.checkpoint; return checkpoint ? structuredClone(checkpoint) : undefined; }
  async saveCheckpoint(checkpoint: IndexerCheckpoint, expectedSequence?: string): Promise<IndexerCheckpoint> {
    if (!/^(0|[1-9][0-9]*)$/.test(checkpoint.sequence)) throw new RegistryError("INVALID_ARGUMENT", "checkpoint sequence must be a non-negative integer string"); assertTimestamp(checkpoint.updatedAt, "checkpoint timestamp");
    return this.db.transaction(async (client) => {
      const found = await client.query<CheckpointRow>("SELECT checkpoint FROM indexer_checkpoints WHERE indexer_id=$1 AND network_id=$2 FOR UPDATE", [checkpoint.indexerId, checkpoint.networkId]); const current = found.rows[0]?.checkpoint;
      if (expectedSequence !== undefined && current?.sequence !== expectedSequence) throw new RegistryError("CONFLICT", "stale checkpoint sequence");
      if (current && BigInt(checkpoint.sequence) < BigInt(current.sequence)) throw new RegistryError("CONFLICT", "checkpoint cannot move backwards");
      await client.query("INSERT INTO indexer_checkpoints (indexer_id,network_id,sequence,checkpoint) VALUES ($1,$2,$3::numeric,$4::jsonb) ON CONFLICT (indexer_id,network_id) DO UPDATE SET sequence=EXCLUDED.sequence, checkpoint=EXCLUDED.checkpoint, updated_at=now()", [checkpoint.indexerId, checkpoint.networkId, checkpoint.sequence, JSON.stringify(checkpoint)]); return structuredClone(checkpoint);
    });
  }
}

export interface EventBatchItem<Source> { source: Source; sequence: string }
export class CheckpointedEventProcessor<Source> {
  constructor(readonly store: DomainEventStore, readonly indexerId: string, readonly networkId: NetworkId, readonly normalize: (source: Source) => NormalizedDomainEvent | undefined, readonly now: () => Date) {}
  async process(items: readonly EventBatchItem<Source>[]): Promise<{ inserted: number; duplicates: number; checkpoint?: IndexerCheckpoint }> {
    let inserted = 0; let duplicates = 0; let checkpoint = await this.store.loadCheckpoint(this.indexerId, this.networkId);
    for (const item of items) {
      if (!/^(0|[1-9][0-9]*)$/.test(item.sequence)) throw new RegistryError("INVALID_ARGUMENT", "event sequence must be an integer string");
      if (checkpoint && BigInt(item.sequence) <= BigInt(checkpoint.sequence)) continue;
      const event = this.normalize(item.source); if (event) (await this.store.ingest(event)) === "INSERTED" ? inserted++ : duplicates++;
      const next: IndexerCheckpoint = { indexerId: this.indexerId, networkId: this.networkId, cursor: event?.sourceEventKey ?? `skipped:${item.sequence}`, sequence: item.sequence, updatedAt: this.now().toISOString() };
      checkpoint = await this.store.saveCheckpoint(next, checkpoint?.sequence);
    }
    return checkpoint ? { inserted, duplicates, checkpoint } : { inserted, duplicates };
  }
}
