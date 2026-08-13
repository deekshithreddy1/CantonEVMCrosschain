import assert from "node:assert/strict";
import test from "node:test";
import type { AssetSafetyController, IndependentSupplySnapshot, ReconciliationAlertSink, ReconciliationCheck, ReconciliationCheckId, ReconciliationCheckStore } from "./reconciliation-service.js";
import { IndependentReconciliationService } from "./reconciliation-service.js";

class Store implements ReconciliationCheckStore { values = new Map<ReconciliationCheckId, ReconciliationCheck>(); async save(value: ReconciliationCheck) { if (this.values.has(value.id)) throw new Error("duplicate"); this.values.set(value.id, structuredClone(value)); } async get(id: ReconciliationCheckId) { const value = this.values.get(id); return value ? structuredClone(value) : undefined; } }
const snapshot: IndependentSupplySnapshot = { assetId: "IW:ASSET:rwa", representationId: "IW:REPRESENTATION:evm-rwa", canonicalSupply: "1000", sourceCirculatingSupply: "940", sourceLockedBacking: "60", destinationRepresentationSupply: "60", pendingLockAmount: "0", pendingBurnAmount: "0", completedMintAmount: "100", completedBurnAmount: "40", completedReleaseAmount: "40", sourcePosition: "canton:offset:100", destinationPosition: "evm:finalized:200", sourceEvidence: ["canton-query:abc"], destinationEvidence: ["evm-call:def"], observedAt: "2026-08-12T12:00:00.000Z" };
function fixture(value: IndependentSupplySnapshot, blockIssuanceOnMismatch = true) {
  const actions: string[] = []; const store = new Store();
  const safety: AssetSafetyController = { degrade: async () => { actions.push("degrade"); }, blockBridgeIssuance: async () => { actions.push("block"); } };
  const alerts: ReconciliationAlertSink = { critical: async () => { actions.push("alert"); } };
  const service = new IndependentReconciliationService({ read: async () => structuredClone(value) }, store, safety, alerts, () => new Date("2026-08-12T12:01:00.000Z"));
  return { service, store, actions, blockIssuanceOnMismatch };
}

test("independent reconciliation matches a 100 mint, 40 burn/release round trip", async () => {
  const value = fixture(snapshot); const result = await value.service.reconcile({ id: "IW:RECONCILIATION:one", assetId: snapshot.assetId, representationId: snapshot.representationId });
  assert.equal(result.outcome, "MATCH"); assert.deepEqual(result.mismatchCodes, []); assert.deepEqual(value.actions, []); assert.equal((await value.store.get(result.id))?.outcome, "MATCH");
});

test("critical excess representation degrades asset, blocks issuance, alerts, and preserves evidence", async () => {
  const value = fixture({ ...snapshot, destinationRepresentationSupply: "61" });
  const result = await value.service.reconcile({ id: "IW:RECONCILIATION:mismatch", assetId: snapshot.assetId, representationId: snapshot.representationId });
  assert.equal(result.outcome, "MISMATCH"); assert.equal(result.resolution, "OPERATOR_REQUIRED"); assert.deepEqual(value.actions, ["degrade", "block", "alert"]);
  assert.equal(result.mismatchCodes.includes("REPRESENTATION_EXCEEDS_BACKING"), true); assert.equal(result.evidence.length, 4);
});

test("reconciliation never silently repairs and configurable policy may alert without automatic issuance block", async () => {
  const value = fixture({ ...snapshot, sourceCirculatingSupply: "939" });
  const result = await value.service.reconcile({ id: "IW:RECONCILIATION:manual", assetId: snapshot.assetId, representationId: snapshot.representationId, blockIssuanceOnMismatch: false });
  assert.equal(result.outcome, "MISMATCH"); assert.deepEqual(value.actions, ["degrade", "alert"]); assert.equal(result.mismatchCodes.includes("CANONICAL_SUPPLY_MISMATCH"), true);
});

test("retry resumes safety controls from the immutable persisted mismatch", async () => {
  const value = fixture({ ...snapshot, destinationRepresentationSupply: "61" }); const input = { id: "IW:RECONCILIATION:retry" as const, assetId: snapshot.assetId, representationId: snapshot.representationId };
  await value.service.reconcile(input); value.actions.length = 0;
  const replay = await value.service.reconcile(input); assert.equal(replay.outcome, "MISMATCH"); assert.deepEqual(value.actions, ["degrade", "block", "alert"]);
});
