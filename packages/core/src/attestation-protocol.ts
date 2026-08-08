import { createHash } from "node:crypto";
import type { Attestation, ValidatorSignature } from "./model.js";
import { parseAtomicAmount } from "./invariants.js";
import { canonicalJson } from "./idempotency.js";
import { RegistryError } from "./registry-errors.js";

export const ATTESTATION_PROTOCOL_VERSION = "1" as const;
export const ATTESTATION_DOMAIN = "INTERWEAVE_ATTESTATION" as const;
export type UnsignedAttestation = Omit<Attestation, "signatures">;

export interface AttestationSigner {
  readonly validatorId: string;
  readonly algorithm: string;
  readonly publicKeyId: string;
  sign(bytes: Uint8Array): Promise<string>;
}
export interface AttestationSignatureVerifier {
  verify(input: { algorithm: string; publicKeyId: string; signature: string; bytes: Uint8Array }): Promise<boolean>;
}

export function assertUnsignedAttestation(attestation: UnsignedAttestation): void {
  if (attestation.version !== ATTESTATION_PROTOCOL_VERSION) throw new RegistryError("INVALID_ARGUMENT", `unsupported attestation version: ${attestation.version}`);
  assertId(attestation.id, "IW:ATTESTATION:", "attestation"); assertId(attestation.operationId, "IW:BRIDGE:", "operation"); assertId(attestation.assetId, "IW:ASSET:", "asset");
  assertId(attestation.sender, "IW:IDENTITY:", "sender"); assertId(attestation.receiver, "IW:IDENTITY:", "receiver"); assertId(attestation.sourceNetworkId, "IW:NETWORK:", "source network"); assertId(attestation.destinationNetworkId, "IW:NETWORK:", "destination network");
  if (attestation.sourceNetworkId === attestation.destinationNetworkId) throw new RegistryError("INVALID_ARGUMENT", "attestation networks must differ");
  for (const [name, value] of [["source network type", attestation.sourceNetworkType], ["destination network type", attestation.destinationNetworkType], ["source transaction", attestation.sourceTransactionId], ["source event position", attestation.sourceEventPosition], ["event type", attestation.eventType], ["observed state position", attestation.observedStatePosition], ["policy version", attestation.policyVersion]] as const) if (!value.trim()) throw new RegistryError("INVALID_ARGUMENT", `${name} is required`);
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(attestation.nonce)) throw new RegistryError("INVALID_ARGUMENT", "attestation nonce must contain 16-256 safe random characters");
  if (parseAtomicAmount(attestation.amount) <= 0n) throw new RegistryError("INVALID_ARGUMENT", "attestation amount must be positive");
  const observed = timestamp(attestation.observedAt, "observedAt"); const valid = timestamp(attestation.validFrom, "validFrom"); const expires = timestamp(attestation.expiresAt, "expiresAt");
  if (observed > valid || valid >= expires) throw new RegistryError("INVALID_ARGUMENT", "attestation requires observedAt <= validFrom < expiresAt");
}

function assertId(value: string, prefix: string, name: string): void { if (!value.startsWith(prefix) || value.length === prefix.length) throw new RegistryError("INVALID_ARGUMENT", `invalid ${name} ID`); }
function timestamp(value: string, name: string): number { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new RegistryError("INVALID_ARGUMENT", `invalid ${name} timestamp`); return parsed; }

export function canonicalAttestationObject(attestation: UnsignedAttestation): Readonly<Record<string, string>> {
  assertUnsignedAttestation(attestation);
  return {
    amount: attestation.amount, assetId: attestation.assetId, attestationId: attestation.id, destinationNetworkId: attestation.destinationNetworkId,
    destinationNetworkType: attestation.destinationNetworkType, eventType: attestation.eventType, expiresAt: attestation.expiresAt, nonce: attestation.nonce,
    observedAt: attestation.observedAt, observedStatePosition: attestation.observedStatePosition, operationId: attestation.operationId, policyVersion: attestation.policyVersion,
    receiver: attestation.receiver, sender: attestation.sender, sourceEventPosition: attestation.sourceEventPosition, sourceNetworkId: attestation.sourceNetworkId,
    sourceNetworkType: attestation.sourceNetworkType, sourceTransactionId: attestation.sourceTransactionId, validFrom: attestation.validFrom, version: attestation.version
  };
}

export function attestationDomain(attestation: UnsignedAttestation): string {
  return `${ATTESTATION_DOMAIN}|${attestation.version}|${attestation.sourceNetworkId}|${attestation.destinationNetworkId}`;
}
export function canonicalAttestationBytes(attestation: UnsignedAttestation): Uint8Array {
  const payload = canonicalJson(canonicalAttestationObject(attestation));
  return new TextEncoder().encode(`${attestationDomain(attestation)}\u0000${payload}`);
}
export function attestationDigest(attestation: UnsignedAttestation): `sha256:${string}` { return `sha256:${createHash("sha256").update(canonicalAttestationBytes(attestation)).digest("hex")}`; }
export function attestationReplayKey(attestation: UnsignedAttestation): string { return createHash("sha256").update(`${attestation.version}|${attestation.operationId}|${attestation.nonce}|${attestation.destinationNetworkId}`).digest("hex"); }

export async function signAttestation(attestation: UnsignedAttestation, signer: AttestationSigner, signedAt: string): Promise<ValidatorSignature> {
  const time = timestamp(signedAt, "signedAt"); if (time < Date.parse(attestation.observedAt) || time >= Date.parse(attestation.expiresAt)) throw new RegistryError("INVALID_ARGUMENT", "signature time is outside the attestation validity window");
  if (!signer.validatorId.trim() || !signer.algorithm.trim() || !signer.publicKeyId.trim()) throw new RegistryError("INVALID_ARGUMENT", "signer identity, algorithm, and key ID are required");
  return { validatorId: signer.validatorId, algorithm: signer.algorithm, publicKeyId: signer.publicKeyId, signature: await signer.sign(canonicalAttestationBytes(attestation)), signedAt };
}
export async function verifyAttestationSignature(attestation: UnsignedAttestation, signature: ValidatorSignature, verifier: AttestationSignatureVerifier): Promise<boolean> {
  assertUnsignedAttestation(attestation); const signedAt = timestamp(signature.signedAt, "signedAt");
  if (signedAt < Date.parse(attestation.observedAt) || signedAt >= Date.parse(attestation.expiresAt)) return false;
  return verifier.verify({ algorithm: signature.algorithm, publicKeyId: signature.publicKeyId, signature: signature.signature, bytes: canonicalAttestationBytes(attestation) });
}
export function attachAttestationSignature(attestation: Attestation, signature: ValidatorSignature): Attestation {
  assertUnsignedAttestation(attestation); if (attestation.signatures.some((item) => item.validatorId === signature.validatorId)) throw new RegistryError("CONFLICT", `validator already signed attestation: ${signature.validatorId}`);
  return { ...structuredClone(attestation), signatures: [...attestation.signatures, structuredClone(signature)].sort((a, b) => a.validatorId.localeCompare(b.validatorId)) };
}
