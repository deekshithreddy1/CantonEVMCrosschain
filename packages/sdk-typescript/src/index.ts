import { randomUUID } from "node:crypto";
import type { ApiMetadata, Asset, AssetId, Attestation, AttestationId, Balance, BalanceOptions, BridgeId, BridgeTransfer, CreateAssetInput, CreateBindingInput, CreateBridgeTransferInput, CreateIdentityInput, CreateSettlementInput, CreateTransferInput, CreateWebhookInput, Identity, IdentityId, Network, RawApiResult, ReadOptions, RequestAttestationInput, Settlement, SettlementId, Transaction, TransactionId, Transfer, TransferId, Webhook, WriteOptions } from "./types.js";
export * from "./types.js";

export interface InterWeaveOptions { apiKey: string; baseUrl?: string | undefined; timeoutMs?: number | undefined; fetch?: typeof fetch | undefined; idempotencyKey?: (() => string) | undefined }
export interface ApiErrorDetail { field?: string; reason: string }
export class InterWeaveApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string, readonly details?: readonly ApiErrorDetail[]) { super(message); this.name = "InterWeaveApiError"; }
  get retryable() { return this.status === 408 || this.status === 429 || this.status >= 500; }
}

type Method = "GET" | "POST";
export interface RawRequestInput { method?: Method | undefined; path: string; body?: unknown; query?: Readonly<Record<string, string | undefined>> | undefined; idempotencyKey?: string | undefined; signal?: AbortSignal | undefined }
interface ErrorEnvelope { error?: { code?: string; message?: string; requestId?: string; details?: readonly ApiErrorDetail[] } }
interface SuccessEnvelope<T> { data: T; requestId: string }

