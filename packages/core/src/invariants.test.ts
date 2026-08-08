import assert from "node:assert/strict";
import test from "node:test";
import { assertSupplyInvariant, assertTransitionChain, parseAtomicAmount } from "./invariants.js";

test("amounts use exact integer strings", () => {
  assert.equal(parseAtomicAmount("100000000000000000000"), 100000000000000000000n);
  for (const invalid of ["-1", "1.2", "01", "", "1e18"]) assert.throws(() => parseAtomicAmount(invalid));
});

test("wrapped supply cannot exceed verified backing", () => {
  assert.doesNotThrow(() => assertSupplyInvariant("60", "60"));
  assert.throws(() => assertSupplyInvariant("61", "60"), /exceeds/);
});

test("transition history must be continuous", () => {
  const time = "2026-08-08T00:00:00.000Z";
  assert.doesNotThrow(() => assertTransitionChain([
    { from: null, to: "CREATED", occurredAt: time, reason: "request", actor: "api" },
    { from: "CREATED", to: "POLICY_CHECKED", occurredAt: time, reason: "allowed", actor: "coordinator" }
  ]));
  assert.throws(() => assertTransitionChain([
    { from: null, to: "CREATED", occurredAt: time, reason: "request", actor: "api" },
    { from: "SOURCE_SUBMITTED", to: "SOURCE_CONFIRMED", occurredAt: time, reason: "receipt", actor: "coordinator" }
  ]), /disconnected/);
});
