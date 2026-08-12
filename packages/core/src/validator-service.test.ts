import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { UnsignedAttestation } from "./attestation-protocol.js";
import type { IndependentSourceObservation, ValidatorNetworkConfiguration, ValidatorSourceProviderFactory } from "./validator-service.js";
import { ValidatorService } from "./validator-service.js";

const attestation: UnsignedAttestation = {
  version: "1", id: "IW:ATTESTATION:a1", operationId: "IW:BRIDGE:o1", sourceNetworkType: "EVM", sourceNetworkId: "IW:NETWORK:evm", sourceTransactionId: "0xabc",
  sourceEventPosition: "block:10:log:2", eventType: "AssetBurned", assetId: "IW:ASSET:usd", amount: "40", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:alice",
  destinationNetworkType: "CANTON", destinationNetworkId: "IW:NETWORK:canton", nonce: "nonce_1234567890abcdef", observedStatePosition: "finalized:20",
  observedAt: "2026-08-11T11:59:00.000Z", validFrom: "2026-08-11T12:00:00.000Z", expiresAt: "2026-08-11T12:10:00.000Z", policyVersion: "bridge-7"
};
const configuration: ValidatorNetworkConfiguration = { networkId: "IW:NETWORK:evm", networkType: "EVM", endpoints: ["https://validator-rpc.invalid"], enabled: true, sourceAssets: { "IW:ASSET:usd": { kind: "EVM_CONTRACT", value: "0x1234" } }, allowedPolicyVersions: ["bridge-7"] };
const observation: IndependentSourceObservation = {
  networkId: attestation.sourceNetworkId, networkType: attestation.sourceNetworkType, transactionId: attestation.sourceTransactionId, transactionStatus: "SUCCEEDED",
  eventPosition: attestation.sourceEventPosition, eventType: attestation.eventType, sourceAsset: { kind: "EVM_CONTRACT", value: "0x1234" }, assetId: attestation.assetId,
  operationId: attestation.operationId, amount: attestation.amount, sender: attestation.sender, receiver: attestation.receiver, canonical: true, finalitySatisfied: true,
  observedStatePosition: attestation.observedStatePosition, observedAt: attestation.observedAt, finalityEvidence: ["finalized block 20 contains block 10"]
};
const signer = { validatorId: "validator-1", algorithm: "TEST-SHA256", publicKeyId: "key-1", sign: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex") };
function service(value: IndependentSourceObservation | undefined, captured?: ValidatorNetworkConfiguration[]) {
  const factory: ValidatorSourceProviderFactory = { create: (config) => { captured?.push(config); return { observe: async () => value }; } };
  return new ValidatorService([configuration], factory, signer, () => new Date("2026-08-11T12:01:00.000Z"));
}

test("validator independently observes complete source evidence before signing", async () => {
  const captured: ValidatorNetworkConfiguration[] = [];
  const result = await service(observation, captured).verifyAndSign({ attestation });
  assert.equal(result.outcome, "SIGNED");
  if (result.outcome === "SIGNED") { assert.equal(result.validatorId, "validator-1"); assert.equal(result.digest.startsWith("sha256:"), true); }
  assert.deepEqual(captured[0]?.endpoints, configuration.endpoints);
});

test("validator fails closed and never signs mismatched coordinator assertions", async () => {
  let signCalls = 0;
  const guardedSigner = { ...signer, sign: async (bytes: Uint8Array) => { signCalls++; return signer.sign(bytes); } };
  const factory: ValidatorSourceProviderFactory = { create: () => ({ observe: async () => ({ ...observation, amount: "41", operationId: "IW:BRIDGE:other", finalitySatisfied: false, finalityEvidence: [] }) }) };
  const result = await new ValidatorService([configuration], factory, guardedSigner, () => new Date("2026-08-11T12:01:00.000Z")).verifyAndSign({ attestation });
  assert.equal(result.outcome, "REJECTED");
  if (result.outcome === "REJECTED") assert.deepEqual(result.reasons, ["OPERATION_MISMATCH", "AMOUNT_MISMATCH", "FINALITY_NOT_SATISFIED"]);
  assert.equal(signCalls, 0);
});

test("missing, expired, disallowed-policy, and provider-error candidates fail closed", async () => {
  assert.deepEqual(await service(undefined).verifyAndSign({ attestation }), { outcome: "REJECTED", reasons: ["SOURCE_NOT_FOUND"] });
  const expired = new ValidatorService([configuration], { create: () => ({ observe: async () => observation }) }, signer, () => new Date(attestation.expiresAt));
  assert.deepEqual(await expired.verifyAndSign({ attestation }), { outcome: "REJECTED", reasons: ["EXPIRED"] });
  assert.deepEqual(await service(observation).verifyAndSign({ attestation: { ...attestation, policyVersion: "unknown" } }), { outcome: "REJECTED", reasons: ["POLICY_NOT_ALLOWED"] });
  const broken = new ValidatorService([configuration], { create: () => ({ observe: async () => { throw new Error("rpc unavailable"); } }) }, signer, () => new Date("2026-08-11T12:01:00.000Z"));
  assert.deepEqual(await broken.verifyAndSign({ attestation }), { outcome: "REJECTED", reasons: ["PROVIDER_ERROR"] });
});
