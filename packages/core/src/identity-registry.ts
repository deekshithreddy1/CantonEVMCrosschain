import type { Identity, IdentityId, IsoTimestamp, NetworkIdentity, NetworkIdentityLocator, NetworkId } from "./model.js";
import type { NetworkRegistry } from "./network-registry.js";
import { RegistryError } from "./registry-errors.js";
import { assertEvmAddress } from "./evm-adapter.js";

export type IdentityChallengeId = `IW:IDENTITY_CHALLENGE:${string}`;
export type BindingId = `IW:BINDING:${string}`;
export type IdentityProofKind = "EVM_PERSONAL_SIGN" | "CANTON_AUTHORIZED_COMMAND";

export interface IdentityChallenge {
  id: IdentityChallengeId;
  identityId: IdentityId;
  networkId: NetworkId;
  locator: NetworkIdentityLocator;
  proofKind: IdentityProofKind;
  nonce: string;
  message: string;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  consumedAt?: IsoTimestamp;
}

export interface IdentityProof {
  kind: IdentityProofKind;
  proof: string;
  keyId?: string;
}

export interface VerifiedIdentityProof {
  method: string;
  proofFingerprint: string;
}

export interface IdentityProofVerifier {
  readonly kind: IdentityProofKind;
  verify(challenge: IdentityChallenge, proof: IdentityProof): Promise<VerifiedIdentityProof | undefined>;
}

export interface IdentityBindingAuditEvent {
  eventId: `IW:IDENTITY_AUDIT:${string}`;
  identityId: IdentityId;
  bindingId?: BindingId;
  challengeId?: IdentityChallengeId;
  action: "IDENTITY_CREATED" | "CHALLENGE_ISSUED" | "BINDING_VERIFIED" | "BINDING_REVOKED";
  actor: string;
  occurredAt: IsoTimestamp;
  proofFingerprint?: string;
}

export interface IdentityRegistryDependencies {
  networks: NetworkRegistry;
  verifiers: readonly IdentityProofVerifier[];
  now: () => Date;
  randomId: () => string;
}

export interface IdentityRegistry {
  createIdentity(input: { id: IdentityId; displayName?: string }, actor: string): Promise<Identity>;
  getIdentity(id: IdentityId): Promise<Identity | undefined>;
  issueChallenge(input: { identityId: IdentityId; networkId: NetworkId; locator: NetworkIdentityLocator; ttlSeconds: number }, actor: string): Promise<IdentityChallenge>;
  verifyChallenge(challengeId: IdentityChallengeId, proof: IdentityProof, bindingExpiresAt: IsoTimestamp | undefined, actor: string): Promise<NetworkIdentity>;
  revokeBinding(identityId: IdentityId, bindingId: BindingId, actor: string): Promise<NetworkIdentity>;
  activeBindings(identityId: IdentityId, networkId?: NetworkId): Promise<readonly NetworkIdentity[]>;
  auditTrail(identityId: IdentityId): Promise<readonly IdentityBindingAuditEvent[]>;
}

export function identityChallengeMessage(challenge: Omit<IdentityChallenge, "message" | "consumedAt">): string {
  const locator = challenge.locator.kind === "EVM"
    ? `EVM:${challenge.locator.address.toLowerCase()}`
    : `CANTON:${challenge.locator.party}`;
  return ["InterWeave Identity Binding", "Version: 1", `Challenge: ${challenge.id}`, `Identity: ${challenge.identityId}`, `Network: ${challenge.networkId}`, `Locator: ${locator}`, `Nonce: ${challenge.nonce}`, `Issued At: ${challenge.issuedAt}`, `Expires At: ${challenge.expiresAt}`].join("\n");
}

