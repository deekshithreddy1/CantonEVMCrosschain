import type { AttestationId, IsoTimestamp, NetworkId, PolicyId, WorkflowId } from "./model.js";
import type { GenericClaimValue, GenericStateAttestation } from "./generic-attestation.js";
import type { SqlExecutor } from "./transaction-engine.js";
import { requestFingerprint } from "./idempotency.js";
import { RegistryError } from "./registry-errors.js";

export type PermissionedWorkflowActionType = "RECORD_CANTON_COLLATERAL" | "INITIATE_EVM_PAYMENT" | "RECORD_CANTON_ELIGIBILITY";
export interface WorkflowDefinition {
  id: WorkflowId; version: string; enabled: boolean; sourceNetworkId: NetworkId; predicateType: string;
  claimEquals: Readonly<Record<string, GenericClaimValue>>; policyId: PolicyId; policyVersion: string;
  actionType: PermissionedWorkflowActionType; actionConfiguration: Readonly<Record<string, GenericClaimValue>>; createdAt: IsoTimestamp;
}
export interface WorkflowRegistry { register(definition: WorkflowDefinition): Promise<WorkflowDefinition>; get(id: WorkflowId, version: string): Promise<WorkflowDefinition | undefined> }
export interface WorkflowPolicyAuthorizer { authorize(input: { workflow: WorkflowDefinition; attestation: GenericStateAttestation; evaluatedAt: IsoTimestamp }): Promise<{ outcome: "ALLOW" | "DENY" | "REQUIRES_APPROVAL"; policyId: PolicyId; policyVersion: string; reasons: readonly string[] }> }
export interface WorkflowAttestationVerifier { verify(attestation: GenericStateAttestation): Promise<boolean> }
export interface WorkflowActionEvidence { externalTransactionId: string; observedPosition: string; evidence: readonly string[]; finalizedAt: IsoTimestamp }
export type WorkflowActionResult = { outcome: "APPLIED" | "ALREADY_APPLIED"; evidence: WorkflowActionEvidence } | { outcome: "REJECTED"; reason: string; evidence: readonly string[] } | { outcome: "UNCERTAIN"; reason: string; evidence: readonly string[] };
export interface PermissionedWorkflowActionHandler { readonly actionType: PermissionedWorkflowActionType; execute(input: { executionId: string; workflow: WorkflowDefinition; attestation: GenericStateAttestation }): Promise<WorkflowActionResult> }
export type WorkflowExecutionStatus = "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "MANUAL_REVIEW";
export interface WorkflowExecutionRecord {
  id: string; idempotencyKey: string; workflowId: WorkflowId; workflowVersion: string; attestationId: AttestationId; requestHash: string;
  status: WorkflowExecutionStatus; policyEvidence?: readonly string[]; actionResult?: WorkflowActionResult; createdAt: IsoTimestamp; updatedAt: IsoTimestamp;
}
export type WorkflowExecutionClaim = { outcome: "CLAIMED" | "REPLAY" | "CONFLICT"; record: WorkflowExecutionRecord };
export interface WorkflowExecutionStore {
  claim(record: WorkflowExecutionRecord): Promise<WorkflowExecutionClaim>;
  finish(id: string, requestHash: string, status: Exclude<WorkflowExecutionStatus, "IN_PROGRESS">, changes: Pick<WorkflowExecutionRecord, "policyEvidence" | "actionResult" | "updatedAt">): Promise<WorkflowExecutionRecord>;
  get(id: string): Promise<WorkflowExecutionRecord | undefined>;
}
export interface ExecuteWorkflowRequest { id: string; idempotencyKey: string; workflowId: WorkflowId; workflowVersion: string; attestation: GenericStateAttestation; createdAt: IsoTimestamp }

