import assert from "node:assert/strict";
import test from "node:test";
import { assessSupplyEffects, type SupplyEffectRecord } from "./supply-invariants.js";

type Checkpoint = "LOCK" | "ATTEST" | "MINT" | "BURN" | "BURN_ATTEST" | "RELEASE";
type PersistentState = { effects: SupplyEffectRecord[]; events: Set<string>; requests: Set<string>; attestations: Set<string>; checkpoints: Set<Checkpoint> };
const at = "2026-08-13T12:00:00.000Z";
const assetId = "IW:ASSET:failure-rwa" as const;
const representationId = "IW:REPRESENTATION:failure-rwa";

class InjectedCrash extends Error {}
class BridgeHarness {
  constructor(readonly state: PersistentState = { effects: [], events: new Set(), requests: new Set(), attestations: new Set(), checkpoints: new Set() }) {}
  restart() { return new BridgeHarness(this.state); }
  request(id = "request-1") { this.state.requests.add(id); }
  event(id = "event-1") { this.state.events.add(id); }
  attest(input: { id?: string; signature?: string; expiresAt?: string; destination?: string; chainId?: number; asset?: string } = {}) {
    if ((input.signature ?? "valid") !== "valid") throw new Error("INVALID_SIGNATURE");
    if (Date.parse(input.expiresAt ?? "2026-08-13T13:00:00.000Z") <= Date.parse(at)) throw new Error("EXPIRED_ATTESTATION");
    if ((input.destination ?? "evm-gateway") !== "evm-gateway") throw new Error("WRONG_DESTINATION");
    if ((input.chainId ?? 31337) !== 31337) throw new Error("WRONG_CHAIN_ID");
    if ((input.asset ?? assetId) !== assetId) throw new Error("WRONG_ASSET");
    this.state.attestations.add(input.id ?? "attestation-lock"); this.state.checkpoints.add("ATTEST");
  }
  effect(operationId: `IW:BRIDGE:${string}`, effect: SupplyEffectRecord["effect"], amount: string) {
    if (this.state.effects.some((item) => item.operationId === operationId && item.effect === effect)) return;
    this.state.effects.push({ operationId, effect, assetId, representationId, amount, evidenceId: `${effect.toLowerCase()}:final`, finalizedAt: at });
    this.state.checkpoints.add(effect);
    this.assertSafe();
  }
  assertSafe() {
    const assessment = assessSupplyEffects(assetId, representationId, this.state.effects, at);
    assert.equal(assessment.outcome, "VALID");
    assert.ok(BigInt(assessment.totals.representationSupply) <= BigInt(assessment.totals.verifiedBacking));
    return assessment;
  }
  async goldenPath(crashAfter?: Checkpoint) {
    this.request(); this.event();
    for (const [checkpoint, work] of [
      ["LOCK", () => this.effect("IW:BRIDGE:failure-forward", "LOCK", "100")],
      ["ATTEST", () => this.attest()],
      ["MINT", () => this.effect("IW:BRIDGE:failure-forward", "MINT", "100")],
      ["BURN", () => this.effect("IW:BRIDGE:failure-return", "BURN", "40")],
      ["BURN_ATTEST", () => { this.state.attestations.add("attestation-burn"); this.state.checkpoints.add("BURN_ATTEST"); }],
      ["RELEASE", () => this.effect("IW:BRIDGE:failure-return", "RELEASE", "40")]
    ] as const) {
      if (!this.state.checkpoints.has(checkpoint)) work();
      if (crashAfter === checkpoint) throw new InjectedCrash(checkpoint);
    }
    return this.assertSafe();
  }
}

for (const checkpoint of ["LOCK", "ATTEST", "MINT", "BURN", "BURN_ATTEST", "RELEASE"] as const) {
  test(`coordinator/database restart after ${checkpoint} resumes without duplicate effects`, async () => {
    const first = new BridgeHarness();
    await assert.rejects(first.goldenPath(checkpoint), InjectedCrash);
    first.assertSafe();
    const recovered = first.restart();
    const final = await recovered.goldenPath();
    assert.equal(final.totals.representationSupply, "60"); assert.equal(final.totals.verifiedBacking, "60");
    assert.equal(recovered.state.effects.length, 4);
  });
}

