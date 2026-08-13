import type { AssetId, AtomicAmount, IsoTimestamp, RepresentationId } from "./model.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { parseAtomicAmount } from "./invariants.js";
import { RegistryError } from "./registry-errors.js";

export type ReconciliationCheckId = `IW:RECONCILIATION:${string}`;
export interface IndependentSupplySnapshot {
  assetId: AssetId; representationId: RepresentationId; canonicalSupply: AtomicAmount;
  sourceCirculatingSupply: AtomicAmount; sourceLockedBacking: AtomicAmount; destinationRepresentationSupply: AtomicAmount;
  pendingLockAmount: AtomicAmount; pendingBurnAmount: AtomicAmount; completedMintAmount: AtomicAmount; completedBurnAmount: AtomicAmount; completedReleaseAmount: AtomicAmount;
  sourcePosition: string; destinationPosition: string; sourceEvidence: readonly string[]; destinationEvidence: readonly string[]; observedAt: IsoTimestamp;
}
export interface IndependentReconciliationReader { read(assetId: AssetId, representationId: RepresentationId): Promise<IndependentSupplySnapshot> }
export interface AssetSafetyController {
  degrade(assetId: AssetId, reason: string, evidenceId: ReconciliationCheckId): Promise<void>;
  blockBridgeIssuance(assetId: AssetId, reason: string, evidenceId: ReconciliationCheckId): Promise<void>;
}
export interface ReconciliationAlertSink { critical(record: ReconciliationCheck): Promise<void> }
export interface ReconciliationCheck {
  id: ReconciliationCheckId; assetId: AssetId; representationId: RepresentationId; outcome: "MATCH" | "MISMATCH";
  severity: "NONE" | "CRITICAL"; mismatchCodes: readonly string[]; snapshot: IndependentSupplySnapshot;
  evidence: readonly string[]; checkedAt: IsoTimestamp; resolution: "NONE_REQUIRED" | "OPERATOR_REQUIRED";
}
export interface ReconciliationCheckStore { save(record: ReconciliationCheck): Promise<void>; get(id: ReconciliationCheckId): Promise<ReconciliationCheck | undefined> }

export class IndependentReconciliationService {
  constructor(readonly reader: IndependentReconciliationReader, readonly store: ReconciliationCheckStore, readonly safety: AssetSafetyController, readonly alerts: ReconciliationAlertSink, readonly now: () => Date = () => new Date()) {}
  async reconcile(input: { id: ReconciliationCheckId; assetId: AssetId; representationId: RepresentationId; blockIssuanceOnMismatch?: boolean }): Promise<ReconciliationCheck> {
    if (!input.id.startsWith("IW:RECONCILIATION:") || !input.representationId.startsWith("IW:REPRESENTATION:")) throw new RegistryError("INVALID_ARGUMENT", "valid reconciliation and representation IDs are required");
    const existing = await this.store.get(input.id);
    if (existing) {
      if (existing.assetId !== input.assetId || existing.representationId !== input.representationId) throw new RegistryError("CONFLICT", "reconciliation ID was reused for another asset scope");
      await this.#applySafety(existing, input.blockIssuanceOnMismatch);
      return structuredClone(existing);
    }
    const snapshot = await this.reader.read(input.assetId, input.representationId); assertSnapshot(input, snapshot);
    const mismatchCodes = evaluate(snapshot); const mismatch = mismatchCodes.length > 0;
    const record: ReconciliationCheck = { id: input.id, assetId: input.assetId, representationId: input.representationId, outcome: mismatch ? "MISMATCH" : "MATCH", severity: mismatch ? "CRITICAL" : "NONE", mismatchCodes, snapshot: structuredClone(snapshot), evidence: [...snapshot.sourceEvidence, ...snapshot.destinationEvidence, `sourcePosition=${snapshot.sourcePosition}`, `destinationPosition=${snapshot.destinationPosition}`], checkedAt: this.now().toISOString(), resolution: mismatch ? "OPERATOR_REQUIRED" : "NONE_REQUIRED" };
    await this.store.save(record);
    await this.#applySafety(record, input.blockIssuanceOnMismatch);
    return structuredClone(record);
  }
  async #applySafety(record: ReconciliationCheck, blockIssuanceOnMismatch?: boolean) {
    if (record.outcome !== "MISMATCH") return;
    const reason = record.mismatchCodes.join(","); await this.safety.degrade(record.assetId, reason, record.id);
    if (blockIssuanceOnMismatch !== false) await this.safety.blockBridgeIssuance(record.assetId, reason, record.id);
    await this.alerts.critical(structuredClone(record));
  }
}

