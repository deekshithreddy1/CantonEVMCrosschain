import type { AssetId, AtomicAmount, BridgeOperation, BridgeOperationId, BridgeState, IdentityId, IsoTimestamp, NetworkId, PolicyDecision, StateTransition } from "./model.js";
import { assertPositiveAmount } from "./invariants.js";
import { RegistryError } from "./registry-errors.js";

export interface PersistedTransition extends StateTransition { transitionKey: string; sequence: number; attempt: number }
export interface DurableBridgeOperation extends Omit<BridgeOperation, "transitions"> { version: number; transitions: readonly PersistedTransition[] }
export interface TransactionAttempt { operationId: BridgeOperationId; attemptKey: string; step: string; attempt: number; status: "STARTED" | "SUCCEEDED" | "FAILED"; errorCode?: string; occurredAt: IsoTimestamp }
export interface CreateBridgeOperation { id: BridgeOperationId; idempotencyKey: string; assetId: AssetId; sourceNetworkId: NetworkId; destinationNetworkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; expiresAt: IsoTimestamp; createdAt: IsoTimestamp; actor: string }
export interface TransitionCommand { operationId: BridgeOperationId; transitionKey: string; expectedVersion: number; to: BridgeState; occurredAt: IsoTimestamp; reason: string; actor: string; attempt: number; policyDecision?: PolicyDecision }

export interface TransactionStore {
  create(input: CreateBridgeOperation, initial: PersistedTransition): Promise<DurableBridgeOperation>;
  get(id: BridgeOperationId): Promise<DurableBridgeOperation | undefined>;
  findTransition(operationId: BridgeOperationId, transitionKey: string): Promise<PersistedTransition | undefined>;
  append(command: TransitionCommand): Promise<DurableBridgeOperation>;
  recordAttempt(attempt: TransactionAttempt): Promise<TransactionAttempt>;
  listAttempts(operationId: BridgeOperationId): Promise<readonly TransactionAttempt[]>;
}

const forward: Readonly<Partial<Record<BridgeState, readonly BridgeState[]>>> = {
  CREATED: ["POLICY_CHECKED", "POLICY_REJECTED"], POLICY_CHECKED: ["SOURCE_PREPARING"], SOURCE_PREPARING: ["SOURCE_SUBMITTED", "SOURCE_FAILED"],
  SOURCE_SUBMITTED: ["SOURCE_CONFIRMED", "SOURCE_FAILED"], SOURCE_CONFIRMED: ["SOURCE_FINALIZED", "SOURCE_FAILED"], SOURCE_FINALIZED: ["ATTESTATION_PENDING"],
  ATTESTATION_PENDING: ["ATTESTED", "ATTESTATION_FAILED"], ATTESTED: ["DESTINATION_PREPARING"], DESTINATION_PREPARING: ["DESTINATION_SUBMITTED", "DESTINATION_FAILED"],
  DESTINATION_SUBMITTED: ["DESTINATION_CONFIRMED", "DESTINATION_FAILED"], DESTINATION_CONFIRMED: ["DESTINATION_FINALIZED", "DESTINATION_FAILED"], DESTINATION_FINALIZED: ["RECONCILIATION_PENDING"],
  RECONCILIATION_PENDING: ["RECONCILED", "RECONCILIATION_FAILED"], RECONCILED: ["COMPLETED"]
};
const terminal = new Set<BridgeState>(["COMPLETED", "POLICY_REJECTED", "SOURCE_FAILED", "ATTESTATION_FAILED", "DESTINATION_FAILED", "EXPIRED", "RECONCILIATION_FAILED", "MANUAL_REVIEW"]);

export function canTransition(from: BridgeState, to: BridgeState): boolean {
  if (terminal.has(from)) return false;
  if (to === "MANUAL_REVIEW" || to === "EXPIRED") return true;
  return forward[from]?.includes(to) ?? false;
}