export class InMemoryIdentityRegistry implements IdentityRegistry {
  readonly #identities = new Map<IdentityId, Identity>();
  readonly #challenges = new Map<IdentityChallengeId, IdentityChallenge>();
  readonly #audit: IdentityBindingAuditEvent[] = [];
  readonly #verifiers: ReadonlyMap<IdentityProofKind, IdentityProofVerifier>;
  constructor(readonly dependencies: IdentityRegistryDependencies) { this.#verifiers = new Map(dependencies.verifiers.map((verifier) => [verifier.kind, verifier])); }

  async createIdentity(input: { id: IdentityId; displayName?: string }, actor: string): Promise<Identity> {
    if (!input.id.startsWith("IW:IDENTITY:") || input.id.length === "IW:IDENTITY:".length) throw new RegistryError("INVALID_ARGUMENT", "invalid identity ID");
    if (!actor.trim()) throw new RegistryError("INVALID_ARGUMENT", "audit actor is required");
    if (input.displayName !== undefined && !input.displayName.trim()) throw new RegistryError("INVALID_ARGUMENT", "display name cannot be blank");
    if (this.#identities.has(input.id)) throw new RegistryError("ALREADY_EXISTS", `identity already exists: ${input.id}`);
    const createdAt = this.#timestamp();
    const identity: Identity = input.displayName === undefined ? { id: input.id, bindings: [], createdAt } : { id: input.id, displayName: input.displayName, bindings: [], createdAt };
    this.#identities.set(input.id, identity); this.#record({ identityId: input.id, action: "IDENTITY_CREATED", actor, occurredAt: createdAt });
    return structuredClone(identity);
  }

  async getIdentity(id: IdentityId): Promise<Identity | undefined> { const identity = this.#identities.get(id); return identity ? structuredClone(identity) : undefined; }

  async issueChallenge(input: { identityId: IdentityId; networkId: NetworkId; locator: NetworkIdentityLocator; ttlSeconds: number }, actor: string): Promise<IdentityChallenge> {
    this.#assertActor(actor);
    if (!this.#identities.has(input.identityId)) throw new RegistryError("NOT_FOUND", `identity not found: ${input.identityId}`);
    const network = await this.dependencies.networks.get(input.networkId);
    if (!network || !network.enabled) throw new RegistryError("NOT_FOUND", `enabled network not found: ${input.networkId}`);
    if (network.type !== input.locator.kind) throw new RegistryError("INVALID_ARGUMENT", "identity locator does not match network type");
    if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 900) throw new RegistryError("INVALID_ARGUMENT", "challenge TTL must be from 1 to 900 seconds");
    const locator = this.#normalizeLocator(input.locator);
    const now = this.dependencies.now(); const id = `IW:IDENTITY_CHALLENGE:${this.dependencies.randomId()}` as const;
    const base = { id, identityId: input.identityId, networkId: input.networkId, locator, proofKind: locator.kind === "EVM" ? "EVM_PERSONAL_SIGN" as const : "CANTON_AUTHORIZED_COMMAND" as const, nonce: this.dependencies.randomId(), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString() };
    const challenge: IdentityChallenge = { ...base, message: identityChallengeMessage(base) };
    this.#challenges.set(id, challenge); this.#record({ identityId: input.identityId, challengeId: id, action: "CHALLENGE_ISSUED", actor, occurredAt: base.issuedAt });
    return structuredClone(challenge);
  }

  async verifyChallenge(challengeId: IdentityChallengeId, proof: IdentityProof, bindingExpiresAt: IsoTimestamp | undefined, actor: string): Promise<NetworkIdentity> {
    this.#assertActor(actor);
    const challenge = this.#challenges.get(challengeId);
    if (!challenge) throw new RegistryError("NOT_FOUND", `challenge not found: ${challengeId}`);
    if (challenge.consumedAt) throw new RegistryError("CONFLICT", "challenge has already been consumed");
    const now = this.dependencies.now();
    if (now.getTime() >= Date.parse(challenge.expiresAt)) throw new RegistryError("CONFLICT", "challenge has expired");
    if (proof.kind !== challenge.proofKind) throw new RegistryError("INVALID_ARGUMENT", "proof kind does not match challenge");
    if (bindingExpiresAt !== undefined && (!Number.isFinite(Date.parse(bindingExpiresAt)) || Date.parse(bindingExpiresAt) <= now.getTime())) throw new RegistryError("INVALID_ARGUMENT", "binding expiry must be a valid future timestamp");
    const verifier = this.#verifiers.get(proof.kind);
    if (!verifier) throw new RegistryError("INVALID_ARGUMENT", `no verifier configured for ${proof.kind}`);
    const verified = await verifier.verify(structuredClone(challenge), proof);
    if (!verified) throw new RegistryError("INVALID_ARGUMENT", "proof of control verification failed");
    const identity = this.#identities.get(challenge.identityId);
    if (!identity) throw new RegistryError("NOT_FOUND", `identity not found: ${challenge.identityId}`);
    const key = this.#locatorKey(challenge.networkId, challenge.locator);
    for (const candidate of this.#identities.values()) for (const binding of candidate.bindings) {
      if (!binding.revokedAt && (!binding.expiresAt || Date.parse(binding.expiresAt) > now.getTime()) && this.#locatorKey(binding.networkId, binding.locator) === key) throw new RegistryError("CONFLICT", "network identity already has an active binding");
    }
    const bindingId = `IW:BINDING:${this.dependencies.randomId()}` as const;
    const binding: NetworkIdentity = { bindingId, networkId: challenge.networkId, locator: challenge.locator, proofMethod: verified.method, verifiedAt: now.toISOString(), ...(bindingExpiresAt === undefined ? {} : { expiresAt: bindingExpiresAt }) };
    this.#identities.set(identity.id, { ...identity, bindings: [...identity.bindings, binding] });
    this.#challenges.set(challengeId, { ...challenge, consumedAt: now.toISOString() });
    this.#record({ identityId: identity.id, bindingId, challengeId, action: "BINDING_VERIFIED", actor, occurredAt: now.toISOString(), proofFingerprint: verified.proofFingerprint });
    return structuredClone(binding);
  }

  async revokeBinding(identityId: IdentityId, bindingId: BindingId, actor: string): Promise<NetworkIdentity> {
    this.#assertActor(actor);
    const identity = this.#identities.get(identityId); if (!identity) throw new RegistryError("NOT_FOUND", `identity not found: ${identityId}`);
    const binding = identity.bindings.find((item) => item.bindingId === bindingId); if (!binding) throw new RegistryError("NOT_FOUND", `binding not found: ${bindingId}`);
    if (binding.revokedAt) throw new RegistryError("CONFLICT", "binding is already revoked");
    const occurredAt = this.#timestamp(); const revoked = { ...binding, revokedAt: occurredAt };
    this.#identities.set(identityId, { ...identity, bindings: identity.bindings.map((item) => item.bindingId === bindingId ? revoked : item) });
    this.#record({ identityId, bindingId, action: "BINDING_REVOKED", actor, occurredAt }); return structuredClone(revoked);
  }

  async activeBindings(identityId: IdentityId, networkId?: NetworkId): Promise<readonly NetworkIdentity[]> {
    const identity = this.#identities.get(identityId); if (!identity) throw new RegistryError("NOT_FOUND", `identity not found: ${identityId}`);
    const now = this.dependencies.now().getTime(); return identity.bindings.filter((binding) => !binding.revokedAt && (!binding.expiresAt || Date.parse(binding.expiresAt) > now) && (networkId === undefined || binding.networkId === networkId)).map((binding) => structuredClone(binding));
  }
  async auditTrail(identityId: IdentityId): Promise<readonly IdentityBindingAuditEvent[]> { return this.#audit.filter((event) => event.identityId === identityId).map((event) => structuredClone(event)); }

  #normalizeLocator(locator: NetworkIdentityLocator): NetworkIdentityLocator { if (locator.kind === "EVM") { assertEvmAddress(locator.address); return { kind: "EVM", address: locator.address.toLowerCase() }; } if (!locator.party.trim()) throw new RegistryError("INVALID_ARGUMENT", "Canton party is required"); return structuredClone(locator); }
  #locatorKey(networkId: NetworkId, locator: NetworkIdentityLocator): string { return `${networkId}|${locator.kind}|${locator.kind === "EVM" ? locator.address.toLowerCase() : locator.party}`; }
  #timestamp(): IsoTimestamp { return this.dependencies.now().toISOString(); }
  #assertActor(actor: string): void { if (!actor.trim()) throw new RegistryError("INVALID_ARGUMENT", "audit actor is required"); }
  #record(event: Omit<IdentityBindingAuditEvent, "eventId">): void { this.#assertActor(event.actor); this.#audit.push({ eventId: `IW:IDENTITY_AUDIT:${this.dependencies.randomId()}`, ...event }); }
}
