import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryIdentityRegistry } from "./identity-registry.js";
import type { IdentityProofVerifier } from "./identity-registry.js";
import { InMemoryNetworkRegistry } from "./network-registry.js";
import type { Network } from "./model.js";

const evm: Network = { id: "IW:NETWORK:test", type: "EVM", name: "Test", environment: "TESTNET", endpoints: ["https://rpc.example.invalid"], chainId: "1", finalityPolicy: { kind: "EVM_CONFIRMATIONS", confirmations: 12, requireFinalizedTag: true }, adapterConfiguration: {}, enabled: true };
const address = "0x00000000000000000000000000000000000000AA";

async function setup(now: { value: Date }, verifies = true) {
  const networks = new InMemoryNetworkRegistry(); await networks.register(evm); let sequence = 0;
  const verifier: IdentityProofVerifier = { kind: "EVM_PERSONAL_SIGN", verify: async (challenge, proof) => verifies && proof.proof === `signature:${challenge.message}` ? { method: "EIP-191", proofFingerprint: "sha256:fingerprint" } : undefined };
  const registry = new InMemoryIdentityRegistry({ networks, verifiers: [verifier], now: () => now.value, randomId: () => `id-${++sequence}` });
  await registry.createIdentity({ id: "IW:IDENTITY:alice", displayName: "Alice" }, "admin"); return registry;
}

test("proof challenge is deterministic, single use, and creates no binding before verification", async () => {
  const now = { value: new Date("2026-08-08T00:00:00.000Z") }; const registry = await setup(now);
  const challenge = await registry.issueChallenge({ identityId: "IW:IDENTITY:alice", networkId: evm.id, locator: { kind: "EVM", address }, ttlSeconds: 60 }, "alice");
  assert.equal((await registry.activeBindings("IW:IDENTITY:alice")).length, 0);
  assert.equal(challenge.message.includes(address.toLowerCase()), true);
  const binding = await registry.verifyChallenge(challenge.id, { kind: "EVM_PERSONAL_SIGN", proof: `signature:${challenge.message}` }, undefined, "alice");
  assert.equal(binding.locator.kind === "EVM" ? binding.locator.address : "", address.toLowerCase());
  await assert.rejects(() => registry.verifyChallenge(challenge.id, { kind: "EVM_PERSONAL_SIGN", proof: `signature:${challenge.message}` }, undefined, "alice"), /consumed/);
  assert.equal((await registry.auditTrail("IW:IDENTITY:alice")).length, 3);
});

test("expired challenges and invalid proof cannot create bindings", async () => {
  const now = { value: new Date("2026-08-08T00:00:00.000Z") }; const registry = await setup(now);
  const challenge = await registry.issueChallenge({ identityId: "IW:IDENTITY:alice", networkId: evm.id, locator: { kind: "EVM", address }, ttlSeconds: 1 }, "alice");
  await assert.rejects(() => registry.verifyChallenge(challenge.id, { kind: "EVM_PERSONAL_SIGN", proof: "wrong" }, undefined, "alice"), /verification failed/);
  now.value = new Date("2026-08-08T00:00:01.000Z");
  await assert.rejects(() => registry.verifyChallenge(challenge.id, { kind: "EVM_PERSONAL_SIGN", proof: `signature:${challenge.message}` }, undefined, "alice"), /expired/);
  assert.equal((await registry.activeBindings("IW:IDENTITY:alice")).length, 0);
});

test("bindings expire and can be explicitly revoked", async () => {
  const now = { value: new Date("2026-08-08T00:00:00.000Z") }; const registry = await setup(now);
  const challenge = await registry.issueChallenge({ identityId: "IW:IDENTITY:alice", networkId: evm.id, locator: { kind: "EVM", address }, ttlSeconds: 60 }, "alice");
  const binding = await registry.verifyChallenge(challenge.id, { kind: "EVM_PERSONAL_SIGN", proof: `signature:${challenge.message}` }, "2026-08-09T00:00:00.000Z", "alice");
  assert.equal((await registry.activeBindings("IW:IDENTITY:alice")).length, 1);
  await registry.revokeBinding("IW:IDENTITY:alice", binding.bindingId, "security-admin");
  assert.equal((await registry.activeBindings("IW:IDENTITY:alice")).length, 0);
});
