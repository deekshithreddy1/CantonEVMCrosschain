import assert from "node:assert/strict";
import test from "node:test";
import type { CreateBridgeOperation, DurableBridgeOperation, PersistedTransition, TransactionAttempt, TransactionStore, TransitionCommand } from "./transaction-engine.js";
import { canTransition, DurableTransactionEngine } from "./transaction-engine.js";
import type { LockMintEvidenceStore, LockMintStage, LockMintStageEvidence } from "./lock-mint-coordinator.js";
import { CantonToEvmLockMintCoordinator } from "./lock-mint-coordinator.js";
import { RegistryError } from "./registry-errors.js";

class MemoryTransactions implements TransactionStore {
  values = new Map<string, DurableBridgeOperation>(); attempts: TransactionAttempt[] = [];
  async create(input: CreateBridgeOperation, initial: PersistedTransition) { const value: DurableBridgeOperation = { ...input, state: "CREATED", version: 0, transitions: [initial] }; this.values.set(input.id, value); return structuredClone(value); }
  async get(id: CreateBridgeOperation["id"]) { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
  async findTransition(id: CreateBridgeOperation["id"], key: string) { return structuredClone(this.values.get(id)?.transitions.find((item) => item.transitionKey === key)); }
  async append(command: TransitionCommand) { const current = this.values.get(command.operationId); if (!current) throw new RegistryError("NOT_FOUND", "missing"); const duplicate = current.transitions.find((item) => item.transitionKey === command.transitionKey); if (duplicate) return structuredClone(current); if (current.version !== command.expectedVersion || !canTransition(current.state, command.to)) throw new RegistryError("CONFLICT", "invalid transition"); const transition: PersistedTransition = { transitionKey: command.transitionKey, sequence: current.version + 1, attempt: command.attempt, from: current.state, to: command.to, occurredAt: command.occurredAt, reason: command.reason, actor: command.actor }; const updated: DurableBridgeOperation = { ...current, state: command.to, version: current.version + 1, transitions: [...current.transitions, transition], ...(command.policyDecision ? { policyDecision: command.policyDecision } : {}) }; this.values.set(current.id, updated); return structuredClone(updated); }
  async recordAttempt(value: TransactionAttempt) { this.attempts.push(value); return structuredClone(value); }
  async listAttempts(id: CreateBridgeOperation["id"]) { return this.attempts.filter((item) => item.operationId === id).map((item) => structuredClone(item)); }
}
class MemoryEvidence implements LockMintEvidenceStore {
  values = new Map<string, LockMintStageEvidence>();
  async get(id: CreateBridgeOperation["id"], stage: LockMintStage) { const value = this.values.get(`${id}|${stage}`); return value ? structuredClone(value) : undefined; }
  async put(value: LockMintStageEvidence) { const key = `${value.operationId}|${value.stage}`; const existing = this.values.get(key); if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new RegistryError("CONFLICT", "immutable evidence"); if (!existing) this.values.set(key, structuredClone(value)); return structuredClone(existing ?? value); }
}
const time = "2026-08-11T12:00:00.000Z";
const input: CreateBridgeOperation = { id: "IW:BRIDGE:lock-mint-1", idempotencyKey: "lock-mint-request-1", assetId: "IW:ASSET:rwa", sourceNetworkId: "IW:NETWORK:canton", destinationNetworkId: "IW:NETWORK:evm", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", amount: "100", createdAt: time, expiresAt: "2026-08-11T13:00:00.000Z", actor: "test" };
const allow = { outcome: "ALLOW" as const, reasonCodes: ["GOLDEN_PATH_ASSET"], policyId: "IW:POLICY:bridge" as const, policyVersion: "1", decidedAt: time };

async function fixture(options: { reconciliationMatched?: boolean; attestationExpiresAt?: string } = {}) {
  const transactions = new MemoryTransactions(); const engine = new DurableTransactionEngine(transactions); await engine.create(input); const evidence = new MemoryEvidence();
  const calls = { lock: 0, mint: 0, attest: 0, reconcile: 0 };
  const coordinator = new CantonToEvmLockMintCoordinator({ transactions: engine, transactionStore: transactions, evidence, policy: { evaluate: async () => allow },
    source: { lock: async () => { calls.lock++; return { transactionId: "canton-tx-1", lockId: "locked-contract-1" }; }, confirm: async () => ({ confirmed: true, position: "offset:10" }), finalize: async () => ({ finalized: true, position: "offset:10", evidenceId: "finality:canton:1" }) },
    attestations: { attest: async () => { calls.attest++; return { satisfied: true, attestation: { digest: "sha256:attestation", validatorSetId: "set-1", signatureCount: "2", threshold: "2", expiresAt: options.attestationExpiresAt ?? "2026-08-11T12:30:00.000Z" } }; } },
    destination: { mint: async () => { calls.mint++; return { transactionId: "0xmint", outcome: "EXECUTED" as const }; }, confirm: async () => ({ confirmed: true, blockNumber: "20" }), finalize: async () => ({ finalized: true, position: "finalized:25", evidenceId: "finality:evm:1" }) },
    reconciliation: { reconcile: async () => { calls.reconcile++; return { matched: options.reconciliationMatched ?? true, sourceLocked: "100", destinationSupply: options.reconciliationMatched === false ? "101" : "100", evidenceId: "reconcile:1" }; } }, now: () => new Date(time) });
  return { coordinator, transactions, engine, evidence, calls };
}

test("Canton lock to EVM mint persists every durable stage and completes once", async () => {
  const value = await fixture(); const operation = await value.coordinator.run(input.id);
  assert.equal(operation.state, "COMPLETED"); assert.equal(operation.transitions.length, 15); assert.equal(value.evidence.values.size, 8);
  assert.deepEqual(value.calls, { lock: 1, mint: 1, attest: 1, reconcile: 1 });
  const replay = await value.coordinator.run(input.id); assert.equal(replay.state, "COMPLETED"); assert.deepEqual(value.calls, { lock: 1, mint: 1, attest: 1, reconcile: 1 });
});

test("restart resumes from immutable source evidence without submitting a duplicate lock", async () => {
  const value = await fixture(); let operation = (await value.transactions.get(input.id))!;
  operation = await value.engine.transition({ operationId: input.id, transitionKey: `${input.id}:POLICY_CHECKED`, expectedVersion: operation.version, to: "POLICY_CHECKED", occurredAt: time, reason: "policy evaluated", actor: "test", attempt: 1, policyDecision: allow });
  operation = await value.engine.transition({ operationId: input.id, transitionKey: `${input.id}:SOURCE_PREPARING`, expectedVersion: operation.version, to: "SOURCE_PREPARING", occurredAt: time, reason: "prepare", actor: "test", attempt: 1 });
  await value.evidence.put({ operationId: input.id, stage: "SOURCE_LOCK", recordedAt: time, data: { transactionId: "canton-tx-before-crash", lockId: "lock-before-crash" } });
  const completed = await value.coordinator.run(input.id); assert.equal(completed.state, "COMPLETED"); assert.equal(value.calls.lock, 0); assert.equal(value.calls.mint, 1);
});

test("a backing mismatch fails reconciliation and never reports completion", async () => {
  const value = await fixture({ reconciliationMatched: false }); const operation = await value.coordinator.run(input.id);
  assert.equal(operation.state, "RECONCILIATION_FAILED"); assert.equal(operation.transitions.some((item) => item.to === "COMPLETED"), false);
});

test("an expired threshold attestation cannot reach the destination mint", async () => {
  const value = await fixture({ attestationExpiresAt: time }); const operation = await value.coordinator.run(input.id);
  assert.equal(operation.state, "DESTINATION_FAILED"); assert.equal(value.calls.mint, 0);
});