function evaluate(snapshot: IndependentSupplySnapshot): string[] {
  const canonical = parseAtomicAmount(snapshot.canonicalSupply), circulating = parseAtomicAmount(snapshot.sourceCirculatingSupply), locked = parseAtomicAmount(snapshot.sourceLockedBacking), destination = parseAtomicAmount(snapshot.destinationRepresentationSupply);
  const pendingLocks = parseAtomicAmount(snapshot.pendingLockAmount), pendingBurns = parseAtomicAmount(snapshot.pendingBurnAmount), minted = parseAtomicAmount(snapshot.completedMintAmount), burned = parseAtomicAmount(snapshot.completedBurnAmount), released = parseAtomicAmount(snapshot.completedReleaseAmount);
  const mismatches: string[] = [];
  if (circulating + locked !== canonical) mismatches.push("CANONICAL_SUPPLY_MISMATCH");
  if (destination > locked) mismatches.push("REPRESENTATION_EXCEEDS_BACKING");
  if (burned > minted || destination !== minted - burned) mismatches.push("DESTINATION_SUPPLY_DIFFERS_FROM_OPERATION_ACCOUNTING");
  if (released > burned) mismatches.push("RELEASE_EXCEEDS_COMPLETED_BURN");
  if (pendingLocks > canonical) mismatches.push("PENDING_LOCK_EXCEEDS_CANONICAL_SUPPLY");
  if (pendingBurns > destination) mismatches.push("PENDING_BURN_EXCEEDS_DESTINATION_SUPPLY");
  return mismatches;
}
function assertSnapshot(input: { assetId: AssetId; representationId: RepresentationId }, snapshot: IndependentSupplySnapshot): void {
  if (snapshot.assetId !== input.assetId || snapshot.representationId !== input.representationId) throw new RegistryError("INVALID_ARGUMENT", "reconciliation reader returned mismatched asset scope");
  for (const amount of [snapshot.canonicalSupply, snapshot.sourceCirculatingSupply, snapshot.sourceLockedBacking, snapshot.destinationRepresentationSupply, snapshot.pendingLockAmount, snapshot.pendingBurnAmount, snapshot.completedMintAmount, snapshot.completedBurnAmount, snapshot.completedReleaseAmount]) parseAtomicAmount(amount);
  if (!snapshot.sourcePosition.trim() || !snapshot.destinationPosition.trim() || snapshot.sourceEvidence.length === 0 || snapshot.destinationEvidence.length === 0 || !Number.isFinite(Date.parse(snapshot.observedAt))) throw new RegistryError("INVALID_ARGUMENT", "reconciliation snapshot requires positions, evidence, and timestamp");
}

type CheckRow = { record: ReconciliationCheck };
export class PostgresReconciliationCheckStore implements ReconciliationCheckStore {
  constructor(readonly db: SqlExecutor) {}
  async save(record: ReconciliationCheck) { const result = await this.db.query("INSERT INTO reconciliation_checks (id,asset_id,representation_id,outcome,record) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO NOTHING", [record.id, record.assetId, record.representationId, record.outcome, JSON.stringify(record)]); if (result.rowCount !== 1) throw new RegistryError("CONFLICT", `reconciliation check is immutable: ${record.id}`); }
  async get(id: ReconciliationCheckId) { const result = await this.db.query<CheckRow>("SELECT record FROM reconciliation_checks WHERE id=$1", [id]); const value = result.rows[0]?.record; return value ? structuredClone(value) : undefined; }
}
