import type { Attestation, IsoTimestamp, ValidatorSignature } from "./model.js";
import type { AttestationSignatureVerifier, UnsignedAttestation } from "./attestation-protocol.js";
import { assertUnsignedAttestation, attachAttestationSignature, verifyAttestationSignature } from "./attestation-protocol.js";
import { RegistryError } from "./registry-errors.js";

export interface ValidatorMember {
  validatorId: string;
  algorithm: string;
  publicKeyId: string;
  enabledFrom: IsoTimestamp;
  disabledAt?: IsoTimestamp;
}

/** Validator sets are immutable. Rotation registers a new set with a non-overlapping interval. */
export interface ValidatorSet {
  id: string;
  version: string;
  threshold: number;
  validFrom: IsoTimestamp;
  validUntil?: IsoTimestamp;
  members: readonly ValidatorMember[];
}

export class ValidatorSetRegistry {
  readonly #sets = new Map<string, ValidatorSet>();

  register(set: ValidatorSet): ValidatorSet {
    assertValidatorSet(set);
    if (this.#sets.has(set.id)) throw new RegistryError("CONFLICT", `validator set is immutable: ${set.id}`);
    for (const existing of this.#sets.values()) {
      if (intervalsOverlap(set.validFrom, set.validUntil, existing.validFrom, existing.validUntil)) {
        throw new RegistryError("CONFLICT", `validator set validity overlaps: ${existing.id}`);
      }
    }
    const stored = structuredClone(set);
    this.#sets.set(set.id, stored);
    return structuredClone(stored);
  }

  get(id: string): ValidatorSet | undefined { const set = this.#sets.get(id); return set ? structuredClone(set) : undefined; }

  resolve(id: string, attestationValidFrom: IsoTimestamp): ValidatorSet {
    const set = this.#sets.get(id);
    if (!set) throw new RegistryError("NOT_FOUND", `validator set not found: ${id}`);
    const time = parseTime(attestationValidFrom, "attestation validFrom");
    if (time < parseTime(set.validFrom, "validator set validFrom") || (set.validUntil && time >= parseTime(set.validUntil, "validator set validUntil"))) {
      throw new RegistryError("INVALID_ARGUMENT", `validator set is not valid for attestation time: ${id}`);
    }
    return structuredClone(set);
  }
}

export type SignatureRejectionCode = "DUPLICATE_VALIDATOR" | "NOT_A_MEMBER" | "MEMBER_DISABLED" | "KEY_MISMATCH" | "INVALID_SIGNATURE";
export interface RejectedValidatorSignature { validatorId: string; reason: SignatureRejectionCode }
export type ThresholdVerification =
  | { outcome: "SATISFIED"; validatorSetId: string; threshold: number; validValidatorIds: readonly string[] }
  | { outcome: "REJECTED"; validatorSetId: string; threshold: number; validValidatorIds: readonly string[]; rejected: readonly RejectedValidatorSignature[]; reason: "INSUFFICIENT_THRESHOLD" | "INVALID_SIGNATURES" | "EXPIRED" };

export class AttestationAggregator {
  constructor(readonly sets: ValidatorSetRegistry, readonly verifier: AttestationSignatureVerifier, readonly now: () => Date = () => new Date()) {}

  async aggregate(unsigned: UnsignedAttestation, validatorSetId: string, signatures: readonly ValidatorSignature[]): Promise<{ attestation: Attestation; verification: ThresholdVerification }> {
    assertUnsignedAttestation(unsigned);
    let attestation: Attestation = { ...structuredClone(unsigned), signatures: [] };
    const set = this.sets.resolve(validatorSetId, unsigned.validFrom);
    const checked = await this.#check(unsigned, set, signatures);
    for (const signature of checked.validSignatures) attestation = attachAttestationSignature(attestation, signature);
    return { attestation, verification: result(set, checked, this.now().getTime() >= Date.parse(unsigned.expiresAt)) };
  }

  async verify(attestation: Attestation, validatorSetId: string): Promise<ThresholdVerification> {
    assertUnsignedAttestation(attestation);
    const set = this.sets.resolve(validatorSetId, attestation.validFrom);
    const checked = await this.#check(attestation, set, attestation.signatures);
    return result(set, checked, this.now().getTime() >= Date.parse(attestation.expiresAt));
  }

  async #check(unsigned: UnsignedAttestation, set: ValidatorSet, signatures: readonly ValidatorSignature[]) {
    const members = new Map(set.members.map((member) => [member.validatorId, member]));
    const seen = new Set<string>();
    const validSignatures: ValidatorSignature[] = [];
    const rejected: RejectedValidatorSignature[] = [];
    for (const signature of signatures) {
      if (seen.has(signature.validatorId)) { rejected.push({ validatorId: signature.validatorId, reason: "DUPLICATE_VALIDATOR" }); continue; }
      seen.add(signature.validatorId);
      const member = members.get(signature.validatorId);
      if (!member) { rejected.push({ validatorId: signature.validatorId, reason: "NOT_A_MEMBER" }); continue; }
      const signedAt = Date.parse(signature.signedAt);
      if (!Number.isFinite(signedAt)) { rejected.push({ validatorId: signature.validatorId, reason: "INVALID_SIGNATURE" }); continue; }
      if (signedAt < Date.parse(member.enabledFrom) || (member.disabledAt && signedAt >= Date.parse(member.disabledAt))) { rejected.push({ validatorId: signature.validatorId, reason: "MEMBER_DISABLED" }); continue; }
      if (signature.algorithm !== member.algorithm || signature.publicKeyId !== member.publicKeyId) { rejected.push({ validatorId: signature.validatorId, reason: "KEY_MISMATCH" }); continue; }
      try {
        if (!await verifyAttestationSignature(unsigned, signature, this.verifier)) { rejected.push({ validatorId: signature.validatorId, reason: "INVALID_SIGNATURE" }); continue; }
      } catch { rejected.push({ validatorId: signature.validatorId, reason: "INVALID_SIGNATURE" }); continue; }
      validSignatures.push(structuredClone(signature));
    }
    validSignatures.sort((a, b) => a.validatorId.localeCompare(b.validatorId));
    return { validSignatures, rejected };
  }
}

function result(set: ValidatorSet, checked: { validSignatures: readonly ValidatorSignature[]; rejected: readonly RejectedValidatorSignature[] }, expired: boolean): ThresholdVerification {
  const base = { validatorSetId: set.id, threshold: set.threshold, validValidatorIds: checked.validSignatures.map((signature) => signature.validatorId) };
  if (expired) return { outcome: "REJECTED", ...base, rejected: checked.rejected, reason: "EXPIRED" };
  if (checked.rejected.length) return { outcome: "REJECTED", ...base, rejected: checked.rejected, reason: "INVALID_SIGNATURES" };
  if (checked.validSignatures.length < set.threshold) return { outcome: "REJECTED", ...base, rejected: [], reason: "INSUFFICIENT_THRESHOLD" };
  return { outcome: "SATISFIED", ...base };
}

function assertValidatorSet(set: ValidatorSet): void {
  if (!set.id.trim() || !set.version.trim()) throw new RegistryError("INVALID_ARGUMENT", "validator set ID and version are required");
  const from = parseTime(set.validFrom, "validator set validFrom");
  if (set.validUntil && from >= parseTime(set.validUntil, "validator set validUntil")) throw new RegistryError("INVALID_ARGUMENT", "validator set interval is empty");
  if (!Number.isSafeInteger(set.threshold) || set.threshold < 1 || set.threshold > set.members.length) throw new RegistryError("INVALID_ARGUMENT", "validator threshold must be between one and member count");
  const ids = new Set<string>(); const keys = new Set<string>();
  for (const member of set.members) {
    if (!member.validatorId.trim() || !member.algorithm.trim() || !member.publicKeyId.trim()) throw new RegistryError("INVALID_ARGUMENT", "validator member identity, algorithm, and key are required");
    if (ids.has(member.validatorId)) throw new RegistryError("INVALID_ARGUMENT", `duplicate validator member: ${member.validatorId}`);
    const key = `${member.algorithm}|${member.publicKeyId}`; if (keys.has(key)) throw new RegistryError("INVALID_ARGUMENT", `validator key is shared by multiple members: ${member.publicKeyId}`);
    ids.add(member.validatorId); keys.add(key); const enabled = parseTime(member.enabledFrom, "member enabledFrom");
    if (member.disabledAt && enabled >= parseTime(member.disabledAt, "member disabledAt")) throw new RegistryError("INVALID_ARGUMENT", `invalid member interval: ${member.validatorId}`);
  }
  const boundaries = [from, ...set.members.flatMap((member) => [Date.parse(member.enabledFrom), member.disabledAt ? Date.parse(member.disabledAt) : Number.POSITIVE_INFINITY])]
    .filter((time) => time >= from && (!set.validUntil || time < Date.parse(set.validUntil)) && Number.isFinite(time));
  for (const time of boundaries) {
    const available = set.members.filter((member) => Date.parse(member.enabledFrom) <= time && (!member.disabledAt || time < Date.parse(member.disabledAt))).length;
    if (available < set.threshold) throw new RegistryError("INVALID_ARGUMENT", "validator threshold is not achievable throughout the set interval");
  }
}
function parseTime(value: string, name: string): number { const time = Date.parse(value); if (!Number.isFinite(time)) throw new RegistryError("INVALID_ARGUMENT", `${name} must be a valid timestamp`); return time; }
function intervalsOverlap(aFrom: string, aUntil: string | undefined, bFrom: string, bUntil: string | undefined): boolean {
  const aStart = Date.parse(aFrom), aEnd = aUntil ? Date.parse(aUntil) : Number.POSITIVE_INFINITY;
  const bStart = Date.parse(bFrom), bEnd = bUntil ? Date.parse(bUntil) : Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}
