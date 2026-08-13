import { createHash } from "node:crypto";
import type { AttestationId, IsoTimestamp, NetworkId, NetworkType, ValidatorSignature } from "./model.js";
import type { AttestationSignatureVerifier } from "./attestation-protocol.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { canonicalJson, requestFingerprint } from "./idempotency.js";
import { RegistryError } from "./registry-errors.js";

export const GENERIC_ATTESTATION_VERSION = "1" as const;
export const GENERIC_ATTESTATION_DOMAIN = "INTERWEAVE_GENERIC_STATE_ATTESTATION" as const;
export type GenericClaimValue = string | number | boolean | null;
export interface GenericAttestationRequest {
  id: AttestationId; idempotencyKey: string; sourceNetworkId: NetworkId; sourceNetworkType: NetworkType;
  sourceTransactionId: string; sourceEventPosition: string; predicateType: string; claims: Readonly<Record<string, GenericClaimValue>>;
  nonce: string; policyVersion: string; validatorSetId: string; threshold: number; validFrom: IsoTimestamp; expiresAt: IsoTimestamp; createdAt: IsoTimestamp;
}
export interface GenericSourceObservation {
  networkId: NetworkId; networkType: NetworkType; transactionId: string; eventPosition: string; predicateType: string;
  claims: Readonly<Record<string, GenericClaimValue>>; canonical: boolean; finalitySatisfied: boolean; observedStatePosition: string;
  observedAt: IsoTimestamp; finalityEvidence: readonly string[];
}
export interface GenericAttestationStatement extends GenericAttestationRequest {
  version: typeof GENERIC_ATTESTATION_VERSION; observedStatePosition: string; observedAt: IsoTimestamp;
}
export interface GenericAttestationValidator {
  readonly validatorId: string; readonly algorithm: string; readonly publicKeyId: string;
  observe(request: GenericAttestationRequest): Promise<GenericSourceObservation | undefined>;
  sign(bytes: Uint8Array): Promise<string>;
}
export interface GenericStateAttestation {
  statement: GenericAttestationStatement; signatures: readonly ValidatorSignature[]; validatorEvidence: Readonly<Record<string, GenericSourceObservation>>;
  digest: `sha256:${string}`; status: "VERIFIED_EVIDENCE_ONLY"; destinationMutationAuthorized: false; recordedAt: IsoTimestamp;
}
export interface GenericAttestationRecord { request: GenericAttestationRequest; requestHash: string; outcome: "VERIFIED" | "REJECTED"; attestation?: GenericStateAttestation; reasons: readonly string[]; recordedAt: IsoTimestamp }
export interface GenericAttestationStore { get(id: AttestationId): Promise<GenericAttestationRecord | undefined>; save(record: GenericAttestationRecord): Promise<void> }

