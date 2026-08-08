import assert from "node:assert/strict";
import test from "node:test";
import { canTransition, DurableTransactionEngine } from "./transaction-engine.js";
import type { CreateBridgeOperation, DurableBridgeOperation, PersistedTransition, TransactionAttempt, TransactionStore, TransitionCommand } from "./transaction-engine.js";
import { RegistryError } from "./registry-errors.js";

class TestTransactionStore implements TransactionStore {
  readonly operations = new Map<string, DurableBridgeOperation>(); readonly attempts = new Map<string, TransactionAttempt>();
  async create(input: CreateBridgeOperation, initial: PersistedTransition): Promise<DurableBridgeOperation> {
    if (this.operations.has(input.id)) throw new RegistryError("ALREADY_EXISTS", "exists");
    const operation: DurableBridgeOperation = { ...input, state: "CREATED", version: 0, transitions: [initial] }; this.operations.set(input.id, structuredClone(operation)); return structuredClone(operation);
  }
  async get(id: CreateBridgeOperation["id"]): Promise<DurableBridgeOperation | undefined> { const value = this.operations.get(id); return value ? structuredClone(value) : undefined; }
  async findTransition(id: CreateBridgeOperation["id"], key: string): Promise<PersistedTransition | undefined> { return structuredClone(this.operations.get(id)?.transitions.find((item) => item.transitionKey === key)); }
  async append(command: TransitionCommand): Promise<DurableBridgeOperation> {
    const operation = this.operations.get(command.operationId); if (!operation) throw new RegistryError("NOT_FOUND", "missing");
    const duplicate = operation.transitions.find((item) => item.transitionKey === command.transitionKey);
    if (duplicate) { if (duplicate.to !== command.to) throw new RegistryError("CONFLICT", "key reused"); return structuredClone(operation); }
    if (operation.version !== command.expectedVersion) throw new RegistryError("CONFLICT", "stale version");
    if (!canTransition(operation.state, command.to)) throw new RegistryError("CONFLICT", "illegal transition");
    const transition: PersistedTransition = { transitionKey: command.transitionKey, sequence: operation.version + 1, attempt: command.attempt, from: operation.state, to: command.to, occurredAt: command.occurredAt, reason: command.reason, actor: command.actor };
    const policyDecision = command.policyDecision ?? operation.policyDecision;
    const updated: DurableBridgeOperation = { ...operation, state: command.to, version: operation.version + 1, transitions: [...operation.transitions, transition], ...(policyDecision === undefined ? {} : { policyDecision }) }; this.operations.set(operation.id, updated); return structuredClone(updated);
  }
  async recordAttempt(attempt: TransactionAttempt): Promise<TransactionAttempt> { const key = `${attempt.operationId}|${attempt.attemptKey}`; const existing = this.attempts.get(key); if (existing && JSON.stringify(existing) !== JSON.stringify(attempt)) throw new RegistryError("CONFLICT", "attempt key reused"); if (!existing) this.attempts.set(key, structuredClone(attempt)); return structuredClone(existing ?? attempt); }
  async listAttempts(id: CreateBridgeOperation["id"]): Promise<readonly TransactionAttempt[]> { return [...this.attempts.values()].filter((item) => item.operationId === id).map((item) => structuredClone(item)); }
}

const createdAt = "2026-08-08T00:00:00.000Z";
const input: CreateBridgeOperation = { id: "IW:BRIDGE:one", idempotencyKey: "request-1", assetId: "IW:ASSET:usd", sourceNetworkId: "IW:NETWORK:a", destinationNetworkId: "IW:NETWORK:b", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", amount: "10", expiresAt: "2026-08-09T00:00:00.000Z", createdAt, actor: "api" };
const allow = { outcome: "ALLOW" as const, reasonCodes: ["WITHIN_LIMIT"], policyId: "IW:POLICY:transfer" as const, policyVersion: "1.0.0", decidedAt: createdAt };

test("every legal state transition is persisted in sequence", async () => {
  const store = new TestTransactionStore(); const engine = new DurableTransactionEngine(store); let operation = await engine.create(input);
  const states = ["POLICY_CHECKED", "SOURCE_PREPARING", "SOURCE_SUBMITTED", "SOURCE_CONFIRMED", "SOURCE_FINALIZED", "ATTESTATION_PENDING", "ATTESTED", "DESTINATION_PREPARING", "DESTINATION_SUBMITTED", "DESTINATION_CONFIRMED", "DESTINATION_FINALIZED", "RECONCILIATION_PENDING", "RECONCILED", "COMPLETED"] as const;
  for (const state of states) operation = await engine.transition({ operationId: input.id, transitionKey: `to-${state}`, expectedVersion: operation.version, to: state, occurredAt: createdAt, reason: "verified step", actor: "coordinator", attempt: 1, ...(state === "POLICY_CHECKED" ? { policyDecision: allow } : {}) });
  assert.equal(operation.state, "COMPLETED"); assert.equal(operation.transitions.length, 15); assert.equal(operation.version, 14); assert.equal(operation.policyDecision?.policyVersion, "1.0.0");
});

test("transition keys are idempotent while stale competing writes fail", async () => {
  const store = new TestTransactionStore(); const engine = new DurableTransactionEngine(store); await engine.create(input);
  const command: TransitionCommand = { operationId: input.id, transitionKey: "policy-1", expectedVersion: 0, to: "POLICY_CHECKED", occurredAt: createdAt, reason: "allowed", actor: "coordinator", attempt: 1, policyDecision: allow };
  const first = await engine.transition(command); const replay = await engine.transition(command); assert.deepEqual(replay, first);
  await assert.rejects(() => engine.transition({ ...command, transitionKey: "competing", to: "POLICY_REJECTED", policyDecision: { ...allow, outcome: "DENY" } }), /illegal|stale/);
});

test("attempts persist retries without advancing workflow state", async () => {
  const store = new TestTransactionStore(); const engine = new DurableTransactionEngine(store); const operation = await engine.create(input);
  const failure: TransactionAttempt = { operationId: input.id, attemptKey: "submit-1", step: "SOURCE_SUBMIT", attempt: 1, status: "FAILED", errorCode: "RPC_TIMEOUT", occurredAt: createdAt };
  await engine.recordAttempt(failure); await engine.recordAttempt(failure);
  assert.equal((await store.listAttempts(input.id)).length, 1); assert.equal((await store.get(input.id))?.version, operation.version);
  await assert.rejects(() => engine.recordAttempt({ operationId: failure.operationId, attemptKey: "bad", step: failure.step, attempt: failure.attempt, status: "FAILED", occurredAt: failure.occurredAt }), /error code/);
});

test("terminal states cannot advance", () => { assert.equal(canTransition("COMPLETED", "MANUAL_REVIEW"), false); assert.equal(canTransition("SOURCE_SUBMITTED", "MANUAL_REVIEW"), true); });