class Transport {
  readonly baseUrl: string; readonly fetcher: typeof fetch;
  constructor(readonly options: { apiKey: string; baseUrl: string; timeoutMs: number; fetch: typeof fetch | undefined; idempotencyKey: () => string }) { this.baseUrl = normalizeBaseUrl(options.baseUrl); this.fetcher = options.fetch ?? globalThis.fetch; if (!this.fetcher) throw new TypeError("A Fetch implementation is required"); }
  async data<T>(input: RawRequestInput): Promise<T> { return (await this.raw<T>(input)).data; }
  async raw<T>(input: RawRequestInput): Promise<RawApiResult<T>> {
    const url = new URL(`${this.baseUrl}${input.path}`); for (const [key, value] of Object.entries(input.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(new Error("InterWeave request timed out")), this.options.timeoutMs); const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${this.options.apiKey}` }; if (input.body !== undefined) headers["content-type"] = "application/json"; if (input.method === "POST") headers["idempotency-key"] = input.idempotencyKey ?? this.options.idempotencyKey();
    try {
      const response = await this.fetcher(url, { method: input.method ?? "GET", headers, ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}), signal }); const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) { const failure = payload as ErrorEnvelope | undefined; throw new InterWeaveApiError(response.status, failure?.error?.code ?? "HTTP_ERROR", failure?.error?.message ?? `InterWeave API request failed with status ${response.status}`, failure?.error?.requestId ?? response.headers.get("x-request-id") ?? undefined, failure?.error?.details); }
      if (!payload || typeof payload !== "object" || !("data" in payload)) throw new InterWeaveApiError(response.status, "INVALID_RESPONSE", "InterWeave API returned an invalid response", response.headers.get("x-request-id") ?? undefined);
      const envelope = payload as SuccessEnvelope<T>; const metadata: ApiMetadata = { requestId: envelope.requestId, status: response.status, headers: Object.fromEntries(response.headers.entries()) }; return { data: envelope.data, metadata };
    } finally { clearTimeout(timeout); }
  }
}

export class InterWeave {
  readonly #transport: Transport;
  readonly networks: { list: (options?: ReadOptions) => Promise<readonly Network[]> };
  readonly assets: { create: (input: CreateAssetInput, options?: WriteOptions) => Promise<Asset>; get: (id: AssetId, options?: ReadOptions) => Promise<Asset>; balance: (id: AssetId, options?: BalanceOptions) => Promise<readonly Balance[]> };
  readonly identities: { create: (input: CreateIdentityInput, options?: WriteOptions) => Promise<Identity>; bind: (id: IdentityId, input: CreateBindingInput, options?: WriteOptions) => Promise<Identity> };
  readonly transfers: { create: (input: CreateTransferInput, options?: WriteOptions) => Promise<Transfer>; get: (id: TransferId, options?: ReadOptions) => Promise<Transfer> };
  readonly bridge: { move: (input: CreateBridgeTransferInput, options?: WriteOptions) => Promise<BridgeTransfer>; get: (id: BridgeId, options?: ReadOptions) => Promise<BridgeTransfer> };
  readonly settlement: { create: (input: CreateSettlementInput, options?: WriteOptions) => Promise<Settlement>; get: (id: SettlementId, options?: ReadOptions) => Promise<Settlement> };
  readonly attestations: { request: (input: RequestAttestationInput, options?: WriteOptions) => Promise<Attestation>; get: (id: AttestationId, options?: ReadOptions) => Promise<Attestation> };
  readonly transactions: { get: (id: TransactionId, options?: ReadOptions) => Promise<Transaction> };
  readonly webhooks: { create: (input: CreateWebhookInput, options?: WriteOptions) => Promise<Webhook> };
  readonly raw: { request: <T>(input: RawRequestInput) => Promise<RawApiResult<T>> };
  constructor(options: InterWeaveOptions) {
    if (!options.apiKey?.trim()) throw new TypeError("InterWeave apiKey is required"); this.#transport = new Transport({ apiKey: options.apiKey, baseUrl: options.baseUrl ?? "https://api.interweave.dev", timeoutMs: options.timeoutMs ?? 30_000, fetch: options.fetch, idempotencyKey: options.idempotencyKey ?? (() => randomUUID()) }); const t = this.#transport;
    this.networks = { list: (o) => t.data({ path: "/v1/networks", signal: o?.signal }) };
    this.assets = { create: (v,o) => t.data({ method:"POST",path:"/v1/assets",body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal }), get: (id,o) => t.data({path:`/v1/assets/${encodeURIComponent(id)}`,signal:o?.signal}), balance: (id,o) => t.data({path:`/v1/assets/${encodeURIComponent(id)}/balances`,query:{identityId:o?.identityId,networkId:o?.networkId},signal:o?.signal}) };
    this.identities = { create: (v,o) => t.data({method:"POST",path:"/v1/identities",body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal}), bind: (id,v,o) => t.data({method:"POST",path:`/v1/identities/${encodeURIComponent(id)}/bindings`,body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal}) };
    this.transfers = { create: (v,o) => t.data({method:"POST",path:"/v1/transfers",body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal}), get: (id,o) => t.data({path:`/v1/transfers/${encodeURIComponent(id)}`,signal:o?.signal}) };
    this.bridge = { move: (v,o) => t.data({method:"POST",path:"/v1/bridge/transfers",body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal}), get: (id,o) => t.data({path:`/v1/bridge/transfers/${encodeURIComponent(id)}`,signal:o?.signal}) };
    this.settlement = { create: (v,o) => t.data({method:"POST",path:"/v1/settlements",body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal}), get: (id,o) => t.data({path:`/v1/settlements/${encodeURIComponent(id)}`,signal:o?.signal}) };
    this.attestations = { request: (v,o) => t.data({method:"POST",path:"/v1/attestations",body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal}), get: (id,o) => t.data({path:`/v1/attestations/${encodeURIComponent(id)}`,signal:o?.signal}) };
    this.transactions = { get: (id,o) => t.data({path:`/v1/transactions/${encodeURIComponent(id)}`,signal:o?.signal}) }; this.webhooks = { create: (v,o) => t.data({method:"POST",path:"/v1/webhooks",body:v,idempotencyKey:o?.idempotencyKey,signal:o?.signal}) }; this.raw = { request: (input) => t.raw(input) };
  }
}

function normalizeBaseUrl(value: string) { const url = new URL(value); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1","::1"].includes(url.hostname))) throw new TypeError("InterWeave baseUrl must use HTTPS except for localhost"); return url.toString().replace(/\/$/, ""); }