export class WorkflowEngine {
  readonly #handlers: ReadonlyMap<PermissionedWorkflowActionType, PermissionedWorkflowActionHandler>;
  constructor(readonly registry: WorkflowRegistry, readonly verifier: WorkflowAttestationVerifier, readonly policy: WorkflowPolicyAuthorizer, handlers: readonly PermissionedWorkflowActionHandler[], readonly store: WorkflowExecutionStore, readonly now: () => Date = () => new Date()) {
    const configured = new Map<PermissionedWorkflowActionType, PermissionedWorkflowActionHandler>(); for (const handler of handlers) { if (configured.has(handler.actionType)) throw new RegistryError("CONFLICT", `duplicate workflow action handler: ${handler.actionType}`); configured.set(handler.actionType, handler); } this.#handlers = configured;
  }
  async execute(input: ExecuteWorkflowRequest): Promise<WorkflowExecutionRecord> {
    validateExecution(input); const workflow = await this.registry.get(input.workflowId, input.workflowVersion); if (!workflow) throw new RegistryError("NOT_FOUND", "workflow version not found");
    const hash = requestFingerprint({ id: input.id, idempotencyKey: input.idempotencyKey, workflowId: input.workflowId, workflowVersion: input.workflowVersion, attestationDigest: input.attestation.digest });
    const initial: WorkflowExecutionRecord = { id: input.id, idempotencyKey: input.idempotencyKey, workflowId: input.workflowId, workflowVersion: input.workflowVersion, attestationId: input.attestation.statement.id, requestHash: hash, status: "IN_PROGRESS", createdAt: input.createdAt, updatedAt: input.createdAt };
    const claim = await this.store.claim(initial); if (claim.outcome === "CONFLICT") throw new RegistryError("CONFLICT", `workflow execution ID was reused: ${input.id}`); if (claim.record.status !== "IN_PROGRESS") return structuredClone(claim.record);
    if (!workflow.enabled) return this.reject(initial, hash, ["WORKFLOW_DISABLED"]);
    if (!matches(workflow, input.attestation)) return this.reject(initial, hash, ["WORKFLOW_PREDICATE_MISMATCH"]);
    if (!await this.verifier.verify(input.attestation)) return this.reject(initial, hash, ["ATTESTATION_VERIFICATION_FAILED"]);
    const decision = await this.policy.authorize({ workflow: structuredClone(workflow), attestation: structuredClone(input.attestation), evaluatedAt: this.now().toISOString() });
    if (decision.policyId !== workflow.policyId || decision.policyVersion !== workflow.policyVersion) return this.reject(initial, hash, ["POLICY_VERSION_MISMATCH"]);
    if (decision.outcome !== "ALLOW") return this.reject(initial, hash, decision.reasons.length ? decision.reasons : [decision.outcome]);
    const handler = this.#handlers.get(workflow.actionType); if (!handler) return this.reject(initial, hash, ["ACTION_HANDLER_NOT_CONFIGURED"]);
    let result: WorkflowActionResult; try { result = await handler.execute({ executionId: input.id, workflow: structuredClone(workflow), attestation: structuredClone(input.attestation) }); } catch { result = { outcome: "UNCERTAIN", reason: "ACTION_HANDLER_ERROR", evidence: [] }; }
    validateActionResult(result); const status = result.outcome === "APPLIED" || result.outcome === "ALREADY_APPLIED" ? "COMPLETED" : result.outcome === "REJECTED" ? "REJECTED" : "MANUAL_REVIEW";
    return this.store.finish(input.id, hash, status, { policyEvidence: decision.reasons, actionResult: structuredClone(result), updatedAt: this.now().toISOString() });
  }
  reject(record: WorkflowExecutionRecord, hash: string, evidence: readonly string[]) { return this.store.finish(record.id, hash, "REJECTED", { policyEvidence: evidence, updatedAt: this.now().toISOString() }); }
}

function matches(workflow: WorkflowDefinition, attestation: GenericStateAttestation) { const statement = attestation.statement; if (statement.sourceNetworkId !== workflow.sourceNetworkId || statement.predicateType !== workflow.predicateType) return false; return Object.entries(workflow.claimEquals).every(([key, value]) => statement.claims[key] === value); }
function validateExecution(value: ExecuteWorkflowRequest) { if (!value.id.startsWith("IW:WORKFLOW_EXECUTION:") || !value.idempotencyKey.trim() || !value.workflowId.startsWith("IW:WORKFLOW:") || !value.workflowVersion.trim() || !Number.isFinite(Date.parse(value.createdAt))) throw new RegistryError("INVALID_ARGUMENT", "valid workflow execution identifiers and timestamp are required"); }
function validateDefinition(value: WorkflowDefinition) {
  if (!value.id.startsWith("IW:WORKFLOW:") || !/^[1-9][0-9]*(\.[0-9]+){0,2}$/.test(value.version) || !value.sourceNetworkId.startsWith("IW:NETWORK:") || !value.predicateType.trim() || !value.policyId.startsWith("IW:POLICY:") || !value.policyVersion.trim() || !Number.isFinite(Date.parse(value.createdAt))) throw new RegistryError("INVALID_ARGUMENT", "workflow definition is invalid");
  if (Object.keys(value.claimEquals).some((key) => !key.trim()) || Object.keys(value.actionConfiguration).some((key) => !key.trim())) throw new RegistryError("INVALID_ARGUMENT", "workflow claim and action configuration keys must be non-empty");
  if (!["RECORD_CANTON_COLLATERAL", "INITIATE_EVM_PAYMENT", "RECORD_CANTON_ELIGIBILITY"].includes(value.actionType)) throw new RegistryError("INVALID_ARGUMENT", "workflow action type is not permissioned");
  if ([...Object.values(value.claimEquals), ...Object.values(value.actionConfiguration)].some((item) => item !== null && !["string", "number", "boolean"].includes(typeof item))) throw new RegistryError("INVALID_ARGUMENT", "workflow definitions accept scalar data only");
}
function validateActionResult(value: WorkflowActionResult) { if (value.outcome === "APPLIED" || value.outcome === "ALREADY_APPLIED") { if (!value.evidence.externalTransactionId.trim() || !value.evidence.observedPosition.trim() || value.evidence.evidence.length === 0 || !Number.isFinite(Date.parse(value.evidence.finalizedAt))) throw new RegistryError("INVALID_ARGUMENT", "applied workflow action requires finality evidence"); } else if ((value.outcome === "REJECTED" || value.outcome === "UNCERTAIN") && !value.reason.trim()) throw new RegistryError("INVALID_ARGUMENT", "non-applied workflow action requires a reason"); }

