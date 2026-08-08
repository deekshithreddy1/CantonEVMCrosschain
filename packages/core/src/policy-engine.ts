import type { Asset, AtomicAmount, IdentityId, IsoTimestamp, NetworkId, Policy, PolicyDecision, PolicyId } from "./model.js";
import { parseAtomicAmount } from "./invariants.js";
import { RegistryError } from "./registry-errors.js";

export type PolicyOperation = "TRANSFER" | "BRIDGE" | "SETTLEMENT" | "WORKFLOW" | (string & {});
export type PolicyOutcome = PolicyDecision["outcome"];

export interface PolicyInput {
  asset: Readonly<Pick<Asset, "id" | "status" | "capabilities">>;
  sender: IdentityId;
  receiver: IdentityId;
  senderHasActiveSourceBinding: boolean;
  receiverHasActiveDestinationBinding: boolean;
  amount: AtomicAmount;
  operation: PolicyOperation;
  sourceNetworkId: NetworkId;
  destinationNetworkId?: NetworkId;
  metadata: Readonly<Record<string, string>>;
  evaluatedAt: IsoTimestamp;
}

export type PolicyCondition =
  | { kind: "ALWAYS" }
  | { kind: "AMOUNT_GREATER_THAN"; amount: AtomicAmount }
  | { kind: "AMOUNT_AT_MOST"; amount: AtomicAmount }
  | { kind: "ASSET_STATUS_IN"; statuses: readonly Asset["status"][] }
  | { kind: "OPERATION_IN"; operations: readonly PolicyOperation[] }
  | { kind: "NETWORK_PAIR_IN"; pairs: readonly { source: NetworkId; destination?: NetworkId }[] }
  | { kind: "MISSING_REQUIRED_BINDING"; side: "SENDER" | "RECEIVER" | "EITHER" }
  | { kind: "METADATA_EQUALS"; key: string; value: string }
  | { kind: "METADATA_MISSING"; key: string };

export interface PolicyRule {
  id: string;
  when: PolicyCondition;
  outcome: PolicyOutcome;
  reasonCode: string;
}

export interface PolicyDefinition extends Policy {
  defaultOutcome: Exclude<PolicyOutcome, "ALLOW">;
  defaultReasonCode: string;
  rules: readonly PolicyRule[];
}

export interface PolicyRegistry {
  register(policy: PolicyDefinition): Promise<PolicyDefinition>;
  get(id: PolicyId, version: string): Promise<PolicyDefinition | undefined>;
  activate(id: PolicyId, version: string): Promise<PolicyDefinition>;
  getActive(id: PolicyId): Promise<PolicyDefinition | undefined>;
}

