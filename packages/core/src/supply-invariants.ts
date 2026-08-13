import type { AssetId, AtomicAmount, BridgeOperationId, IsoTimestamp } from "./model.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { parseAtomicAmount } from "./invariants.js";
import { RegistryError } from "./registry-errors.js";

export type SupplyEffect = "LOCK" | "MINT" | "BURN" | "RELEASE";
export interface SupplyEffectRecord {
  operationId: BridgeOperationId;
  effect: SupplyEffect;
  assetId: AssetId;
  representationId: string;
  amount: AtomicAmount;
  evidenceId: string;
  finalizedAt: IsoTimestamp;
}
export interface SupplyTotals {
  locked: AtomicAmount;
  minted: AtomicAmount;
  burned: AtomicAmount;
  released: AtomicAmount;
  verifiedBacking: AtomicAmount;
  representationSupply: AtomicAmount;
}
export interface SupplyInvariantAssessment {
  assetId: AssetId;
  representationId: string;
  totals: SupplyTotals;
  outcome: "VALID" | "VIOLATION";
  violations: readonly string[];
  assessedAt: IsoTimestamp;
}
export interface SupplyEffectStore {
  appendValidated(record: SupplyEffectRecord, assessedAt: IsoTimestamp): Promise<{ persistence: "INSERTED" | "DUPLICATE"; records: readonly SupplyEffectRecord[] }>;
  list(assetId: AssetId, representationId: string): Promise<readonly SupplyEffectRecord[]>;
}

export class SupplyInvariantLedger {
  constructor(readonly store: SupplyEffectStore, readonly now: () => Date = () => new Date()) {}

  async record(record: SupplyEffectRecord): Promise<{ persistence: "INSERTED" | "DUPLICATE"; assessment: SupplyInvariantAssessment }> {
    assertRecord(record);
    const assessedAt = this.now().toISOString(); const committed = await this.store.appendValidated(record, assessedAt);
    return { persistence: committed.persistence, assessment: assess(record.assetId, record.representationId, committed.records, assessedAt) };
  }

  async assess(assetId: AssetId, representationId: string): Promise<SupplyInvariantAssessment> {
    if (!representationId.trim()) throw new RegistryError("INVALID_ARGUMENT", "representation ID is required");
    return assess(assetId, representationId, await this.store.list(assetId, representationId), this.now().toISOString());
  }
}

export function assessSupplyEffects(assetId: AssetId, representationId: string, records: readonly SupplyEffectRecord[], assessedAt: IsoTimestamp): SupplyInvariantAssessment {
  return assess(assetId, representationId, records, assessedAt);
}

function assess(assetId: AssetId, representationId: string, records: readonly SupplyEffectRecord[], assessedAt: IsoTimestamp): SupplyInvariantAssessment {
  const seen = new Set<string>(); const violations: string[] = [];
  let locked = 0n, minted = 0n, burned = 0n, released = 0n;
  for (const record of records) {
    const key = `${record.operationId}|${record.effect}`;
    if (seen.has(key)) { violations.push("DUPLICATE_OPERATION_EFFECT"); continue; }
    seen.add(key); const amount = parseAtomicAmount(record.amount);
    if (record.effect === "LOCK") locked += amount;
    else if (record.effect === "MINT") minted += amount;
    else if (record.effect === "BURN") burned += amount;
    else released += amount;
  }
  const verifiedBacking = locked - released;
  const representationSupply = minted - burned;
  if (minted > locked) violations.push("MINT_EXCEEDS_LOCKED_BACKING");
  if (burned > minted) violations.push("BURN_EXCEEDS_MINTED_SUPPLY");
  if (released > burned) violations.push("RELEASE_EXCEEDS_VERIFIED_BURN");
  if (released > locked) violations.push("RELEASE_EXCEEDS_LOCKED_BACKING");
  if (representationSupply > verifiedBacking) violations.push("REPRESENTATION_SUPPLY_EXCEEDS_BACKING");
  const totals: SupplyTotals = { locked: locked.toString(), minted: minted.toString(), burned: burned.toString(), released: released.toString(), verifiedBacking: verifiedBacking.toString(), representationSupply: representationSupply.toString() };
  return { assetId, representationId, totals, outcome: violations.length ? "VIOLATION" : "VALID", violations: [...new Set(violations)], assessedAt };
}

function assertRecord(record: SupplyEffectRecord): void {
  if (!record.operationId.startsWith("IW:BRIDGE:") || !record.assetId.startsWith("IW:ASSET:") || !record.representationId.trim() || !record.evidenceId.trim()) throw new RegistryError("INVALID_ARGUMENT", "supply effect identifiers and evidence are required");
  if (parseAtomicAmount(record.amount) <= 0n) throw new RegistryError("INVALID_ARGUMENT", "supply effect amount must be positive");
  if (!Number.isFinite(Date.parse(record.finalizedAt))) throw new RegistryError("INVALID_ARGUMENT", "supply effect finality timestamp is invalid");
}

type SupplyRow = { record: SupplyEffectRecord; inserted?: boolean };
export class PostgresSupplyEffectStore implements SupplyEffectStore {
  constructor(readonly db: SqlExecutor) {}
  async appendValidated(record: SupplyEffectRecord, assessedAt: IsoTimestamp) {
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${record.assetId}|${record.representationId}`]);
      const selected = await client.query<SupplyRow>("SELECT record FROM supply_effects WHERE asset_id=$1 AND representation_id=$2 ORDER BY finalized_at,operation_id,effect", [record.assetId, record.representationId]);
      const records = selected.rows.map((row) => structuredClone(row.record)); const prior = records.find((item) => item.operationId === record.operationId && item.effect === record.effect);
      if (prior) { if (JSON.stringify(prior) !== JSON.stringify(record)) throw new RegistryError("CONFLICT", `operation effect was reused with different evidence: ${record.operationId}/${record.effect}`); return { persistence: "DUPLICATE" as const, records }; }
      const candidate = [...records, structuredClone(record)]; const assessment = assess(record.assetId, record.representationId, candidate, assessedAt);
      if (assessment.outcome === "VIOLATION") throw new RegistryError("CONFLICT", `supply invariant violation: ${assessment.violations.join(",")}`);
      await client.query("INSERT INTO supply_effects (operation_id,effect,asset_id,representation_id,record,finalized_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [record.operationId, record.effect, record.assetId, record.representationId, JSON.stringify(record), record.finalizedAt]);
      return { persistence: "INSERTED" as const, records: candidate };
    });
  }
  async list(assetId: AssetId, representationId: string) { const result = await this.db.query<SupplyRow>("SELECT record FROM supply_effects WHERE asset_id=$1 AND representation_id=$2 ORDER BY finalized_at,operation_id,effect", [assetId, representationId]); return result.rows.map((row) => structuredClone(row.record)); }
}
