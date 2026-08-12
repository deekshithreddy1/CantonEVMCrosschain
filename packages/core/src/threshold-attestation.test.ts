import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { UnsignedAttestation } from "./attestation-protocol.js";
import { canonicalAttestationBytes } from "./attestation-protocol.js";
import type { ValidatorSignature } from "./model.js";
import { AttestationAggregator, ValidatorSetRegistry } from "./threshold-attestation.js";

const unsigned: UnsignedAttestation = { version: "1", id: "IW:ATTESTATION:a1", operationId: "IW:BRIDGE:o1", sourceNetworkType: "CANTON", sourceNetworkId: "IW:NETWORK:canton", sourceTransactionId: "tx1", sourceEventPosition: "offset:1:event:0", eventType: "AssetLocked", assetId: "IW:ASSET:usd", amount: "100", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", destinationNetworkType: "EVM", destinationNetworkId: "IW:NETWORK:evm", nonce: "nonce_1234567890abcdef", observedStatePosition: "offset:2", observedAt: "2026-08-11T11:59:00.000Z", validFrom: "2026-08-11T12:00:00.000Z", expiresAt: "2026-08-11T12:10:00.000Z", policyVersion: "7" };
const digest = createHash("sha256").update(canonicalAttestationBytes(unsigned)).digest("hex");
const signature = (validatorId: string, publicKeyId = `key-${validatorId}`, value = digest): ValidatorSignature => ({ validatorId, algorithm: "TEST", publicKeyId, signature: value, signedAt: "2026-08-11T12:01:00.000Z" });
const verifier = { verify: async ({ signature: value, bytes }: { signature: string; bytes: Uint8Array }) => value === createHash("sha256").update(bytes).digest("hex") };
function registry() { const value = new ValidatorSetRegistry(); value.register({ id: "set-1", version: "1", threshold: 2, validFrom: "2026-08-01T00:00:00.000Z", validUntil: "2026-09-01T00:00:00.000Z", members: ["v1", "v2", "v3"].map((validatorId) => ({ validatorId, algorithm: "TEST", publicKeyId: `key-${validatorId}`, enabledFrom: "2026-08-01T00:00:00.000Z" })) }); return value; }

test("a configured 2-of-3 threshold aggregates independent validator signatures", async () => {
  const aggregator = new AttestationAggregator(registry(), verifier, () => new Date("2026-08-11T12:02:00.000Z"));
  const aggregated = await aggregator.aggregate(unsigned, "set-1", [signature("v2"), signature("v1")]);
  assert.equal(aggregated.verification.outcome, "SATISFIED");
  assert.deepEqual(aggregated.attestation.signatures.map((item) => item.validatorId), ["v1", "v2"]);
  assert.equal((await aggregator.verify(aggregated.attestation, "set-1")).outcome, "SATISFIED");
});

test("non-members, duplicates, wrong keys, and invalid signatures never count", async () => {
  const aggregator = new AttestationAggregator(registry(), verifier, () => new Date("2026-08-11T12:02:00.000Z"));
  const result = await aggregator.aggregate(unsigned, "set-1", [signature("v1"), signature("v1"), signature("outsider"), signature("v2", "wrong-key"), signature("v3", "key-v3", "invalid")]);
  assert.equal(result.verification.outcome, "REJECTED");
  if (result.verification.outcome === "REJECTED") { assert.equal(result.verification.reason, "INVALID_SIGNATURES"); assert.deepEqual(result.verification.rejected.map((item) => item.reason), ["DUPLICATE_VALIDATOR", "NOT_A_MEMBER", "KEY_MISMATCH", "INVALID_SIGNATURE"]); }
  assert.equal(result.attestation.signatures.length, 1);
});

test("insufficient threshold, expiry, and unsafe rotation are rejected", async () => {
  const sets = registry(); const aggregator = new AttestationAggregator(sets, verifier, () => new Date("2026-08-11T12:02:00.000Z"));
  const insufficient = await aggregator.aggregate(unsigned, "set-1", [signature("v1")]);
  assert.equal(insufficient.verification.outcome, "REJECTED");
  if (insufficient.verification.outcome === "REJECTED") assert.equal(insufficient.verification.reason, "INSUFFICIENT_THRESHOLD");
  const expired = new AttestationAggregator(sets, verifier, () => new Date(unsigned.expiresAt));
  const expiredResult = await expired.aggregate(unsigned, "set-1", [signature("v1"), signature("v2")]);
  if (expiredResult.verification.outcome === "REJECTED") assert.equal(expiredResult.verification.reason, "EXPIRED"); else assert.equal(true, false);
  assert.throws(() => sets.register({ id: "overlap", version: "2", threshold: 1, validFrom: "2026-08-15T00:00:00.000Z", members: [{ validatorId: "v4", algorithm: "TEST", publicKeyId: "key-v4", enabledFrom: "2026-08-15T00:00:00.000Z" }] }), /overlaps/);
});

test("a disabled validator cannot authorize a new signature", async () => {
  const sets = new ValidatorSetRegistry();
  sets.register({ id: "set-disabled", version: "1", threshold: 1, validFrom: "2026-08-01T00:00:00.000Z", validUntil: "2026-09-01T00:00:00.000Z", members: [
    { validatorId: "v1", algorithm: "TEST", publicKeyId: "key-v1", enabledFrom: "2026-08-01T00:00:00.000Z" },
    { validatorId: "v2", algorithm: "TEST", publicKeyId: "key-v2", enabledFrom: "2026-08-01T00:00:00.000Z", disabledAt: "2026-08-11T12:01:00.000Z" }
  ] });
  const result = await new AttestationAggregator(sets, verifier, () => new Date("2026-08-11T12:02:00.000Z")).aggregate(unsigned, "set-disabled", [signature("v2")]);
  assert.equal(result.verification.outcome, "REJECTED");
  if (result.verification.outcome === "REJECTED") assert.deepEqual(result.verification.rejected, [{ validatorId: "v2", reason: "MEMBER_DISABLED" }]);
});
