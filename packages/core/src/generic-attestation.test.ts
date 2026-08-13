import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { GenericAttestationRequest, GenericAttestationValidator, GenericSourceObservation } from "./generic-attestation.js";
import { GenericAttestationService, InMemoryGenericAttestationStore, verifyGenericAttestation } from "./generic-attestation.js";

const request: GenericAttestationRequest = {
  id: "IW:ATTESTATION:collateral-1", idempotencyKey: "collateral-1", sourceNetworkId: "IW:NETWORK:ethereum", sourceNetworkType: "EVM",
  sourceTransactionId: "0xdeposit", sourceEventPosition: "block:100:log:2", predicateType: "CollateralDeposited",
  claims: { vault: "0xvault", depositor: "0xalice", asset: "USDC", amount: "1000000", creditLineId: "credit-7" },
  nonce: "nonce_collateral_0001", policyVersion: "collateral-policy-v1", validatorSetId: "validators-v1", threshold: 2,
  createdAt: "2026-08-12T12:00:00.000Z", validFrom: "2026-08-12T12:01:00.000Z", expiresAt: "2026-08-12T13:00:00.000Z"
};
const observation: GenericSourceObservation = { networkId: request.sourceNetworkId, networkType: request.sourceNetworkType, transactionId: request.sourceTransactionId, eventPosition: request.sourceEventPosition, predicateType: request.predicateType, claims: request.claims, canonical: true, finalitySatisfied: true, observedStatePosition: "finalized:100", observedAt: "2026-08-12T12:02:00.000Z", finalityEvidence: ["provider-a:block-100"] };
const signature = (key: string, bytes: Uint8Array) => createHash("sha256").update(new Uint8Array([...new TextEncoder().encode(key), ...bytes])).digest("hex");
function validator(id: string, value: GenericSourceObservation | undefined = observation): GenericAttestationValidator { const key = `key-${id}`; return { validatorId: id, algorithm: "TEST_SHA256", publicKeyId: key, observe: async () => value ? structuredClone(value) : undefined, sign: async (bytes) => signature(key, bytes) }; }
const verifier = { verify: async (input: { publicKeyId: string; signature: string; bytes: Uint8Array }) => input.signature === signature(input.publicKeyId, input.bytes) };

test("independent validators attest a generic Ethereum collateral event", async () => {
  const service = new GenericAttestationService([validator("v1"), validator("v2")], new InMemoryGenericAttestationStore(), () => new Date("2026-08-12T12:03:00.000Z"));
  const result = await service.request(request); assert.equal(result.outcome, "VERIFIED"); assert.equal(result.attestation?.statement.predicateType, "CollateralDeposited");
  assert.equal(result.attestation?.signatures.length, 2); assert.equal(await verifyGenericAttestation(result.attestation!, 2, verifier, new Date("2026-08-12T12:04:00.000Z")), true);
});

test("attestation output is evidence-only and has no destination mutation authority", async () => {
  const result = await new GenericAttestationService([validator("v1"), validator("v2")], new InMemoryGenericAttestationStore(), () => new Date("2026-08-12T12:03:00.000Z")).request(request);
  assert.equal(result.attestation?.status, "VERIFIED_EVIDENCE_ONLY"); assert.equal(result.attestation?.destinationMutationAuthorized, false);
  assert.equal("destinationAction" in (result.attestation ?? {}), false);
});

test("claim mismatch and insufficient threshold fail closed without an attestation", async () => {
  const mismatch = { ...observation, claims: { ...observation.claims, amount: "999999" } };
  const result = await new GenericAttestationService([validator("v1"), validator("v2", mismatch)], new InMemoryGenericAttestationStore(), () => new Date("2026-08-12T12:03:00.000Z")).request(request);
  assert.equal(result.outcome, "REJECTED"); assert.equal(result.attestation, undefined); assert.equal(result.reasons.includes("v2:CLAIMS_MISMATCH"), true); assert.equal(result.reasons.includes("INSUFFICIENT_THRESHOLD"), true);
});

test("validator disagreement on independently observed positions is rejected", async () => {
  const other = { ...observation, observedStatePosition: "finalized:101" };
  const result = await new GenericAttestationService([validator("v1"), validator("v2", other)], new InMemoryGenericAttestationStore(), () => new Date("2026-08-12T12:03:00.000Z")).request(request);
  assert.equal(result.outcome, "REJECTED"); assert.equal(result.reasons.includes("VALIDATOR_OBSERVATION_DISAGREEMENT"), true);
});

test("immutable request replay returns the same artifact and conflicting ID reuse fails", async () => {
  let observations = 0; const first = validator("v1"); const counted = { ...first, observe: async (input: GenericAttestationRequest) => { observations++; return first.observe(input); } };
  const service = new GenericAttestationService([counted, validator("v2")], new InMemoryGenericAttestationStore(), () => new Date("2026-08-12T12:03:00.000Z"));
  const original = await service.request(request); const replay = await service.request(request); assert.equal(replay.attestation?.digest, original.attestation?.digest); assert.equal(observations, 1);
  await assert.rejects(service.request({ ...request, claims: { ...request.claims, amount: "2" } }), /reused with different content/);
});

test("expired evidence and invalid signatures do not verify", async () => {
  const result = await new GenericAttestationService([validator("v1"), validator("v2")], new InMemoryGenericAttestationStore(), () => new Date("2026-08-12T12:03:00.000Z")).request(request);
  assert.equal(await verifyGenericAttestation(result.attestation!, 2, verifier, new Date("2026-08-12T13:01:00.000Z")), false);
  const tampered = structuredClone(result.attestation!); tampered.signatures[0]!.signature = "invalid"; assert.equal(await verifyGenericAttestation(tampered, 2, verifier, new Date("2026-08-12T12:04:00.000Z")), false);
});

test("duplicate validator identities and shared keys cannot inflate threshold", () => {
  const first = validator("v1"); assert.throws(() => new GenericAttestationService([first, first], new InMemoryGenericAttestationStore()), /duplicate validator identity/);
  const shared = { ...validator("v2"), publicKeyId: first.publicKeyId }; assert.throws(() => new GenericAttestationService([first, shared], new InMemoryGenericAttestationStore()), /validator key is shared/);
});