export class DurableTransactionEngine {
  constructor(readonly store: TransactionStore) {}
  async create(input: CreateBridgeOperation): Promise<DurableBridgeOperation> {
    assertPositiveAmount(input.amount);
    if (input.sourceNetworkId === input.destinationNetworkId) throw new RegistryError("INVALID_ARGUMENT", "bridge networks must differ");
    if (!input.idempotencyKey.trim() || !input.actor.trim()) throw new RegistryError("INVALID_ARGUMENT", "idempotency key and actor are required");
    if (!Number.isFinite(Date.parse(input.createdAt)) || Date.parse(input.expiresAt) <= Date.parse(input.createdAt)) throw new RegistryError("INVALID_ARGUMENT", "operation expiry must be after creation");
    return this.store.create(input, { transitionKey: `${input.id}:created`, sequence: 0, attempt: 1, from: null, to: "CREATED", occurredAt: input.createdAt, reason: "operation created", actor: input.actor });
  }
  async transition(command: TransitionCommand): Promise<DurableBridgeOperation> {
    if (!command.transitionKey.trim() || !command.actor.trim() || !command.reason.trim()) throw new RegistryError("INVALID_ARGUMENT", "transition key, actor, and reason are required");
    if (!Number.isSafeInteger(command.attempt) || command.attempt < 1) throw new RegistryError("INVALID_ARGUMENT", "transition attempt must be positive");
    const operation = await this.store.get(command.operationId); if (!operation) throw new RegistryError("NOT_FOUND", `operation not found: ${command.operationId}`);
    if (!canTransition(operation.state, command.to)) {
      const existing = await this.store.findTransition(command.operationId, command.transitionKey);
      if (existing?.to === command.to) return operation;
      throw new RegistryError("CONFLICT", `illegal bridge transition: ${operation.state} -> ${command.to}`);
    }
    if (command.to === "POLICY_CHECKED" && (!command.policyDecision || command.policyDecision.outcome !== "ALLOW")) throw new RegistryError("INVALID_ARGUMENT", "POLICY_CHECKED requires an ALLOW decision");
    if (command.to === "POLICY_REJECTED" && (!command.policyDecision || command.policyDecision.outcome === "ALLOW")) throw new RegistryError("INVALID_ARGUMENT", "POLICY_REJECTED requires a non-ALLOW decision");
    return this.store.append(command);
  }
  async recordAttempt(attempt: TransactionAttempt): Promise<TransactionAttempt> {
    if (!attempt.attemptKey.trim() || !attempt.step.trim() || !Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1) throw new RegistryError("INVALID_ARGUMENT", "valid attempt key, step, and number are required");
    if (attempt.status === "FAILED" && !attempt.errorCode) throw new RegistryError("INVALID_ARGUMENT", "failed attempts require an error code");
    return this.store.recordAttempt(attempt);
  }
}

export interface SqlResult<Row> { rows: readonly Row[]; rowCount: number }
export interface SqlClient { query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>> }
export interface SqlExecutor extends SqlClient { transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> }
type OperationRow = { operation: DurableBridgeOperation };
type TransitionRow = { transition_key: string; sequence: number; attempt: number; from_state: BridgeState | null; to_state: BridgeState; occurred_at: string; reason: string; actor: string };