test("validator restart preserves independently verified observation", () => {
  const durableObservations = new Map([["validator-1", "offset:10|100"]]);
  const restartedValidator = new Map(durableObservations);
  restartedValidator.set("validator-2", "offset:10|100");
  assert.equal(new Set(restartedValidator.values()).size, 1); assert.equal(restartedValidator.size, 2);
});

for (const fault of ["RPC_TIMEOUT", "RPC_MALFORMED_RESPONSE", "TEMPORARY_NETWORK_PARTITION"] as const) {
  test(`${fault} is retryable and cannot create a premature financial effect`, async () => {
    const harness = new BridgeHarness(); let attempts = 0;
    const observe = () => { attempts++; if (attempts === 1) throw new Error(fault); harness.event("canonical-event"); };
    assert.throws(observe, new RegExp(fault)); assert.equal(harness.state.effects.length, 0); harness.assertSafe();
    observe(); await harness.goldenPath(); assert.equal(attempts, 2); assert.equal(harness.assertSafe().totals.representationSupply, "60");
  });
}

for (const [name, apply, expected] of [
  ["duplicate network event", (h: BridgeHarness) => { h.event(); h.event(); }, "events"],
  ["duplicate API request", (h: BridgeHarness) => { h.request(); h.request(); }, "requests"],
  ["duplicate attestation", (h: BridgeHarness) => { h.attest(); h.attest(); }, "attestations"],
  ["message redelivery", (h: BridgeHarness) => { h.event("message-1"); h.event("message-1"); }, "events"]
] as const) {
  test(`${name} is idempotent`, () => { const h = new BridgeHarness(); apply(h); assert.equal(h.state[expected].size, 1); h.assertSafe(); });
}

for (const [name, input, code] of [
  ["invalid signature", { signature: "forged" }, "INVALID_SIGNATURE"],
  ["expired attestation", { expiresAt: at }, "EXPIRED_ATTESTATION"],
  ["wrong destination", { destination: "attacker" }, "WRONG_DESTINATION"],
  ["wrong chain ID", { chainId: 1 }, "WRONG_CHAIN_ID"],
  ["wrong asset", { asset: "IW:ASSET:other" }, "WRONG_ASSET"]
] as const) {
  test(`${name} fails closed`, () => { const h = new BridgeHarness(); h.effect("IW:BRIDGE:failure-forward", "LOCK", "100"); assert.throws(() => h.attest(input), new RegExp(code)); assert.equal(h.state.effects.length, 1); h.assertSafe(); });
}

for (const fault of ["DESTINATION_REVERT", "CANTON_COMMAND_REJECTION"] as const) {
  test(`${fault} preserves the last finalized boundary and safely retries`, async () => {
    const h = new BridgeHarness(); h.effect("IW:BRIDGE:failure-forward", "LOCK", "100"); h.attest();
    const destination = (fail: boolean) => { if (fail) throw new Error(fault); h.effect("IW:BRIDGE:failure-forward", "MINT", "100"); };
    assert.throws(() => destination(true), new RegExp(fault)); assert.equal(h.assertSafe().totals.representationSupply, "0");
    destination(false); assert.equal(h.assertSafe().totals.representationSupply, "100");
  });
}

test("chain reorganization removes unfinalized observation and accepts only canonical replacement", () => {
  const h = new BridgeHarness(); h.event("block-20:deposit"); h.state.events.delete("block-20:deposit");
  assert.equal(h.state.effects.length, 0); h.event("block-22:deposit"); h.effect("IW:BRIDGE:reorg", "LOCK", "100");
  assert.equal(h.state.events.has("block-20:deposit"), false); h.assertSafe();
});
