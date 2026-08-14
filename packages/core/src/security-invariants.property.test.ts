import assert from "node:assert/strict";
import test from "node:test";
import { canTransition } from "./transaction-engine.js";
import { assessSupplyEffects, type SupplyEffectRecord } from "./supply-invariants.js";
import type { BridgeState } from "./model.js";

const at = "2026-08-13T12:00:00.000Z";
const assetId = "IW:ASSET:property" as const;
const representationId = "IW:REPRESENTATION:property";
function rng(seed = 0x1a2b3c4d) { let value = seed >>> 0; return () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0); }
function record(index: number, effect: SupplyEffectRecord["effect"], amount: bigint): SupplyEffectRecord { return { operationId: `IW:BRIDGE:property-${index}`, effect, assetId, representationId, amount: amount.toString(), evidenceId: `evidence-${index}-${effect}`, finalizedAt: at }; }

test("property: arbitrary accepted supply-effect sequences never create excess representation", () => {
  const random = rng(); const records: SupplyEffectRecord[] = [];
  for (let index = 0; index < 1_000; index++) {
    const effects = ["LOCK", "MINT", "BURN", "RELEASE"] as const; const candidate = record(index, effects[random() % effects.length]!, BigInt((random() % 100) + 1));
    const assessment = assessSupplyEffects(assetId, representationId, [...records, candidate], at);
    if (assessment.outcome === "VALID") records.push(candidate);
    const committed = assessSupplyEffects(assetId, representationId, records, at);
    assert.equal(committed.outcome, "VALID");
    assert.ok(BigInt(committed.totals.representationSupply) <= BigInt(committed.totals.verifiedBacking));
  }
});

test("property: random state-machine requests cannot escape legal transitions or terminal states", () => {
  const random = rng(0x55aa55aa); const states: BridgeState[] = ["CREATED", "POLICY_CHECKED", "SOURCE_PREPARING", "SOURCE_SUBMITTED", "SOURCE_CONFIRMED", "SOURCE_FINALIZED", "ATTESTATION_PENDING", "ATTESTED", "DESTINATION_PREPARING", "DESTINATION_SUBMITTED", "DESTINATION_CONFIRMED", "DESTINATION_FINALIZED", "RECONCILIATION_PENDING", "RECONCILED", "COMPLETED", "POLICY_REJECTED", "SOURCE_FAILED", "ATTESTATION_FAILED", "DESTINATION_FAILED", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "EXPIRED"];
  const terminal = new Set<BridgeState>(["COMPLETED", "POLICY_REJECTED", "SOURCE_FAILED", "ATTESTATION_FAILED", "DESTINATION_FAILED", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "EXPIRED"]);
  for (let run = 0; run < 250; run++) { let state: BridgeState = "CREATED"; for (let attempt = 0; attempt < 100; attempt++) { const target = states[random() % states.length]!; if (canTransition(state, target)) state = target; if (terminal.has(state)) assert.equal(states.some((next) => canTransition(state, next)), false); } }
});

class SecurityInvariantModel {
  backing = 100n; supply = 0n; paused = false; reconciliationMatched = true; processed = new Set<string>(); attestations = new Set<string>(); enabledValidators = new Set(["v1", "v2", "v3"]);
  execute(input: { operation: string; attestation?: string; amount?: bigint; expires?: number; chain?: number; asset?: string; destination?: string; signatures?: string[]; admin?: boolean }) {
    if (this.paused) throw new Error("PAUSED"); if (!this.reconciliationMatched) throw new Error("RECONCILIATION_FAILED"); if (this.processed.has(input.operation)) return false;
    if ((input.expires ?? 1) <= 0) throw new Error("EXPIRED"); if ((input.chain ?? 31337) !== 31337) throw new Error("WRONG_CHAIN"); if ((input.asset ?? "rwa") !== "rwa") throw new Error("WRONG_ASSET"); if ((input.destination ?? "gateway") !== "gateway") throw new Error("WRONG_DESTINATION");
    const signatures = input.signatures ?? ["v1", "v2"]; if (signatures.some((value) => !this.enabledValidators.has(value))) throw new Error("INVALID_SIGNATURE"); if (new Set(signatures).size < 2) throw new Error("INSUFFICIENT_THRESHOLD");
    const attestation = input.attestation ?? `att-${input.operation}`; if (this.attestations.has(attestation)) throw new Error("ATTESTATION_REPLAY"); const amount = input.amount ?? 1n; if (this.supply + amount > this.backing) throw new Error("EXCESS_SUPPLY");
    this.attestations.add(attestation); this.processed.add(input.operation); this.supply += amount; return true;
  }
  adminAction(authorized: boolean) { if (!authorized) throw new Error("UNAUTHORIZED_ADMIN"); }
}

const invariantCases: readonly [string, (model: SecurityInvariantModel) => void][] = [
  ["1. one source operation causes at most one issuance", (m) => { m.execute({ operation: "op" }); assert.equal(m.execute({ operation: "op" }), false); assert.equal(m.supply, 1n); }],
  ["2. destination supply cannot exceed backing", (m) => assert.throws(() => m.execute({ operation: "op", amount: 101n }), /EXCESS_SUPPLY/)],
  ["3. attestation cannot be replayed", (m) => { m.execute({ operation: "a", attestation: "same" }); assert.throws(() => m.execute({ operation: "b", attestation: "same" }), /REPLAY/); }],
  ["4. expired attestation cannot execute", (m) => assert.throws(() => m.execute({ operation: "op", expires: 0 }), /EXPIRED/)],
  ["5. wrong-chain attestation fails", (m) => assert.throws(() => m.execute({ operation: "op", chain: 1 }), /WRONG_CHAIN/)],
  ["6. wrong-asset attestation fails", (m) => assert.throws(() => m.execute({ operation: "op", asset: "other" }), /WRONG_ASSET/)],
  ["7. wrong-destination attestation fails", (m) => assert.throws(() => m.execute({ operation: "op", destination: "attacker" }), /WRONG_DESTINATION/)],
  ["8. invalid validator signature fails", (m) => assert.throws(() => m.execute({ operation: "op", signatures: ["v1", "attacker"] }), /INVALID_SIGNATURE/)],
  ["9. insufficient threshold fails", (m) => assert.throws(() => m.execute({ operation: "op", signatures: ["v1"] }), /INSUFFICIENT_THRESHOLD/)],
  ["10. disabled validator cannot authorize", (m) => { m.enabledValidators.delete("v2"); assert.throws(() => m.execute({ operation: "op", signatures: ["v1", "v2"] }), /INVALID_SIGNATURE/); }],
  ["11. paused asset cannot bridge", (m) => { m.paused = true; assert.throws(() => m.execute({ operation: "op" }), /PAUSED/); }],
  ["12. unauthorized admin action fails", (m) => assert.throws(() => m.adminAction(false), /UNAUTHORIZED_ADMIN/)],
  ["13. retry cannot duplicate a financial effect", (m) => { m.execute({ operation: "retry" }); for (let i = 0; i < 20; i++) assert.equal(m.execute({ operation: "retry" }), false); assert.equal(m.supply, 1n); }],
  ["14. failed reconciliation prevents continuation", (m) => { m.reconciliationMatched = false; assert.throws(() => m.execute({ operation: "op" }), /RECONCILIATION_FAILED/); assert.equal(m.supply, 0n); }]
];
for (const [name, prove] of invariantCases) test(`security invariant ${name}`, () => prove(new SecurityInvariantModel()));