export class GenericAttestationService {
  constructor(readonly validators: readonly GenericAttestationValidator[], readonly store: GenericAttestationStore, readonly now: () => Date = () => new Date()) {
    const identities = new Set<string>(); const keys = new Set<string>();
    for (const validator of validators) {
      if (!validator.validatorId.trim() || !validator.algorithm.trim() || !validator.publicKeyId.trim()) throw new RegistryError("INVALID_ARGUMENT", "validator identity, algorithm, and key are required");
      if (identities.has(validator.validatorId)) throw new RegistryError("CONFLICT", `duplicate validator identity: ${validator.validatorId}`);
      const key = `${validator.algorithm}|${validator.publicKeyId}`; if (keys.has(key)) throw new RegistryError("CONFLICT", `validator key is shared: ${validator.publicKeyId}`);
      identities.add(validator.validatorId); keys.add(key);
    }
  }
  async request(input: GenericAttestationRequest): Promise<GenericAttestationRecord> {
    validateRequest(input); const hash = requestFingerprint(input); const existing = await this.store.get(input.id);
    if (existing) { if (existing.requestHash !== hash) throw new RegistryError("CONFLICT", `attestation ID was reused with different content: ${input.id}`); return structuredClone(existing); }
    if (this.now().getTime() < Date.parse(input.validFrom) || this.now().getTime() >= Date.parse(input.expiresAt)) return this.persist(input, hash, ["OUTSIDE_VALIDITY_WINDOW"]);
    if (input.threshold > this.validators.length) return this.persist(input, hash, ["INSUFFICIENT_CONFIGURED_VALIDATORS"]);
    const accepted: { validator: GenericAttestationValidator; observation: GenericSourceObservation }[] = []; const reasons: string[] = [];
    for (const validator of this.validators) {
      try { const observation = await validator.observe(structuredClone(input)); if (!observation) { reasons.push(`${validator.validatorId}:SOURCE_NOT_FOUND`); continue; } const mismatch = observationMismatch(input, observation); if (mismatch) { reasons.push(`${validator.validatorId}:${mismatch}`); continue; } accepted.push({ validator, observation }); }
      catch { reasons.push(`${validator.validatorId}:PROVIDER_ERROR`); }
    }
    if (accepted.length < input.threshold) return this.persist(input, hash, [...reasons, "INSUFFICIENT_THRESHOLD"]);
    const positions = new Set(accepted.map(({ observation }) => `${observation.observedStatePosition}|${observation.observedAt}`));
    if (positions.size !== 1) return this.persist(input, hash, [...reasons, "VALIDATOR_OBSERVATION_DISAGREEMENT"]);
    const first = accepted[0]!.observation; const statement: GenericAttestationStatement = { ...structuredClone(input), version: GENERIC_ATTESTATION_VERSION, observedStatePosition: first.observedStatePosition, observedAt: first.observedAt };
    const bytes = canonicalGenericAttestationBytes(statement); const signatures: ValidatorSignature[] = [];
    for (const { validator } of accepted) signatures.push({ validatorId: validator.validatorId, algorithm: validator.algorithm, publicKeyId: validator.publicKeyId, signature: await validator.sign(bytes), signedAt: this.now().toISOString() });
    signatures.sort((a, b) => a.validatorId.localeCompare(b.validatorId));
    const validatorEvidence = Object.fromEntries(accepted.map(({ validator, observation }) => [validator.validatorId, structuredClone(observation)]));
    const attestation: GenericStateAttestation = { statement, signatures, validatorEvidence, digest: genericAttestationDigest(statement), status: "VERIFIED_EVIDENCE_ONLY", destinationMutationAuthorized: false, recordedAt: this.now().toISOString() };
    const record: GenericAttestationRecord = { request: structuredClone(input), requestHash: hash, outcome: "VERIFIED", attestation, reasons, recordedAt: this.now().toISOString() }; await this.store.save(record); return structuredClone(record);
  }
  async persist(input: GenericAttestationRequest, hash: string, reasons: readonly string[]) { const record: GenericAttestationRecord = { request: structuredClone(input), requestHash: hash, outcome: "REJECTED", reasons, recordedAt: this.now().toISOString() }; await this.store.save(record); return structuredClone(record); }
}

