import assert from "node:assert/strict";
import test from "node:test";
import { status, type ServiceError } from "@grpc/grpc-js";
import { CantonGrpcTransport, type CantonLedgerApiClients, type LedgerApiClient } from "./canton-grpc-transport.js";
import type { PreparedCantonTransfer } from "./canton-adapter.js";

type Callback = (error: ServiceError | null, response?: Record<string, unknown>) => void;
const alice = "Alice::participant";

function unary(response: Record<string, unknown>): (...args: unknown[]) => void {
  return (...args) => (args.at(-1) as Callback)(null, response);
}
function clients(overrides: Partial<CantonLedgerApiClients> = {}): CantonLedgerApiClients {
  return {
    version: { getLedgerApiVersion: unary({ version: "3.4.0" }) },
    state: { getLedgerEnd: unary({ offset: "42" }), getActiveContracts: () => stream([]) },
    partyManagement: { listKnownParties: unary({ partyDetails: [{ party: alice }] }) },
    commandSubmission: { submit: unary({}) },
    update: { getTransactionById: unary({ transaction: { offset: "43", synchronizerId: "sync" } }), getUpdates: () => stream([]) },
    ...overrides
  };
}
function stream(values: readonly Record<string, unknown>[]): AsyncIterable<Record<string, unknown>> {
  return (async function* () { for (const value of values) yield value; })();
}
function transport(api = clients()): CantonGrpcTransport {
  return new CantonGrpcTransport({ endpoint: "localhost:3901", networkId: "IW:NETWORK:canton-local",
    participantId: "participant", authorizedParties: [alice], userId: "interweave", clients: api,
    now: () => new Date("2026-08-13T12:00:00.000Z") });
}

test("gRPC transport probes version and ledger end and resolves a party hint", async () => {
  const value = transport();
  assert.deepEqual(await value.connect(), {
    networkId: "IW:NETWORK:canton-local", participantId: "participant", authorizedParties: [alice],
    connectedAt: "2026-08-13T12:00:00.000Z"
  });
  assert.equal((await value.health()).ledgerEnd, "42");
  assert.equal(await value.resolveParty("Alice"), alice);
});

test("gRPC submission supplies command identity and authorization scope", async () => {
  let request: Record<string, unknown> | undefined;
  const api = clients({ commandSubmission: { submit: (...args: unknown[]) => {
    request = args[0] as Record<string, unknown>; (args.at(-1) as Callback)(null, {});
  } } });
  const prepared: PreparedCantonTransfer = {
    request: { representationId: "IW:REPRESENTATION:coin", sender: alice, receiver: "Bob::participant",
      amount: "1", idempotencyKey: "key", metadata: {} }, commandId: "command-1", requiredActAs: [alice],
    expiresAt: "2026-08-13T13:00:00.000Z", opaqueCommand: { workflowId: "bridge", commands: [{ create: {} }] }
  };
  assert.equal((await transport(api).submit(prepared)).status, "SUBMITTED");
  assert.deepEqual(request?.commands, { workflowId: "bridge", commands: [{ create: {} }],
    commandId: "command-1", userId: "interweave", actAs: [alice] });
});

test("gRPC NOT_FOUND is an unknown observation and invalid commands are rejected", async () => {
  const grpcError = Object.assign(new Error("not found"), { code: status.NOT_FOUND }) as ServiceError;
  const invalid = Object.assign(new Error("invalid command"), { code: status.INVALID_ARGUMENT }) as ServiceError;
  const api = clients({
    update: { getTransactionById: (...args: unknown[]) => (args.at(-1) as Callback)(grpcError), getUpdates: () => stream([]) },
    commandSubmission: { submit: (...args: unknown[]) => (args.at(-1) as Callback)(invalid) }
  });
  assert.equal((await transport(api).observeTransaction("missing", { parties: [alice] })).status, "UNKNOWN");
  const prepared = { commandId: "bad", requiredActAs: [alice], opaqueCommand: {}, expiresAt: "2026-08-13T13:00:00.000Z",
    request: { representationId: "IW:REPRESENTATION:rep", sender: alice, receiver: "bob", amount: "1", idempotencyKey: "key", metadata: {} } } as PreparedCantonTransfer;
  assert.equal((await transport(api).submit(prepared)).status, "REJECTED");
});

test("gRPC update and ACS streams normalize Ledger API events", async () => {
  const created = { templateId: { packageId: "pkg", moduleName: "Token", entityName: "Holding" },
    createArguments: { owner: alice }, witnessParties: [alice], offset: "44" };
  const api = clients({
    update: { getTransactionById: unary({}), getUpdates: () => stream([{ update: { transaction: { updateId: "tx-1", events: [{ created }] } } }]) },
    state: { getLedgerEnd: unary({ offset: "44" }), getActiveContracts: () => stream([{ activeContract: { createdEvent: created } }]) }
  });
  const value = transport(api);
  const updates = [];
  for await (const event of value.subscribeEvents({ parties: [alice] })) updates.push(event);
  assert.equal(updates[0]?.templateOrInterfaceId, "pkg:Token:Holding");
  assert.equal((await value.queryState({ parties: [alice], interfaceId: "pkg:Token:Holding", predicate: { owner: alice } })).length, 1);
});
