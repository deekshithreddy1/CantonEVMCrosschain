import assert from "node:assert/strict";
import test from "node:test";
import type { SupplyEffectRecord, SupplyEffectStore } from "./supply-invariants.js";
import { assessSupplyEffects, SupplyInvariantLedger } from "./supply-invariants.js";
import { RegistryError } from "./registry-errors.js";

class MemoryStore implements SupplyEffectStore {
  values: SupplyEffectRecord[] = [];
  async appendValidated(record: SupplyEffectRecord, assessedAt: string) { const prior = this.values.find((item) => item.operationId === record.operationId && item.effect === record.effect); if (prior) { if (JSON.stringify(prior) !== JSON.stringify(record)) throw new RegistryError("CONFLICT", "operation effect was reused with different evidence"); return { persistence: "DUPLICATE" as const, records: this.values.map((item) => structuredClone(item)) }; } const candidate = [...this.values, structuredClone(record)]; const assessment = assessSupplyEffects(record.assetId, record.representationId, candidate, assessedAt); if (assessment.outcome === "VIOLATION") throw new RegistryError("CONFLICT", `supply invariant violation: ${assessment.violations.join(",")}`); this.values = candidate; return { persistence: "INSERTED" as const, records: candidate.map((item) => structuredClone(item)) }; }
  async list(assetId: SupplyEffectRecord["assetId"], representationId: string) { return this.values.filter((item) => item.assetId === assetId && item.representationId === representationId).map((item) => structuredClone(item)); }
}
const at = "2026-08-12T12:00:00.000Z"; const assetId = "IW:ASSET:rwa" as const; const representationId = "IW:REPRESENTATION:evm-rwa";
const effect = (operation: string, kind: SupplyEffectRecord["effect"], amount: string): SupplyEffectRecord => ({ operationId: `IW:BRIDGE:${operation}`, effect: kind, assetId, representationId, amount, evidenceId: `evidence:${operation}:${kind}`, finalizedAt: at });

test("lock 100, mint 100, burn 40, release 40 preserves 60 supply and 60 backing", async () => {
  const ledger = new SupplyInvariantLedger(new MemoryStore(), () => new Date(at));
  for (const record of [effect("forward", "LOCK", "100"), effect("forward", "MINT", "100"), effect("reverse", "BURN", "40"), effect("reverse", "RELEASE", "40")]) assert.equal((await ledger.record(record)).assessment.outcome, "VALID");
  const result = await ledger.assess(assetId, representationId);
  assert.deepEqual(result.totals, { locked: "100", minted: "100", burned: "40", released: "40", verifiedBacking: "60", representationSupply: "60" });
});

test("one source operation cannot create duplicate issuance and identical retry is idempotent", async () => {
  const store = new MemoryStore(); const ledger = new SupplyInvariantLedger(store, () => new Date(at));
  await ledger.record(effect("forward", "LOCK", "100")); const mint = effect("forward", "MINT", "100");
  assert.equal((await ledger.record(mint)).persistence, "INSERTED"); assert.equal((await ledger.record(mint)).persistence, "DUPLICATE"); assert.equal(store.values.length, 2);
  await assert.rejects(() => ledger.record({ ...mint, amount: "99" }), /different evidence/);
});

test("excess mint, burn, and release are rejected before persistence", async () => {
  const store = new MemoryStore(); const ledger = new SupplyInvariantLedger(store, () => new Date(at)); await ledger.record(effect("forward", "LOCK", "100"));
  await assert.rejects(() => ledger.record(effect("forward", "MINT", "101")), /MINT_EXCEEDS_LOCKED_BACKING/);
  await ledger.record(effect("forward", "MINT", "100"));
  await assert.rejects(() => ledger.record(effect("reverse", "BURN", "101")), /BURN_EXCEEDS_MINTED_SUPPLY/);
  await ledger.record(effect("reverse", "BURN", "40"));
  await assert.rejects(() => ledger.record(effect("reverse", "RELEASE", "41")), /RELEASE_EXCEEDS_VERIFIED_BURN/);
  assert.equal(store.values.length, 3);
});

test("deterministic operation sequences preserve backing property across many amounts", () => {
  for (let locked = 1n; locked <= 64n; locked++) for (let burned = 0n; burned <= locked; burned++) {
    const records = [effect(`lock-${locked}`, "LOCK", locked.toString()), effect(`mint-${locked}`, "MINT", locked.toString())];
    if (burned > 0n) records.push(effect(`burn-${locked}-${burned}`, "BURN", burned.toString()), effect(`release-${locked}-${burned}`, "RELEASE", burned.toString()));
    const result = assessSupplyEffects(assetId, representationId, records, at);
    assert.equal(result.outcome, "VALID"); assert.equal(BigInt(result.totals.representationSupply) <= BigInt(result.totals.verifiedBacking), true);
  }
});