/** PostgreSQL implementation; callers supply a pool wrapper with real transaction semantics. */
export class PostgresTransactionStore implements TransactionStore {
  constructor(readonly db: SqlExecutor) {}
  async create(input: CreateBridgeOperation, initial: PersistedTransition): Promise<DurableBridgeOperation> {
    return this.db.transaction(async (client) => {
      const operation: DurableBridgeOperation = { id: input.id, idempotencyKey: input.idempotencyKey, assetId: input.assetId, sourceNetworkId: input.sourceNetworkId, destinationNetworkId: input.destinationNetworkId, sender: input.sender, receiver: input.receiver, amount: input.amount, state: "CREATED", transitions: [], expiresAt: input.expiresAt, createdAt: input.createdAt, version: 0 };
      const inserted = await client.query("INSERT INTO bridge_operations (id, idempotency_key, state, version, operation) VALUES ($1,$2,$3,0,$4::jsonb) ON CONFLICT (id) DO NOTHING", [input.id, input.idempotencyKey, "CREATED", JSON.stringify(operation)]);
      if (inserted.rowCount === 0) throw new RegistryError("ALREADY_EXISTS", `operation already exists: ${input.id}`);
      await client.query("INSERT INTO bridge_transitions (operation_id, transition_key, sequence, attempt, from_state, to_state, occurred_at, reason, actor) VALUES ($1,$2,0,$3,NULL,$4,$5,$6,$7)", [input.id, initial.transitionKey, initial.attempt, initial.to, initial.occurredAt, initial.reason, initial.actor]);
      return { ...operation, transitions: [initial] };
    });
  }
  get(id: BridgeOperationId): Promise<DurableBridgeOperation | undefined> { return this.db.transaction((client) => this.#load(client, id, false)); }
  async findTransition(operationId: BridgeOperationId, transitionKey: string): Promise<PersistedTransition | undefined> {
    const result = await this.db.query<TransitionRow>("SELECT * FROM bridge_transitions WHERE operation_id=$1 AND transition_key=$2", [operationId, transitionKey]); const row = result.rows[0];
    return row ? { transitionKey: row.transition_key, sequence: row.sequence, attempt: row.attempt, from: row.from_state, to: row.to_state, occurredAt: row.occurred_at, reason: row.reason, actor: row.actor } : undefined;
  }
  async append(command: TransitionCommand): Promise<DurableBridgeOperation> {
    return this.db.transaction(async (client) => {
      const duplicate = await client.query<TransitionRow>("SELECT * FROM bridge_transitions WHERE operation_id=$1 AND transition_key=$2", [command.operationId, command.transitionKey]);
      if (duplicate.rowCount > 0) {
        const row = duplicate.rows[0];
        if (!row || row.to_state !== command.to) throw new RegistryError("CONFLICT", "transition key was reused with different content");
        const existing = await this.#load(client, command.operationId, false); if (!existing) throw new RegistryError("NOT_FOUND", "operation disappeared"); return existing;
      }
      const operation = await this.#load(client, command.operationId, true); if (!operation) throw new RegistryError("NOT_FOUND", `operation not found: ${command.operationId}`);
      if (operation.version !== command.expectedVersion) throw new RegistryError("CONFLICT", `stale operation version: expected ${command.expectedVersion}, found ${operation.version}`);
      if (!canTransition(operation.state, command.to)) throw new RegistryError("CONFLICT", `illegal bridge transition: ${operation.state} -> ${command.to}`);
      const sequence = operation.version + 1;
      await client.query("INSERT INTO bridge_transitions (operation_id, transition_key, sequence, attempt, from_state, to_state, occurred_at, reason, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [command.operationId, command.transitionKey, sequence, command.attempt, operation.state, command.to, command.occurredAt, command.reason, command.actor]);
      const policyDecision = command.policyDecision ?? operation.policyDecision;
      const updated: DurableBridgeOperation = { ...operation, state: command.to, version: sequence, transitions: [], ...(policyDecision === undefined ? {} : { policyDecision }) };
      await client.query("UPDATE bridge_operations SET state=$2, version=$3, operation=$4::jsonb, updated_at=$5 WHERE id=$1", [command.operationId, command.to, sequence, JSON.stringify(updated), command.occurredAt]);
      const transition: PersistedTransition = { transitionKey: command.transitionKey, sequence, attempt: command.attempt, from: operation.state, to: command.to, occurredAt: command.occurredAt, reason: command.reason, actor: command.actor };
      return { ...updated, transitions: [...operation.transitions, transition] };
    });
  }
  async recordAttempt(attempt: TransactionAttempt): Promise<TransactionAttempt> {
    const result = await this.db.query<{ attempt: TransactionAttempt }>("INSERT INTO transaction_attempts (operation_id, attempt_key, step, attempt, status, error_code, occurred_at, record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (operation_id, attempt_key) DO UPDATE SET attempt_key=EXCLUDED.attempt_key WHERE transaction_attempts.record=EXCLUDED.record RETURNING record AS attempt", [attempt.operationId, attempt.attemptKey, attempt.step, attempt.attempt, attempt.status, attempt.errorCode ?? null, attempt.occurredAt, JSON.stringify(attempt)]);
    const stored = result.rows[0]?.attempt; if (!stored) throw new RegistryError("CONFLICT", "attempt key was reused with different content"); return structuredClone(stored);
  }
  async listAttempts(operationId: BridgeOperationId): Promise<readonly TransactionAttempt[]> { const result = await this.db.query<{ attempt: TransactionAttempt }>("SELECT record AS attempt FROM transaction_attempts WHERE operation_id=$1 ORDER BY attempt, occurred_at", [operationId]); return result.rows.map((row) => structuredClone(row.attempt)); }
  async #load(client: SqlClient, id: BridgeOperationId, lock: boolean): Promise<DurableBridgeOperation | undefined> {
    const result = await client.query<OperationRow>(`SELECT operation FROM bridge_operations WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]); const operation = result.rows[0]?.operation; if (!operation) return undefined;
    const transitions = await client.query<TransitionRow>("SELECT * FROM bridge_transitions WHERE operation_id=$1 ORDER BY sequence", [id]);
    return { ...structuredClone(operation), transitions: transitions.rows.map((row) => ({ transitionKey: row.transition_key, sequence: row.sequence, attempt: row.attempt, from: row.from_state, to: row.to_state, occurredAt: row.occurred_at, reason: row.reason, actor: row.actor })) };
  }
}
