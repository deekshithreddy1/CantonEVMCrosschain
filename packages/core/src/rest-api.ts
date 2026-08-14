import { randomUUID } from "node:crypto";
import { RegistryError } from "./registry-errors.js";

export type RestOperation = "networks.list" | "assets.create" | "assets.get" | "assets.balance" | "identities.create" | "identities.bind" | "transfers.create" | "transfers.get" | "bridge.create" | "bridge.get" | "settlements.create" | "settlements.get" | "attestations.create" | "attestations.get" | "transactions.get" | "webhooks.create" | "emergency.list" | "emergency.create" | "emergency.lift";
export interface RestApiCommand { operation: RestOperation; path: Readonly<Record<string, string>>; query: Readonly<Record<string, string>>; body?: Readonly<Record<string, unknown>>; idempotencyKey?: string; requestId: string }
export interface RestApiBackend { execute(command: RestApiCommand): Promise<unknown> }
export interface ApiErrorBody { error: { code: string; message: string; requestId: string; details?: readonly { field?: string; reason: string }[] } }

type Route = { method: "GET" | "POST"; pattern: RegExp; names: readonly string[]; operation: RestOperation; write: boolean };
const routes: readonly Route[] = [
  { method: "GET", pattern: /^\/v1\/networks$/, names: [], operation: "networks.list", write: false },
  { method: "POST", pattern: /^\/v1\/assets$/, names: [], operation: "assets.create", write: true },
  { method: "GET", pattern: /^\/v1\/assets\/([^/]+)$/, names: ["id"], operation: "assets.get", write: false },
  { method: "GET", pattern: /^\/v1\/assets\/([^/]+)\/balances$/, names: ["id"], operation: "assets.balance", write: false },
  { method: "POST", pattern: /^\/v1\/identities$/, names: [], operation: "identities.create", write: true },
  { method: "POST", pattern: /^\/v1\/identities\/([^/]+)\/bindings$/, names: ["id"], operation: "identities.bind", write: true },
  { method: "POST", pattern: /^\/v1\/transfers$/, names: [], operation: "transfers.create", write: true },
  { method: "GET", pattern: /^\/v1\/transfers\/([^/]+)$/, names: ["id"], operation: "transfers.get", write: false },
  { method: "POST", pattern: /^\/v1\/bridge\/transfers$/, names: [], operation: "bridge.create", write: true },
  { method: "GET", pattern: /^\/v1\/bridge\/transfers\/([^/]+)$/, names: ["id"], operation: "bridge.get", write: false },
  { method: "POST", pattern: /^\/v1\/settlements$/, names: [], operation: "settlements.create", write: true },
  { method: "GET", pattern: /^\/v1\/settlements\/([^/]+)$/, names: ["id"], operation: "settlements.get", write: false },
  { method: "POST", pattern: /^\/v1\/attestations$/, names: [], operation: "attestations.create", write: true },
  { method: "GET", pattern: /^\/v1\/attestations\/([^/]+)$/, names: ["id"], operation: "attestations.get", write: false },
  { method: "GET", pattern: /^\/v1\/transactions\/([^/]+)$/, names: ["id"], operation: "transactions.get", write: false },
  { method: "POST", pattern: /^\/v1\/webhooks$/, names: [], operation: "webhooks.create", write: true }
  ,{ method: "GET", pattern: /^\/v1\/emergency-controls$/, names: [], operation: "emergency.list", write: false }
  ,{ method: "POST", pattern: /^\/v1\/emergency-controls$/, names: [], operation: "emergency.create", write: true }
  ,{ method: "POST", pattern: /^\/v1\/emergency-controls\/([^/]+)\/lift$/, names: ["id"], operation: "emergency.lift", write: true }
];

export class InterWeaveRestApi {
  constructor(readonly backend: RestApiBackend, readonly requestId: () => string = () => `req_${randomUUID()}`) {}
  async handle(request: Request): Promise<Response> {
    const id = this.requestId();
    try {
      const url = new URL(request.url); const method = request.method.toUpperCase(); const candidate = routes.map((route) => ({ route, match: route.pattern.exec(url.pathname) })).find(({ route, match }) => route.method === method && match);
      if (!candidate?.match) return error(404, "NOT_FOUND", "route not found", id);
      const path = Object.fromEntries(candidate.route.names.map((name, index) => [name, decodeURIComponent(candidate.match![index + 1] ?? "")]));
      const query = Object.fromEntries(url.searchParams.entries()); let body: Readonly<Record<string, unknown>> | undefined; let idempotencyKey: string | undefined;
      if (candidate.route.write) {
        idempotencyKey = request.headers.get("idempotency-key")?.trim(); if (!idempotencyKey) return error(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required for write requests", id);
        if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return error(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", id);
        try { const value: unknown = await request.json(); if (!value || typeof value !== "object" || Array.isArray(value)) return error(400, "INVALID_JSON_BODY", "JSON body must be an object", id); body = value as Readonly<Record<string, unknown>>; }
        catch { return error(400, "INVALID_JSON_BODY", "request body is not valid JSON", id); }
      }
      const command: RestApiCommand = { operation: candidate.route.operation, path, query, requestId: id, ...(body ? { body } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) };
      const result = await this.backend.execute(command); return json(candidate.route.write ? 201 : 200, { data: result, requestId: id }, id);
    } catch (cause) {
      if (cause instanceof RegistryError) return error(status(cause.code), cause.code, cause.message, id);
      return error(500, "INTERNAL_ERROR", "an unexpected error occurred", id);
    }
  }
}

function json(statusCode: number, value: unknown, requestId: string) { return new Response(JSON.stringify(value), { status: statusCode, headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId } }); }
function error(statusCode: number, code: string, message: string, requestId: string) { return json(statusCode, { error: { code, message, requestId } } satisfies ApiErrorBody, requestId); }
function status(code: RegistryError["code"]) { return code === "NOT_FOUND" ? 404 : code === "ALREADY_EXISTS" || code === "CONFLICT" ? 409 : 400; }

export const OPENAPI_OPERATIONS: Readonly<Record<string, RestOperation>> = Object.freeze(Object.fromEntries(routes.map((route) => [`${route.method} ${route.pattern.source}`, route.operation])));
