import assert from "node:assert/strict";
import test from "node:test";
import type { RestApiCommand } from "./rest-api.js";
import { InterWeaveRestApi } from "./rest-api.js";
import { RegistryError } from "./registry-errors.js";

function fixture(error?: Error) { const commands: RestApiCommand[] = []; const api = new InterWeaveRestApi({ execute: async (command) => { commands.push(structuredClone(command)); if (error) throw error; return { operation: command.operation, id: command.path.id ?? null }; } }, () => "req_test"); return { api, commands }; }
async function body(response: Response) { return response.json() as Promise<Record<string, unknown>>; }

test("all documented GET endpoints map to the network-neutral backend", async () => {
  const value = fixture(); const paths = [
    ["/v1/networks", "networks.list"], ["/v1/assets/IW%3AASSET%3Abond", "assets.get"], ["/v1/assets/IW%3AASSET%3Abond/balances?identityId=alice", "assets.balance"],
    ["/v1/transfers/t1", "transfers.get"], ["/v1/bridge/transfers/b1", "bridge.get"], ["/v1/settlements/s1", "settlements.get"], ["/v1/attestations/a1", "attestations.get"], ["/v1/transactions/x1", "transactions.get"]
  ] as const;
  for (const [path, operation] of paths) { const response = await value.api.handle(new Request(`http://localhost${path}`)); assert.equal(response.status, 200); assert.equal(value.commands.at(-1)?.operation, operation); }
  assert.equal(value.commands[1]?.path.id, "IW:ASSET:bond"); assert.equal(value.commands[2]?.query.identityId, "alice");
});

test("all write endpoints require and forward idempotency keys", async () => {
  const value = fixture(); const paths = [
    ["/v1/assets", "assets.create"], ["/v1/identities", "identities.create"], ["/v1/identities/alice/bindings", "identities.bind"], ["/v1/transfers", "transfers.create"],
    ["/v1/bridge/transfers", "bridge.create"], ["/v1/settlements", "settlements.create"], ["/v1/attestations", "attestations.create"], ["/v1/webhooks", "webhooks.create"]
  ] as const;
  for (const [path, operation] of paths) { const response = await value.api.handle(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `key-${operation}` }, body: JSON.stringify({ example: true }) })); assert.equal(response.status, 201); assert.equal(value.commands.at(-1)?.operation, operation); assert.equal(value.commands.at(-1)?.idempotencyKey, `key-${operation}`); }
  const missing = await value.api.handle(new Request("http://localhost/v1/assets", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })); assert.equal(missing.status, 400); assert.equal(((await body(missing)).error as Record<string, unknown>).code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("malformed JSON, media type, method, and route failures have one error shape", async () => {
  const value = fixture(); const cases = [
    new Request("http://localhost/v1/assets", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "x" }, body: "{" }),
    new Request("http://localhost/v1/assets", { method: "POST", headers: { "content-type": "text/plain", "idempotency-key": "x" }, body: "{}" }),
    new Request("http://localhost/v1/networks", { method: "DELETE" }), new Request("http://localhost/v2/networks")
  ];
  for (const request of cases) { const response = await value.api.handle(request); const result = await body(response); const error = result.error as Record<string, unknown>; assert.equal(typeof error.code, "string"); assert.equal(typeof error.message, "string"); assert.equal(error.requestId, "req_test"); assert.equal(response.headers.get("x-request-id"), "req_test"); }
});

test("domain errors map consistently without exposing internal exceptions", async () => {
  for (const [code, status] of [["NOT_FOUND", 404], ["ALREADY_EXISTS", 409], ["CONFLICT", 409], ["INVALID_ARGUMENT", 400]] as const) { const response = await fixture(new RegistryError(code, "safe message")).api.handle(new Request("http://localhost/v1/networks")); assert.equal(response.status, status); assert.equal(((await body(response)).error as Record<string, unknown>).message, "safe message"); }
  const response = await fixture(new Error("database password leaked")).api.handle(new Request("http://localhost/v1/networks")); assert.equal(response.status, 500); assert.equal(((await body(response)).error as Record<string, unknown>).message, "an unexpected error occurred");
});

test("success envelopes contain data and correlated request IDs", async () => { const response = await fixture().api.handle(new Request("http://localhost/v1/networks")); const result = await body(response); assert.equal(result.requestId, "req_test"); assert.deepEqual(result.data, { operation: "networks.list", id: null }); assert.match(response.headers.get("content-type") ?? "", /application\/json/); });