export class InMemoryWorkflowRegistry implements WorkflowRegistry { readonly definitions = new Map<string, WorkflowDefinition>(); async register(value: WorkflowDefinition) { validateDefinition(value); const key = `${value.id}@${value.version}`; if (this.definitions.has(key)) throw new RegistryError("ALREADY_EXISTS", "workflow version is immutable"); this.definitions.set(key, structuredClone(value)); return structuredClone(value); } async get(id: WorkflowId, version: string) { const value = this.definitions.get(`${id}@${version}`); return value ? structuredClone(value) : undefined; } }
export class InMemoryWorkflowExecutionStore implements WorkflowExecutionStore {
  readonly records = new Map<string, WorkflowExecutionRecord>(); async claim(record: WorkflowExecutionRecord): Promise<WorkflowExecutionClaim> { const found = this.records.get(record.id); if (found) return { outcome: found.requestHash === record.requestHash ? "REPLAY" : "CONFLICT", record: structuredClone(found) }; this.records.set(record.id, structuredClone(record)); return { outcome: "CLAIMED", record: structuredClone(record) }; }
  async finish(id: string, hash: string, status: Exclude<WorkflowExecutionStatus, "IN_PROGRESS">, changes: Pick<WorkflowExecutionRecord, "policyEvidence" | "actionResult" | "updatedAt">) { const value = this.records.get(id); if (!value || value.requestHash !== hash) throw new RegistryError("CONFLICT", "workflow claim mismatch"); if (value.status !== "IN_PROGRESS") return structuredClone(value); const next = { ...value, ...changes, status }; this.records.set(id, next); return structuredClone(next); }
  async get(id: string) { const value = this.records.get(id); return value ? structuredClone(value) : undefined; }
}
type WorkflowRow<T> = { record: T };
export class PostgresWorkflowRegistry implements WorkflowRegistry { constructor(readonly db: SqlExecutor) {} async register(value: WorkflowDefinition) { validateDefinition(value); const result = await this.db.query("INSERT INTO workflow_definitions (id,version,enabled,record) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id,version) DO NOTHING", [value.id,value.version,value.enabled,JSON.stringify(value)]); if (result.rowCount !== 1) throw new RegistryError("ALREADY_EXISTS", "workflow version is immutable"); return structuredClone(value); } async get(id: WorkflowId, version: string) { const result = await this.db.query<WorkflowRow<WorkflowDefinition>>("SELECT record FROM workflow_definitions WHERE id=$1 AND version=$2", [id,version]); const value = result.rows[0]?.record; return value ? structuredClone(value) : undefined; } }
export class PostgresWorkflowExecutionStore implements WorkflowExecutionStore {
  constructor(readonly db: SqlExecutor) {} async claim(record: WorkflowExecutionRecord): Promise<WorkflowExecutionClaim> { return this.db.transaction(async (client) => { const inserted = await client.query("INSERT INTO workflow_executions (id,status,request_hash,record) VALUES ($1,'IN_PROGRESS',$2,$3::jsonb) ON CONFLICT (id) DO NOTHING", [record.id,record.requestHash,JSON.stringify(record)]); if (inserted.rowCount === 1) return { outcome: "CLAIMED", record }; const result = await client.query<WorkflowRow<WorkflowExecutionRecord>>("SELECT record FROM workflow_executions WHERE id=$1 FOR UPDATE", [record.id]); const found = result.rows[0]?.record; if (!found) throw new RegistryError("CONFLICT", "workflow claim disappeared"); return { outcome: found.requestHash === record.requestHash ? "REPLAY" : "CONFLICT", record: structuredClone(found) }; }); }
  async finish(id: string, hash: string, status: Exclude<WorkflowExecutionStatus, "IN_PROGRESS">, changes: Pick<WorkflowExecutionRecord, "policyEvidence" | "actionResult" | "updatedAt">) { return this.db.transaction(async (client) => { const result = await client.query<WorkflowRow<WorkflowExecutionRecord>>("SELECT record FROM workflow_executions WHERE id=$1 FOR UPDATE", [id]); const found = result.rows[0]?.record; if (!found || found.requestHash !== hash) throw new RegistryError("CONFLICT", "workflow claim mismatch"); if (found.status !== "IN_PROGRESS") return structuredClone(found); const next = { ...found, ...changes, status }; await client.query("UPDATE workflow_executions SET status=$2,record=$3::jsonb,updated_at=$4 WHERE id=$1", [id,status,JSON.stringify(next),changes.updatedAt]); return structuredClone(next); }); }
  async get(id: string) { const result = await this.db.query<WorkflowRow<WorkflowExecutionRecord>>("SELECT record FROM workflow_executions WHERE id=$1", [id]); const value = result.rows[0]?.record; return value ? structuredClone(value) : undefined; }
}
