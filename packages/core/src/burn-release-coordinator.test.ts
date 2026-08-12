import assert from "node:assert/strict";
import test from "node:test";
import type { CreateBridgeOperation, DurableBridgeOperation, PersistedTransition, TransactionAttempt, TransactionStore, TransitionCommand } from "./transaction-engine.js";
import { canTransition, DurableTransactionEngine } from "./transaction-engine.js";
import type { BurnReleaseEvidenceStore, BurnReleaseStage, BurnReleaseStageEvidence } from "./burn-release-coordinator.js";
import { EvmToCantonBurnReleaseCoordinator } from "./burn-release-coordinator.js";
import { RegistryError } from "./registry-errors.js";

class Transactions implements TransactionStore {
  values = new Map<string, DurableBridgeOperation>();
  async create(input: CreateBridgeOperation, initial: PersistedTransition) { const value: DurableBridgeOperation = { ...input, state: "CREATED", version: 0, transitions: [initial] }; this.values.set(input.id, value); return structuredClone(value); }
  async get(id: CreateBridgeOperation["id"]) { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
  async findTransition(id: CreateBridgeOperation["id"], key: string) { return structuredClone(this.values.get(id)?.transitions.find((item) => item.transitionKey === key)); }
  async append(command: TransitionCommand) { const current = this.values.get(command.operationId); if (!current) throw new RegistryError("NOT_FOUND", "missing"); const duplicate = current.transitions.find((item) => item.transitionKey === command.transitionKey); if (duplicate) return structuredClone(current); if (current.version !== command.expectedVersion || !canTransition(current.state, command.to)) throw new RegistryError("CONFLICT", "invalid transition"); const transition: PersistedTransition = { transitionKey: command.transitionKey, sequence: current.version + 1, attempt: command.attempt, from: current.state, to: command.to, occurredAt: command.occurredAt, reason: command.reason, actor: command.actor }; const updated: DurableBridgeOperation = { ...current, state: command.to, version: current.version + 1, transitions: [...current.transitions, transition], ...(command.policyDecision ? { policyDecision: command.policyDecision } : {}) }; this.values.set(current.id, updated); return structuredClone(updated); }
  async recordAttempt(value: TransactionAttempt) { return structuredClone(value); }
  async listAttempts(_id: CreateBridgeOperation["id"]) { return [] as readonly TransactionAttempt[]; }
}
class Evidence implements BurnReleaseEvidenceStore {
  values = new Map<string, BurnReleaseStageEvidence>();
  async get(id: CreateBridgeOperation["id"], stage: BurnReleaseStage) { const value = this.values.get(`${id}|${stage}`); return value ? structuredClone(value) : undefined; }
  async put(value: BurnReleaseStageEvidence) { const key = `${value.operationId}|${value.stage}`; const existing = this.values.get(key); if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new RegistryError("CONFLICT", "immutable evidence"); if (!existing) this.values.set(key, structuredClone(value)); return structuredClone(existing ?? value); }
}
const time = "2026-08-11T12:00:00.000Z";
const input: CreateBridgeOperation = { id: "IW:BRIDGE:burn-release-1", idempotencyKey: "burn-release-request-1", assetId: "IW:ASSET:rwa", sourceNetworkId: "IW:NETWORK:evm", destinationNetworkId: "IW:NETWORK:canton", sender: "IW:IDENTITY:bob", receiver: "IW:IDENTITY:alice", amount: "40", createdAt: time, expiresAt: "2026-08-11T13:00:00.000Z", actor: "test" };
const allow = { outcome: "ALLOW" as const, reasonCodes: ["ROUND_TRIP"], policyId: "IW:POLICY:bridge" as const, policyVersion: "1", decidedAt: time };

async function fixture(options: { matched?: boolean; attestationExpiresAt?: string } = {}) {
  const transactions = new Transactions(); const engine = new DurableTransactionEngine(transactions); await engine.create(input); const evidence = new Evidence(); const calls = { burn: 0, attest: 0, release: 0, reconcile: 0 };
  const coordinator = new EvmToCantonBurnReleaseCoordinator({ transactions: engine, transactionStore: transactions, evidence, policy: { evaluate: async () => allow },
    source: { burn: async () => { calls.burn++; return { transactionId: "0xburn", outcome: "EXECUTED" as const }; }, confirm: async () => ({ confirmed: true, blockNumber: "30" }), finalize: async () => ({ finalized: true, position: "finalized:35", evidenceId: "evm-finality:burn" }) },
    attestations: { attest: async () => { calls.attest++; return { satisfied: true, attestation: { digest: "sha256:burn", validatorSetId: "set-1", signatureCount: "2", threshold: "2", expiresAt: options.attestationExpiresAt ?? "2026-08-11T12:30:00.000Z" } }; } },
    destination: { release: async () => { calls.release++; return { transactionId: "canton-release-tx", authorizationId: "release-auth-1", outcome: "EXECUTED" as const }; }, confirm: async () => ({ confirmed: true, position: "offset:50" }), finalize: async () => ({ finalized: true, position: "offset:50", evidenceId: "canton-finality:release" }) },
    reconciliation: { reconcile: async () => { calls.reconcile++; return { matched: options.matched ?? true, sourceBacking: "60", destinationSupply: options.matched === false ? "61" : "60", releasedAmount: "40", evidenceId: "reconcile:round-trip" }; } }, now: () => new Date(time) });
  return { coordinator, transactions, engine, evidence, calls };
}

test("EVM burn to Canton release completes once and preserves round-trip supply", async () => {
  const value = await fixture(); const operation = await value.coordinator.run(input.id);
  assert.equal(operation.state, "COMPLETED"); assert.equal(operation.transitions.length, 15); assert.equal(value.evidence.values.size, 8); assert.deepEqual(value.calls, { burn: 1, attest: 1, release: 1, reconcile: 1 });
  await value.coordinator.run(input.id); assert.deepEqual(value.calls, { burn: 1, attest: 1, release: 1, reconcile: 1 });
});

test("restart reuses persisted burn evidence instead of burning twice", async () => {
  const value = await fixture(); let operation = (await value.transactions.get(input.id))!;
  operation = await value.engine.transition({ operationId: input.id, transitionKey: `${input.id}:POLICY_CHECKED`, expectedVersion: operation.version, to: "POLICY_CHECKED", occurredAt: time, reason: "policy", actor: "test", attempt: 1, policyDecision: allow });
  operation = await value.engine.transition({ operationId: input.id, transitionKey: `${input.id}:SOURCE_PREPARING`, expectedVersion: operation.version, to: "SOURCE_PREPARING", occurredAt: time, reason: "prepare", actor: "test", attempt: 1 });
  await value.evidence.put({ operationId: input.id, stage: "SOURCE_BURN", recordedAt: time, data: { transactionId: "0xburn-before-crash", outcome: "ALREADY_PROCESSED" } });
  assert.equal((await value.coordinator.run(input.id)).state, "COMPLETED"); assert.equal(value.calls.burn, 0); assert.equal(value.calls.release, 1);
});

test("expired attestations and round-trip mismatches cannot complete release", async () => {
  const expired = await fixture({ attestationExpiresAt: time }); const expiredOperation = await expired.coordinator.run(input.id); assert.equal(expiredOperation.state, "DESTINATION_FAILED"); assert.equal(expired.calls.release, 0);
  const mismatch = await fixture({ matched: false }); const mismatchedOperation = await mismatch.coordinator.run(input.id); assert.equal(mismatchedOperation.state, "RECONCILIATION_FAILED"); assert.equal(mismatchedOperation.transitions.some((item) => item.to === "COMPLETED"), false);
});
