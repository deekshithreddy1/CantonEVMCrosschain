import assert from "node:assert/strict";
import test from "node:test";
import { InterWeave, InterWeaveApiError } from "./index.js";

type Call = { url: string; init?: RequestInit };
function fixture(responder: (call: Call) => Response = () => Response.json({ data: { ok: true }, requestId: "req-1" })) { const calls: Call[] = []; const fetcher: typeof fetch = async (input, init) => { const call = { url: input.toString(), ...(init ? { init } : {}) }; calls.push(call); return responder(call); }; return { client: new InterWeave({ apiKey: "secret", baseUrl: "http://localhost:3000", fetch: fetcher, idempotencyKey: () => "generated-key" }), calls }; }

test("resource methods provide the intended network-neutral developer experience", async () => {
  const value = fixture(); await value.client.assets.get("IW:ASSET:bond"); await value.client.assets.balance("IW:ASSET:bond", { identityId: "IW:IDENTITY:alice" }); await value.client.bridge.move({ assetId: "IW:ASSET:bond", sourceNetworkId: "IW:NETWORK:canton", destinationNetworkId: "IW:NETWORK:evm", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", amount: "10", expiresAt: "2026-08-13T13:00:00.000Z" }); await value.client.settlement.get("IW:SETTLEMENT:one"); await value.client.attestations.get("IW:ATTESTATION:one"); await value.client.transactions.get("IW:TRANSACTION:one");
  assert.match(value.calls[0]!.url, /\/v1\/assets\/IW%3AASSET%3Abond$/); assert.match(value.calls[1]!.url, /identityId=IW%3AIDENTITY%3Aalice/); assert.match(value.calls[2]!.url, /\/v1\/bridge\/transfers$/); assert.match(value.calls[3]!.url, /\/v1\/settlements\//); assert.match(value.calls[4]!.url, /\/v1\/attestations\//); assert.match(value.calls[5]!.url, /\/v1\/transactions\//);
});

test("writes authenticate and always carry generated or caller-supplied idempotency", async () => {
  const value = fixture(); await value.client.transfers.create({ assetId: "IW:ASSET:cash", networkId: "IW:NETWORK:canton", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", amount: "5" }); await value.client.webhooks.create({ url: "https://example.test/hook", events: ["transaction.completed"] }, { idempotencyKey: "caller-key" });
  const first = new Headers(value.calls[0]!.init?.headers); const second = new Headers(value.calls[1]!.init?.headers); assert.equal(first.get("authorization"), "Bearer secret"); assert.equal(first.get("idempotency-key"), "generated-key"); assert.equal(second.get("idempotency-key"), "caller-key"); assert.equal(first.get("content-type"), "application/json");
});

test("normal methods return domain data while raw requests explicitly expose metadata", async () => {
  const value = fixture(() => new Response(JSON.stringify({ data: [{ id: "IW:NETWORK:test" }], requestId: "req-low-level" }), { status: 200, headers: { "content-type": "application/json", "x-provider": "hidden-by-default" } })); const networks = await value.client.networks.list(); assert.equal(networks[0]?.id, "IW:NETWORK:test"); assert.equal("metadata" in networks, false);
  const raw = await value.client.raw.request<readonly { id: string }[]>({ path: "/v1/networks" }); assert.equal(raw.metadata.requestId, "req-low-level"); assert.equal(raw.metadata.headers["x-provider"], "hidden-by-default");
});

test("API failures become typed errors with retry and request correlation", async () => {
  const value = fixture(() => Response.json({ error: { code: "TEMPORARY_UNAVAILABLE", message: "try later", requestId: "req-error", details: [{ field: "network", reason: "offline" }] } }, { status: 503 }));
  await assert.rejects(value.client.networks.list(), (error: unknown) => { assert.equal(error instanceof InterWeaveApiError, true); const value = error as InterWeaveApiError; assert.equal(value.code, "TEMPORARY_UNAVAILABLE"); assert.equal(value.requestId, "req-error"); assert.equal(value.retryable, true); assert.equal(value.details?.[0]?.field, "network"); return true; });
});

test("constructor rejects missing credentials and insecure remote URLs", () => { assert.throws(() => new InterWeave({ apiKey: "" }), /apiKey/); assert.throws(() => new InterWeave({ apiKey: "x", baseUrl: "http://api.example.com" }), /HTTPS/); assert.doesNotThrow(() => new InterWeave({ apiKey: "x", baseUrl: "http://localhost:3000" })); });