export function canonicalGenericAttestationBytes(statement: GenericAttestationStatement): Uint8Array { validateStatement(statement); return new TextEncoder().encode(`${GENERIC_ATTESTATION_DOMAIN}|${statement.version}|${statement.sourceNetworkId}\0${canonicalJson(statement)}`); }
export function genericAttestationDigest(statement: GenericAttestationStatement): `sha256:${string}` { return `sha256:${createHash("sha256").update(canonicalGenericAttestationBytes(statement)).digest("hex")}`; }
export async function verifyGenericAttestation(attestation: GenericStateAttestation, threshold: number, verifier: AttestationSignatureVerifier, now: Date = new Date()): Promise<boolean> {
  validateStatement(attestation.statement); if (attestation.status !== "VERIFIED_EVIDENCE_ONLY" || attestation.destinationMutationAuthorized !== false || now.getTime() >= Date.parse(attestation.statement.expiresAt) || threshold < 1) return false;
  const seen = new Set<string>(); let valid = 0; const bytes = canonicalGenericAttestationBytes(attestation.statement);
  for (const signature of attestation.signatures) { if (seen.has(signature.validatorId)) continue; seen.add(signature.validatorId); if (await verifier.verify({ algorithm: signature.algorithm, publicKeyId: signature.publicKeyId, signature: signature.signature, bytes })) valid++; }
  return valid >= threshold && genericAttestationDigest(attestation.statement) === attestation.digest;
}
function observationMismatch(input: GenericAttestationRequest, value: GenericSourceObservation): string | undefined {
  if (value.networkId !== input.sourceNetworkId || value.networkType !== input.sourceNetworkType) return "NETWORK_MISMATCH";
  if (value.transactionId !== input.sourceTransactionId || value.eventPosition !== input.sourceEventPosition || value.predicateType !== input.predicateType) return "EVENT_MISMATCH";
  if (canonicalJson(value.claims) !== canonicalJson(input.claims)) return "CLAIMS_MISMATCH";
  if (!value.canonical) return "EVENT_NOT_CANONICAL"; if (!value.finalitySatisfied || value.finalityEvidence.length === 0) return "FINALITY_NOT_SATISFIED";
  if (!value.observedStatePosition.trim() || !Number.isFinite(Date.parse(value.observedAt))) return "INVALID_OBSERVATION"; return undefined;
}
function validateRequest(value: GenericAttestationRequest) {
  if (!value.id.startsWith("IW:ATTESTATION:") || !value.idempotencyKey.trim() || !value.sourceNetworkId.startsWith("IW:NETWORK:") || !value.sourceNetworkType.trim()) throw new RegistryError("INVALID_ARGUMENT", "attestation and network identifiers are required");
  for (const item of [value.sourceTransactionId, value.sourceEventPosition, value.predicateType, value.policyVersion, value.validatorSetId]) if (!item.trim()) throw new RegistryError("INVALID_ARGUMENT", "attestation source, predicate, policy, and validator set are required");
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(value.nonce)) throw new RegistryError("INVALID_ARGUMENT", "attestation nonce must contain 16-256 safe random characters");
  if (!Number.isSafeInteger(value.threshold) || value.threshold < 1) throw new RegistryError("INVALID_ARGUMENT", "threshold must be positive");
  if (Object.keys(value.claims).length === 0 || Object.keys(value.claims).some((key) => !key.trim())) throw new RegistryError("INVALID_ARGUMENT", "typed claims are required");
  const created = Date.parse(value.createdAt), valid = Date.parse(value.validFrom), expires = Date.parse(value.expiresAt); if (![created, valid, expires].every(Number.isFinite) || created > valid || valid >= expires) throw new RegistryError("INVALID_ARGUMENT", "attestation validity interval is invalid");
}
function validateStatement(value: GenericAttestationStatement) { validateRequest(value); if (value.version !== GENERIC_ATTESTATION_VERSION || !value.observedStatePosition.trim() || !Number.isFinite(Date.parse(value.observedAt))) throw new RegistryError("INVALID_ARGUMENT", "generic attestation statement is invalid"); }

export class InMemoryGenericAttestationStore implements GenericAttestationStore { readonly records = new Map<AttestationId, GenericAttestationRecord>(); async get(id: AttestationId) { const value = this.records.get(id); return value ? structuredClone(value) : undefined; } async save(record: GenericAttestationRecord) { if (this.records.has(record.request.id)) throw new RegistryError("CONFLICT", "attestation record is immutable"); this.records.set(record.request.id, structuredClone(record)); } }
type GenericRow = { record: GenericAttestationRecord };
export class PostgresGenericAttestationStore implements GenericAttestationStore {
  constructor(readonly db: SqlExecutor) {} async get(id: AttestationId) { const result = await this.db.query<GenericRow>("SELECT record FROM generic_attestations WHERE id=$1", [id]); const value = result.rows[0]?.record; return value ? structuredClone(value) : undefined; }
  async save(record: GenericAttestationRecord) { const result = await this.db.query("INSERT INTO generic_attestations (id,source_network_id,predicate_type,outcome,request_hash,record) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO NOTHING", [record.request.id, record.request.sourceNetworkId, record.request.predicateType, record.outcome, record.requestHash, JSON.stringify(record)]); if (result.rowCount !== 1) throw new RegistryError("CONFLICT", "attestation record is immutable"); }
}
