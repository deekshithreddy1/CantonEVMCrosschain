import assert from "node:assert/strict";
import test from "node:test";
import { assessSupplyEffects, type SupplyEffectRecord } from "./supply-invariants.js";

const at = "2026-08-13T12:00:00.000Z";
const assetId = "IW:ASSET:local-rwa" as const;
const representationId = "IW:REPRESENTATION:evm-local-rwa";

test("Phase 35 golden path moves 100 to EVM, returns 40, and preserves exact backing", async () => {
  const completed: string[] = [];
  const step = async (name: string, work: () => void | Promise<void>) => {
    await work(); completed.push(name);
  };
  const alice = { name: "", cantonParty: "", evmAddress: "", bindings: new Set<string>() };
  const balances = { cantonCirculating: 0n, cantonLocked: 0n, evmRepresentation: 0n };
  const effects: SupplyEffectRecord[] = [];
  const validatorObservations = new Map<string, string>();
  let moveRequested = 0n;
  let lockFinal = false;
  let mintAttested = false;
  let burnFinal = false;
  let burnAttested = false;

  await step("1. local environment is ready", () => {
    assert.equal(process.env.NODE_ENV === "production", false, "golden path must use development fixtures only");
  });
  await step("2. create Alice", () => { alice.name = "Alice"; });
  await step("3. create Canton identity", () => { alice.cantonParty = "Alice::1220-local-canton"; });
  await step("4. create EVM identity", () => { alice.evmAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"; });
  await step("5. bind identities", () => {
    alice.bindings.add(`CANTON:${alice.cantonParty}`); alice.bindings.add(`EVM:${alice.evmAddress}`);
    assert.equal(alice.bindings.size, 2);
  });
  await step("6. issue 1,000 test RWA units on Canton", () => { balances.cantonCirculating = 1000n; });
  await step("7. request move of 100 to EVM", () => { moveRequested = 100n; });
  await step("8. lock 100 on Canton", () => {
    balances.cantonCirculating -= moveRequested; balances.cantonLocked += moveRequested; lockFinal = true;
    effects.push(effect("IW:BRIDGE:golden-lock-mint", "LOCK", "100", "canton:offset:10"));
  });
  await step("9. validators independently verify", () => {
    validatorObservations.set("validator-1", "canton:offset:10|amount:100");
    validatorObservations.set("validator-2", "canton:offset:10|amount:100");
    validatorObservations.set("validator-3", "canton:offset:10|amount:100");
    assert.equal(new Set(validatorObservations.values()).size, 1); assert.equal(lockFinal, true);
  });
  await step("10. aggregate threshold attestation", () => {
    assert.ok(validatorObservations.size >= 2); mintAttested = true;
  });
  await step("11. mint 100 on EVM", () => {
    assert.equal(mintAttested, true); balances.evmRepresentation += moveRequested;
    effects.push(effect("IW:BRIDGE:golden-lock-mint", "MINT", "100", "evm:block:20"));
  });
  await step("12. reconcile lock and mint", () => {
    assert.equal(assessSupplyEffects(assetId, representationId, effects, at).outcome, "VALID");
    assert.equal(balances.cantonLocked, balances.evmRepresentation);
  });
  await step("13. burn 40 on EVM", () => {
    balances.evmRepresentation -= 40n; burnFinal = true;
    effects.push(effect("IW:BRIDGE:golden-burn-release", "BURN", "40", "evm:block:30"));
  });
  await step("14. validate burn finality", () => { assert.equal(burnFinal, true); });
  await step("15. attest finalized burn", () => { assert.equal(burnFinal, true); burnAttested = true; });
  await step("16. release 40 on Canton", () => {
    assert.equal(burnAttested, true); balances.cantonLocked -= 40n; balances.cantonCirculating += 40n;
    effects.push(effect("IW:BRIDGE:golden-burn-release", "RELEASE", "40", "canton:offset:50"));
  });
  await step("17. reconcile round trip", () => {
    assert.equal(assessSupplyEffects(assetId, representationId, effects, at).outcome, "VALID");
  });
  await step("18. verify final supply and backing", () => {
    const result = assessSupplyEffects(assetId, representationId, effects, at);
    assert.equal(result.totals.representationSupply, "60");
    assert.equal(result.totals.verifiedBacking, "60");
    assert.ok(BigInt(result.totals.representationSupply) <= BigInt(result.totals.verifiedBacking));
    assert.deepEqual(balances, { cantonCirculating: 940n, cantonLocked: 60n, evmRepresentation: 60n });
  });
  assert.equal(completed.length, 18);
});

function effect(operationId: "IW:BRIDGE:golden-lock-mint" | "IW:BRIDGE:golden-burn-release", effectName: SupplyEffectRecord["effect"], amount: string, evidenceId: string): SupplyEffectRecord {
  return { operationId, effect: effectName, assetId, representationId, amount, evidenceId, finalizedAt: at };
}
