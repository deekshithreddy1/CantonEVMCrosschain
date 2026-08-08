import assert from "node:assert/strict";
import test from "node:test";
import { CantonAdapterClient, Cip56Adapter } from "./canton-adapter.js";
import type { CantonConnection, CantonEvent, CantonTransport, PreparedCantonTransfer } from "./canton-adapter.js";

const alice = "Alice::participant";
const connection: CantonConnection = { networkId: "IW:NETWORK:canton-local", participantId: "participant-1", authorizedParties: [alice], connectedAt: "2026-08-08T00:00:00.000Z" };
const prepared: PreparedCantonTransfer = { request: { representationId: "IW:REPRESENTATION:coin", sender: alice, receiver: "Bob::participant", amount: "4", idempotencyKey: "op-1", metadata: {} }, commandId: "op-1", requiredActAs: [alice], expiresAt: "2026-08-08T01:00:00.000Z", opaqueCommand: {} };

function transport(): CantonTransport {
  return {
    connect: async () => connection,
    health: async () => ({ status: "HEALTHY", participantId: "participant-1", ledgerEnd: "42", checkedAt: "2026-08-08T00:00:00.000Z", details: {} }),
    resolveParty: async (hint) => hint === "Alice" ? alice : undefined,
    submit: async (value) => ({ commandId: value.commandId, externalTransactionId: "tx-1", status: "SUBMITTED" }),
    observeTransaction: async (id) => ({ externalTransactionId: id, status: "COMMITTED", completionOffset: "43", observedByParticipant: "participant-1", observedAt: "2026-08-08T00:00:01.000Z" }),
    subscribeEvents: () => (async function* (): AsyncIterable<CantonEvent> {})(),
    queryState: async () => []
  };
}

test("Canton reads require an explicitly authorized party scope", async () => {
  const token = new Cip56Adapter({ metadata: async () => { throw new Error("unused"); }, holdings: async () => [], transfer: async () => prepared });
  const adapter = new CantonAdapterClient(transport(), [token]);
  await assert.rejects(() => adapter.getHoldings("CIP0056", "IW:REPRESENTATION:coin", { parties: [alice] }), /not connected/);
  await adapter.connect();
  await assert.rejects(() => adapter.getHoldings("CIP0056", "IW:REPRESENTATION:coin", { parties: [] }), /explicit party scope/);
  await assert.rejects(() => adapter.getHoldings("CIP0056", "IW:REPRESENTATION:coin", { parties: ["Mallory::participant"] }), /not authorized/);
});

test("balance includes only unlocked holdings visible to the owner", async () => {
  const token = new Cip56Adapter({
    metadata: async () => { throw new Error("unused"); },
    holdings: async () => [
      { holdingId: "h1", representationId: "IW:REPRESENTATION:coin", owner: alice, amount: "7", locked: false, visibleAt: "42" },
      { holdingId: "h2", representationId: "IW:REPRESENTATION:coin", owner: alice, amount: "3", locked: true, visibleAt: "42" }
    ], transfer: async () => prepared
  });
  const adapter = new CantonAdapterClient(transport(), [token]); await adapter.connect();
  assert.equal(await adapter.getBalance("CIP0056", "IW:REPRESENTATION:coin", alice), "7");
});

test("submission is not represented as finality", async () => {
  const token = new Cip56Adapter({ metadata: async () => { throw new Error("unused"); }, holdings: async () => [], transfer: async () => prepared });
  const adapter = new CantonAdapterClient(transport(), [token]); await adapter.connect();
  const transfer = await adapter.prepareTransfer("CIP0056", prepared.request);
  assert.equal((await adapter.executeTransfer(transfer)).status, "SUBMITTED");
  assert.equal((await adapter.observeTransaction("tx-1", { parties: [alice] })).status, "COMMITTED");
});
