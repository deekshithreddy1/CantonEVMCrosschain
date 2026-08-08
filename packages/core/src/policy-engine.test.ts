import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicPolicyEngine, InMemoryPolicyRegistry, TransferPolicyPreflight } from "./policy-engine.js";
import type { PolicyDefinition, PolicyInput } from "./policy-engine.js";

const policy: PolicyDefinition = {
  id: "IW:POLICY:transfer", version: "1.0.0", status: "ACTIVE", documentHash: "sha256:test", createdAt: "2026-08-08T00:00:00.000Z",
  defaultOutcome: "DENY", defaultReasonCode: "NO_ALLOW_RULE",
  rules: [
    { id: "allow-small", when: { kind: "AMOUNT_AT_MOST", amount: "100" }, outcome: "ALLOW", reasonCode: "WITHIN_LIMIT" },
    { id: "approve-large", when: { kind: "AMOUNT_GREATER_THAN", amount: "100" }, outcome: "REQUIRES_APPROVAL", reasonCode: "LIMIT_APPROVAL_REQUIRED" },
    { id: "deny-binding", when: { kind: "MISSING_REQUIRED_BINDING", side: "EITHER" }, outcome: "DENY", reasonCode: "IDENTITY_BINDING_REQUIRED" },
    { id: "deny-paused", when: { kind: "ASSET_STATUS_IN", statuses: ["PAUSED", "RETIRED"] }, outcome: "DENY", reasonCode: "ASSET_NOT_ACTIVE" }
  ]
};
const input: PolicyInput = { asset: { id: "IW:ASSET:usd", status: "ACTIVE", capabilities: ["TRANSFER"] }, sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", senderHasActiveSourceBinding: true, receiverHasActiveDestinationBinding: true, amount: "50", operation: "TRANSFER", sourceNetworkId: "IW:NETWORK:a", destinationNetworkId: "IW:NETWORK:b", metadata: {}, evaluatedAt: "2026-08-08T00:00:00.000Z" };

test("the same policy and input produce the same decision", () => {
  const engine = new DeterministicPolicyEngine();
  assert.deepEqual(engine.evaluate(policy, input), engine.evaluate(structuredClone(policy), structuredClone(input)));
  assert.equal(engine.evaluate(policy, input).outcome, "ALLOW");
});

test("deny overrides approval and allow regardless of rule order", () => {
  const engine = new DeterministicPolicyEngine();
  const denied = engine.evaluate(policy, { ...input, amount: "101", senderHasActiveSourceBinding: false });
  assert.equal(denied.outcome, "DENY"); assert.deepEqual(denied.reasonCodes, ["IDENTITY_BINDING_REQUIRED"]);
  const reordered = { ...policy, rules: [...policy.rules].reverse() };
  assert.deepEqual(engine.evaluate(reordered, { ...input, amount: "101", senderHasActiveSourceBinding: false }).reasonCodes, denied.reasonCodes);
});

test("preflight fails closed without an active policy and preserves exact version", async () => {
  const registry = new InMemoryPolicyRegistry(); const preflight = new TransferPolicyPreflight(registry, new DeterministicPolicyEngine());
  assert.equal((await preflight.canTransfer(policy.id, input)).outcome, "DENY");
  await registry.register(policy);
  const decision = await preflight.canTransfer(policy.id, input); assert.equal(decision.policyVersion, "1.0.0"); assert.equal(decision.outcome, "ALLOW");
});

test("policy versions are immutable and activation retires the previous version", async () => {
  const registry = new InMemoryPolicyRegistry(); await registry.register(policy);
  const next = { ...policy, version: "2.0.0", status: "DRAFT" as const, documentHash: "sha256:next" }; await registry.register(next); await registry.activate(next.id, next.version);
  assert.equal((await registry.get(policy.id, "1.0.0"))?.status, "RETIRED"); assert.equal((await registry.getActive(policy.id))?.version, "2.0.0");
  await assert.rejects(() => registry.register(next), /already exists/);
});
