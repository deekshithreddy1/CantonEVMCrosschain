import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { attachAttestationSignature, attestationDigest, attestationDomain, attestationReplayKey, canonicalAttestationBytes, signAttestation, verifyAttestationSignature } from "./attestation-protocol.js";
import type { AttestationSignatureVerifier, UnsignedAttestation } from "./attestation-protocol.js";

const unsigned: UnsignedAttestation = {
  version: "1", id: "IW:ATTESTATION:att-1", operationId: "IW:BRIDGE:op-1", sourceNetworkType: "CANTON", sourceNetworkId: "IW:NETWORK:canton", sourceTransactionId: "tx-42", sourceEventPosition: "offset:42:event:0", eventType: "AssetLocked", assetId: "IW:ASSET:usd", amount: "1000000", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", destinationNetworkType: "EVM", destinationNetworkId: "IW:NETWORK:ethereum", nonce: "nonce_1234567890abcdef", observedStatePosition: "participant-offset:43", observedAt: "2026-08-08T00:00:00.000Z", validFrom: "2026-08-08T00:00:01.000Z", expiresAt: "2026-08-08T00:05:00.000Z", policyVersion: "1.0.0"
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const verifier: AttestationSignatureVerifier = { verify: async ({ signature, bytes }) => signature === hash(bytes) };

test("canonical attestation bytes and digest are deterministic", () => {
  assert.deepEqual(canonicalAttestationBytes(unsigned), canonicalAttestationBytes(structuredClone(unsigned)));
  assert.equal(attestationDigest(unsigned), attestationDigest(structuredClone(unsigned)));
  assert.equal(attestationDomain(unsigned), "INTERWEAVE_ATTESTATION|1|IW:NETWORK:canton|IW:NETWORK:ethereum");
  assert.equal(attestationReplayKey(unsigned), attestationReplayKey(structuredClone(unsigned)));
});

test("a signature cannot be reused for another bound field", async () => {
  const signature = await signAttestation(unsigned, { validatorId: "validator-1", algorithm: "TEST-SHA256", publicKeyId: "test-key", sign: async (bytes) => hash(bytes) }, "2026-08-08T00:00:02.000Z");
  assert.equal(await verifyAttestationSignature(unsigned, signature, verifier), true);
  const mutations: UnsignedAttestation[] = [
    { ...unsigned, version: "2" }, { ...unsigned, operationId: "IW:BRIDGE:op-2" }, { ...unsigned, sourceNetworkId: "IW:NETWORK:other-source" },
    { ...unsigned, destinationNetworkId: "IW:NETWORK:other-destination" }, { ...unsigned, assetId: "IW:ASSET:eur" }, { ...unsigned, amount: "1000001" }
  ];
  for (const mutated of mutations) {
    if (mutated.version === "2") assert.throws(() => canonicalAttestationBytes(mutated), /unsupported/);
    else assert.equal(await verifyAttestationSignature(mutated, signature, verifier), false);
  }
});

test("validity windows and duplicate validator signatures are rejected", async () => {
  await assert.rejects(() => signAttestation(unsigned, { validatorId: "validator-1", algorithm: "TEST", publicKeyId: "key", sign: async () => "sig" }, unsigned.expiresAt), /validity window/);
  const signature = await signAttestation(unsigned, { validatorId: "validator-1", algorithm: "TEST-SHA256", publicKeyId: "key", sign: async (bytes) => hash(bytes) }, "2026-08-08T00:00:02.000Z");
  const signed = attachAttestationSignature({ ...unsigned, signatures: [] }, signature); assert.equal(signed.signatures.length, 1);
  assert.throws(() => attachAttestationSignature(signed, signature), /already signed/);
});