export class InMemoryPolicyRegistry implements PolicyRegistry {
  readonly #policies = new Map<string, PolicyDefinition>();
  #key(id: PolicyId, version: string): string { return `${id}@${version}`; }
  async register(policy: PolicyDefinition): Promise<PolicyDefinition> {
    assertPolicyDefinition(policy); const key = this.#key(policy.id, policy.version);
    if (this.#policies.has(key)) throw new RegistryError("ALREADY_EXISTS", `policy version already exists: ${key}`);
    if (policy.status === "ACTIVE" && [...this.#policies.values()].some((item) => item.id === policy.id && item.status === "ACTIVE")) throw new RegistryError("CONFLICT", `policy already has an active version: ${policy.id}`);
    const stored = structuredClone(policy); this.#policies.set(key, stored); return structuredClone(stored);
  }
  async get(id: PolicyId, version: string): Promise<PolicyDefinition | undefined> { const policy = this.#policies.get(this.#key(id, version)); return policy ? structuredClone(policy) : undefined; }
  async getActive(id: PolicyId): Promise<PolicyDefinition | undefined> { const policy = [...this.#policies.values()].find((item) => item.id === id && item.status === "ACTIVE"); return policy ? structuredClone(policy) : undefined; }
  async activate(id: PolicyId, version: string): Promise<PolicyDefinition> {
    const key = this.#key(id, version); const selected = this.#policies.get(key);
    if (!selected) throw new RegistryError("NOT_FOUND", `policy version not found: ${key}`);
    if (selected.status === "RETIRED") throw new RegistryError("CONFLICT", "retired policy versions cannot be reactivated");
    for (const [candidateKey, policy] of this.#policies) if (policy.id === id && policy.status === "ACTIVE") this.#policies.set(candidateKey, { ...policy, status: "RETIRED" });
    const activated = { ...selected, status: "ACTIVE" as const }; this.#policies.set(key, activated); return structuredClone(activated);
  }
}

export function assertPolicyDefinition(policy: PolicyDefinition): void {
  if (!policy.id.startsWith("IW:POLICY:") || policy.id.length === "IW:POLICY:".length) throw new RegistryError("INVALID_ARGUMENT", "invalid policy ID");
  if (!/^[1-9][0-9]*(\.[0-9]+){0,2}$/.test(policy.version)) throw new RegistryError("INVALID_ARGUMENT", "policy version must be numeric and explicit");
  if (!policy.documentHash.trim()) throw new RegistryError("INVALID_ARGUMENT", "policy document hash is required");
  assertReasonCode(policy.defaultReasonCode);
  if (policy.rules.length === 0) throw new RegistryError("INVALID_ARGUMENT", "a policy must contain at least one explicit rule");
  const ids = new Set<string>();
  for (const rule of policy.rules) {
    if (!/^[A-Za-z0-9._-]+$/.test(rule.id) || ids.has(rule.id)) throw new RegistryError("INVALID_ARGUMENT", `invalid or duplicate rule ID: ${rule.id}`);
    ids.add(rule.id); assertReasonCode(rule.reasonCode); assertCondition(rule.when);
  }
}

function assertReasonCode(value: string): void { if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) throw new RegistryError("INVALID_ARGUMENT", `invalid policy reason code: ${value}`); }
function assertCondition(condition: PolicyCondition): void {
  if (condition.kind === "AMOUNT_GREATER_THAN" || condition.kind === "AMOUNT_AT_MOST") parseAtomicAmount(condition.amount);
  if ((condition.kind === "METADATA_EQUALS" || condition.kind === "METADATA_MISSING") && !condition.key.trim()) throw new RegistryError("INVALID_ARGUMENT", "metadata condition key is required");
  if (condition.kind === "OPERATION_IN" && condition.operations.length === 0) throw new RegistryError("INVALID_ARGUMENT", "operation condition cannot be empty");
  if (condition.kind === "ASSET_STATUS_IN" && condition.statuses.length === 0) throw new RegistryError("INVALID_ARGUMENT", "asset status condition cannot be empty");
  if (condition.kind === "NETWORK_PAIR_IN" && condition.pairs.length === 0) throw new RegistryError("INVALID_ARGUMENT", "network pair condition cannot be empty");
}

export class DeterministicPolicyEngine {
  evaluate(policy: PolicyDefinition, input: PolicyInput): PolicyDecision {
    assertPolicyDefinition(policy);
    if (policy.status !== "ACTIVE") return { outcome: "DENY", reasonCodes: ["POLICY_NOT_ACTIVE"], policyId: policy.id, policyVersion: policy.version, decidedAt: input.evaluatedAt, matchedRuleIds: [] };
    parseAtomicAmount(input.amount); this.#assertTimestamp(input.evaluatedAt);
    const matched = policy.rules.filter((rule) => conditionMatches(rule.when, input));
    if (matched.length === 0) return { outcome: policy.defaultOutcome, reasonCodes: [policy.defaultReasonCode], policyId: policy.id, policyVersion: policy.version, decidedAt: input.evaluatedAt, matchedRuleIds: [] };
    const strongest = matched.reduce<PolicyOutcome>((outcome, rule) => strength(rule.outcome) > strength(outcome) ? rule.outcome : outcome, "ALLOW");
    const decisive = matched.filter((rule) => rule.outcome === strongest);
    return { outcome: strongest, reasonCodes: [...new Set(decisive.map((rule) => rule.reasonCode))].sort(), policyId: policy.id, policyVersion: policy.version, decidedAt: input.evaluatedAt, matchedRuleIds: decisive.map((rule) => rule.id).sort() };
  }
  #assertTimestamp(value: string): void { if (!Number.isFinite(Date.parse(value))) throw new RegistryError("INVALID_ARGUMENT", "evaluation timestamp is invalid"); }
}

function strength(outcome: PolicyOutcome): number { return outcome === "DENY" ? 3 : outcome === "REQUIRES_APPROVAL" ? 2 : 1; }
export function conditionMatches(condition: PolicyCondition, input: PolicyInput): boolean {
  switch (condition.kind) {
    case "ALWAYS": return true;
    case "AMOUNT_GREATER_THAN": return parseAtomicAmount(input.amount) > parseAtomicAmount(condition.amount);
    case "AMOUNT_AT_MOST": return parseAtomicAmount(input.amount) <= parseAtomicAmount(condition.amount);
    case "ASSET_STATUS_IN": return condition.statuses.includes(input.asset.status);
    case "OPERATION_IN": return condition.operations.includes(input.operation);
    case "NETWORK_PAIR_IN": return condition.pairs.some((pair) => pair.source === input.sourceNetworkId && pair.destination === input.destinationNetworkId);
    case "MISSING_REQUIRED_BINDING": return condition.side === "SENDER" ? !input.senderHasActiveSourceBinding : condition.side === "RECEIVER" ? !input.receiverHasActiveDestinationBinding : !input.senderHasActiveSourceBinding || !input.receiverHasActiveDestinationBinding;
    case "METADATA_EQUALS": return input.metadata[condition.key] === condition.value;
    case "METADATA_MISSING": return input.metadata[condition.key] === undefined;
  }
}

/** Public preflight facade. It returns the exact decision shape stored by transactions. */
export class TransferPolicyPreflight {
  constructor(readonly registry: PolicyRegistry, readonly engine: DeterministicPolicyEngine) {}
  async canTransfer(policyId: PolicyId, input: PolicyInput): Promise<PolicyDecision> {
    const policy = await this.registry.getActive(policyId);
    if (!policy) return { outcome: "DENY", reasonCodes: ["NO_ACTIVE_POLICY"], policyId, policyVersion: "NONE", decidedAt: input.evaluatedAt, matchedRuleIds: [] };
    return this.engine.evaluate(policy, input);
  }
}
