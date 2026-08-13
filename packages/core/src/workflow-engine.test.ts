import assert from "node:assert/strict";
import test from "node:test";
import type { GenericStateAttestation } from "./generic-attestation.js";
import type { PermissionedWorkflowActionHandler, WorkflowDefinition } from "./workflow-engine.js";
import { InMemoryWorkflowExecutionStore, InMemoryWorkflowRegistry, WorkflowEngine } from "./workflow-engine.js";

const workflow: WorkflowDefinition = { id: "IW:WORKFLOW:collateral", version: "1.0.0", enabled: true, sourceNetworkId: "IW:NETWORK:ethereum", predicateType: "CollateralDeposited", claimEquals: { asset: "USDC" }, policyId: "IW:POLICY:credit", policyVersion: "3", actionType: "RECORD_CANTON_COLLATERAL", actionConfiguration: { cantonTemplate: "CollateralEvidence" }, createdAt: "2026-08-12T12:00:00.000Z" };
const attestation: GenericStateAttestation = { statement: { version: "1", id: "IW:ATTESTATION:deposit", idempotencyKey: "deposit", sourceNetworkId: workflow.sourceNetworkId, sourceNetworkType: "EVM", sourceTransactionId: "0xtx", sourceEventPosition: "100:2", predicateType: workflow.predicateType, claims: { asset: "USDC", amount: "1000", creditLineId: "credit-7" }, nonce: "workflow_nonce_0001", policyVersion: "attestation-policy", validatorSetId: "set-1", threshold: 2, validFrom: "2026-08-12T12:01:00.000Z", expiresAt: "2026-08-12T13:00:00.000Z", createdAt: "2026-08-12T12:00:00.000Z", observedStatePosition: "finalized:100", observedAt: "2026-08-12T12:02:00.000Z" }, signatures: [], validatorEvidence: {}, digest: "sha256:digest", status: "VERIFIED_EVIDENCE_ONLY", destinationMutationAuthorized: false, recordedAt: "2026-08-12T12:03:00.000Z" };
const input = { id: "IW:WORKFLOW_EXECUTION:one", idempotencyKey: "one", workflowId: workflow.id, workflowVersion: workflow.version, attestation, createdAt: "2026-08-12T12:04:00.000Z" };
async function fixture(options: { verified?: boolean; policy?: "ALLOW" | "DENY"; result?: "APPLIED" | "ALREADY_APPLIED" | "UNCERTAIN" } = {}) {
  const registry = new InMemoryWorkflowRegistry(); await registry.register(workflow); const calls: string[] = [];
  const handler: PermissionedWorkflowActionHandler = {
    actionType: "RECORD_CANTON_COLLATERAL",
    execute: async ({ executionId }) => {
      calls.push(executionId);
      if (options.result === "UNCERTAIN") return { outcome: "UNCERTAIN", reason: "CANTON_FINALITY_UNKNOWN", evidence: ["submission"] };
      return { outcome: options.result ?? "APPLIED", evidence: { externalTransactionId: "canton-tx", observedPosition: "offset-10", evidence: ["completion"], finalizedAt: "2026-08-12T12:05:00.000Z" } };
    }
  };
  const store = new InMemoryWorkflowExecutionStore(); const engine = new WorkflowEngine(registry, { verify: async () => options.verified ?? true }, { authorize: async () => ({ outcome: options.policy ?? "ALLOW", policyId: workflow.policyId, policyVersion: workflow.policyVersion, reasons: options.policy === "DENY" ? ["CREDIT_POLICY_DENIED"] : ["CREDIT_POLICY_ALLOWED"] }) }, [handler], store, () => new Date("2026-08-12T12:05:00.000Z"));
  return { registry, store, engine, calls };
}

test("verified Ethereum deposit triggers the predefined Canton collateral action", async () => { const value = await fixture(); const result = await value.engine.execute(input); assert.equal(result.status, "COMPLETED"); assert.equal(result.actionResult?.outcome, "APPLIED"); assert.deepEqual(value.calls, [input.id]); });
test("invalid evidence, predicate mismatch, and policy denial cannot dispatch an action", async () => {
  const invalid = await fixture({ verified: false }); assert.equal((await invalid.engine.execute(input)).status, "REJECTED"); assert.deepEqual(invalid.calls, []);
  const mismatch = await fixture(); assert.equal((await mismatch.engine.execute({ ...input, id: "IW:WORKFLOW_EXECUTION:mismatch", attestation: { ...attestation, statement: { ...attestation.statement, predicateType: "OtherEvent" } } })).status, "REJECTED"); assert.deepEqual(mismatch.calls, []);
  const denied = await fixture({ policy: "DENY" }); assert.equal((await denied.engine.execute({ ...input, id: "IW:WORKFLOW_EXECUTION:denied" })).status, "REJECTED"); assert.deepEqual(denied.calls, []);
});
test("completed execution replay never invokes the action twice", async () => { const value = await fixture(); await value.engine.execute(input); await value.engine.execute(input); assert.equal(value.calls.length, 1); });
test("restart-safe handler recovery accepts an already-applied action", async () => { const value = await fixture({ result: "ALREADY_APPLIED" }); await value.store.claim({ id: input.id, idempotencyKey: input.idempotencyKey, workflowId: input.workflowId, workflowVersion: input.workflowVersion, attestationId: attestation.statement.id, requestHash: (await import("./idempotency.js")).requestFingerprint({ id: input.id, idempotencyKey: input.idempotencyKey, workflowId: input.workflowId, workflowVersion: input.workflowVersion, attestationDigest: attestation.digest }), status: "IN_PROGRESS", createdAt: input.createdAt, updatedAt: input.createdAt }); const result = await value.engine.execute(input); assert.equal(result.status, "COMPLETED"); assert.equal(result.actionResult?.outcome, "ALREADY_APPLIED"); });
test("uncertain destination action enters manual review", async () => { const value = await fixture({ result: "UNCERTAIN" }); assert.equal((await value.engine.execute(input)).status, "MANUAL_REVIEW"); });
test("workflow versions are immutable and arbitrary action/code definitions are rejected", async () => { const registry = new InMemoryWorkflowRegistry(); await registry.register(workflow); await assert.rejects(registry.register(workflow), /immutable/); await assert.rejects(registry.register({ ...workflow, id: "IW:WORKFLOW:unsafe", actionType: "RUN_JAVASCRIPT" as WorkflowDefinition["actionType"], actionConfiguration: { script: "process.exit()" } }), /not permissioned/); await assert.rejects(registry.register({ ...workflow, id: "IW:WORKFLOW:nested", actionConfiguration: { payload: { arbitrary: true } as never } }), /scalar data only/); });
