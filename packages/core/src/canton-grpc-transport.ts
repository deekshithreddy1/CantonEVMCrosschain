import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type {
  CantonConnection, CantonEvent, CantonEventSubscription, CantonHealth, CantonParty,
  CantonStateQuery, CantonSubmission, CantonTransactionObservation, CantonTransport,
  PreparedCantonTransfer
} from "./canton-adapter.js";
import type { IsoTimestamp, NetworkId } from "./model.js";

type JsonObject = Record<string, unknown>;
type UnaryCallback = (error: grpc.ServiceError | null, response?: JsonObject) => void;

export interface LedgerApiClient {
  [method: string]: unknown;
  close?: () => void;
}

export interface CantonLedgerApiClients {
  version: LedgerApiClient;
  state: LedgerApiClient;
  partyManagement: LedgerApiClient;
  commandSubmission: LedgerApiClient;
  update: LedgerApiClient;
}

export interface CantonGrpcTransportOptions {
  endpoint: string;
  networkId: NetworkId;
  participantId: string;
  authorizedParties: readonly CantonParty[];
  userId: string;
  token?: string;
  deadlineMs?: number;
  clients?: CantonLedgerApiClients;
  proto?: {
    files: readonly string[];
    includeDirs?: readonly string[];
    services?: Partial<Record<keyof CantonLedgerApiClients, string>>;
  };
  tls?: { rootCert?: Buffer; privateKey?: Buffer; certChain?: Buffer; serverName?: string };
  now?: () => Date;
}

const defaultServices: Record<keyof CantonLedgerApiClients, string> = {
  version: "com.daml.ledger.api.v2.VersionService",
  state: "com.daml.ledger.api.v2.StateService",
  partyManagement: "com.daml.ledger.api.v2.admin.PartyManagementService",
  commandSubmission: "com.daml.ledger.api.v2.CommandSubmissionService",
  update: "com.daml.ledger.api.v2.UpdateService"
};

/** Real Canton Ledger API v2 transport using grpc-js and the official protobuf files. */
export class CantonGrpcTransport implements CantonTransport {
  readonly #options: CantonGrpcTransportOptions;
  readonly #clients: CantonLedgerApiClients;
  readonly #metadata: grpc.Metadata;

  constructor(options: CantonGrpcTransportOptions) {
    if (!options.endpoint.trim()) throw new Error("Canton gRPC endpoint is required");
    if (!options.userId.trim()) throw new Error("Canton Ledger API userId is required");
    if (options.authorizedParties.length === 0) throw new Error("at least one authorized Canton party is required");
    this.#options = options;
    this.#metadata = new grpc.Metadata();
    if (options.token) this.#metadata.set("authorization", `Bearer ${options.token}`);
    this.#clients = options.clients ?? createLedgerApiClients(options);
  }

  async connect(): Promise<CantonConnection> {
    await this.#unary(this.#clients.version, "getLedgerApiVersion", {});
    return {
      networkId: this.#options.networkId,
      participantId: this.#options.participantId,
      authorizedParties: [...this.#options.authorizedParties],
      connectedAt: this.#timestamp()
    };
  }

  async health(): Promise<CantonHealth> {
    const checkedAt = this.#timestamp();
    try {
      const [version, ledgerEnd] = await Promise.all([
        this.#unary(this.#clients.version, "getLedgerApiVersion", {}),
        this.#unary(this.#clients.state, "getLedgerEnd", {})
      ]);
      const ledgerEndOffset = offsetOf(ledgerEnd);
      return {
        status: "HEALTHY", participantId: this.#options.participantId,
        ...(ledgerEndOffset ? { ledgerEnd: ledgerEndOffset } : {}), checkedAt,
        details: { endpoint: this.#options.endpoint, ledgerApiVersion: stringOf(version.version) }
      };
    } catch (error) {
      const grpcError = error as Partial<grpc.ServiceError>;
      return {
        status: grpcError.code === grpc.status.UNAVAILABLE ? "UNAVAILABLE" : "DEGRADED",
        participantId: this.#options.participantId, checkedAt,
        details: { endpoint: this.#options.endpoint, error: errorMessage(error) }
      };
    }
  }

  async resolveParty(hint: string): Promise<CantonParty | undefined> {
    const response = await this.#unary(this.#clients.partyManagement, "listKnownParties", {
      pageSize: 1000, identityProviderId: ""
    });
    const parties = arrayOf(response.partyDetails ?? response.parties);
    const exact = parties.find((entry) => stringOf(objectOf(entry).party) === hint);
    if (exact) return stringOf(objectOf(exact).party);
    const matches = parties.map((entry) => stringOf(objectOf(entry).party))
      .filter((party) => party === hint || party.startsWith(`${hint}::`));
    return matches.length === 1 ? matches[0] : undefined;
  }

  async submit(prepared: PreparedCantonTransfer): Promise<CantonSubmission> {
    const opaque = objectOf(prepared.opaqueCommand);
    const request = { commands: { ...opaque, commandId: prepared.commandId, userId: this.#options.userId,
      actAs: [...prepared.requiredActAs] } };
    try {
      await this.#unary(this.#clients.commandSubmission, "submit", request);
      return { commandId: prepared.commandId, status: "SUBMITTED" };
    } catch (error) {
      const code = (error as Partial<grpc.ServiceError>).code;
      if (code === grpc.status.INVALID_ARGUMENT || code === grpc.status.PERMISSION_DENIED ||
          code === grpc.status.FAILED_PRECONDITION || code === grpc.status.ALREADY_EXISTS) {
        return { commandId: prepared.commandId, status: "REJECTED", rejectionReason: errorMessage(error) };
      }
      throw error;
    }
  }

  async observeTransaction(externalTransactionId: string, scope: { parties: readonly CantonParty[] }): Promise<CantonTransactionObservation> {
    try {
      const response = await this.#unary(this.#clients.update, "getTransactionById", {
        updateId: externalTransactionId, transactionFormat: transactionFormat(scope.parties)
      });
      const transaction = objectOf(response.transaction ?? response);
      const completionOffset = offsetOf(transaction);
      const synchronizerId = optionalString(transaction.synchronizerId);
      return {
        externalTransactionId, status: "COMMITTED",
        ...(completionOffset ? { completionOffset } : {}),
        ...(synchronizerId ? { synchronizerId } : {}),
        observedByParticipant: this.#options.participantId, observedAt: this.#timestamp()
      };
    } catch (error) {
      if ((error as Partial<grpc.ServiceError>).code === grpc.status.NOT_FOUND) {
        return { externalTransactionId, status: "UNKNOWN", observedByParticipant: this.#options.participantId, observedAt: this.#timestamp() };
      }
      throw error;
    }
  }

  async *subscribeEvents(subscription: CantonEventSubscription): AsyncIterable<CantonEvent> {
    const request: JsonObject = { beginExclusive: subscription.beginExclusive,
      updateFormat: transactionFormat(subscription.parties, subscription.interfaceIds) };
    const stream = this.#stream(this.#clients.update, "getUpdates", compact(request));
    for await (const response of stream) {
      for (const event of eventsFromUpdate(response)) yield event;
    }
  }

  async queryState(query: CantonStateQuery): Promise<readonly CantonEvent[]> {
    const request = compact({ activeAtOffset: query.activeAtOffset,
      eventFormat: eventFormat(query.parties, [query.interfaceId]) });
    const stream = this.#stream(this.#clients.state, "getActiveContracts", request);
    const result: CantonEvent[] = [];
    for await (const response of stream) {
      for (const event of eventsFromActiveContracts(response)) {
        if (matchesPredicate(event.payload, query.predicate)) result.push(event);
      }
    }
    return result;
  }

  close(): void { for (const client of Object.values(this.#clients)) client.close?.(); }

  #timestamp(): IsoTimestamp { return (this.#options.now?.() ?? new Date()).toISOString(); }
  #callOptions(): grpc.CallOptions { return { deadline: Date.now() + (this.#options.deadlineMs ?? 10_000) }; }

  #unary(client: LedgerApiClient, method: string, request: JsonObject): Promise<JsonObject> {
    const fn = client[method];
    if (typeof fn !== "function") return Promise.reject(new Error(`Ledger API client does not implement ${method}`));
    return new Promise((resolve, reject) => {
      const callback: UnaryCallback = (error, response) => {
        if (error) reject(error); else resolve(response ?? {});
      };
      (fn as Function).call(client, request, this.#metadata, this.#callOptions(), callback);
    });
  }

  #stream(client: LedgerApiClient, method: string, request: JsonObject): AsyncIterable<JsonObject> {
    const fn = client[method];
    if (typeof fn !== "function") throw new Error(`Ledger API client does not implement ${method}`);
    const call = (fn as Function).call(client, request, this.#metadata, this.#callOptions()) as grpc.ClientReadableStream<JsonObject>;
    return call;
  }
}

export function createLedgerApiClients(options: CantonGrpcTransportOptions): CantonLedgerApiClients {
  if (!options.proto?.files.length) throw new Error("official Canton Ledger API protobuf file paths are required");
  const definition = protoLoader.loadSync([...options.proto.files], {
    ...(options.proto.includeDirs ? { includeDirs: [...options.proto.includeDirs] } : {}),
    keepCase: false, longs: String, enums: String, defaults: true, oneofs: true
  });
  const root = grpc.loadPackageDefinition(definition) as unknown as JsonObject;
  const credentials = options.tls
    ? grpc.credentials.createSsl(options.tls.rootCert, options.tls.privateKey, options.tls.certChain)
    : grpc.credentials.createInsecure();
  const channelOptions: grpc.ChannelOptions = {};
  if (options.tls?.serverName) channelOptions["grpc.ssl_target_name_override"] = options.tls.serverName;
  const make = (key: keyof CantonLedgerApiClients): LedgerApiClient => {
    const path = options.proto?.services?.[key] ?? defaultServices[key];
    const ctor = path.split(".").reduce<unknown>((value, segment) => objectOf(value)[segment], root);
    if (typeof ctor !== "function") throw new Error(`Ledger API service was not found in protobuf definitions: ${path}`);
    return new (ctor as new (endpoint: string, credentials: grpc.ChannelCredentials, options: grpc.ChannelOptions) => LedgerApiClient)(options.endpoint, credentials, channelOptions);
  };
  return { version: make("version"), state: make("state"), partyManagement: make("partyManagement"),
    commandSubmission: make("commandSubmission"), update: make("update") };
}

function transactionFormat(parties: readonly string[], interfaces?: readonly string[]): JsonObject {
  return { eventFormat: eventFormat(parties, interfaces), transactionShape: "TRANSACTION_SHAPE_ACS_DELTA" };
}
function eventFormat(parties: readonly string[], interfaces?: readonly string[]): JsonObject {
  const cumulative = interfaces?.length
    ? { interfaceFilters: interfaces.map((id) => ({ interfaceId: parseIdentifier(id), includeInterfaceView: true, includeCreatedEventBlob: false })) }
    : {};
  return { filtersByParty: Object.fromEntries(parties.map((party) => [party, { cumulative: [cumulative] }])) };
}
function parseIdentifier(id: string): JsonObject {
  const [packageId = "", moduleName = "", entityName = ""] = id.split(":");
  return { packageId, moduleName, entityName };
}
function eventsFromUpdate(response: JsonObject): CantonEvent[] {
  const update = objectOf(response.update ?? response);
  const transaction = objectOf(update.transaction ?? update);
  return arrayOf(transaction.events).flatMap((event) => normalizeEvent(objectOf(event), transaction));
}
function eventsFromActiveContracts(response: JsonObject): CantonEvent[] {
  const workflow = objectOf(response.activeContract ?? response.contractEntry ?? response);
  const created = objectOf(workflow.createdEvent ?? workflow);
  return Object.keys(created).length ? normalizeEvent({ created }, objectOf(response)) : [];
}
function normalizeEvent(wrapper: JsonObject, transaction: JsonObject): CantonEvent[] {
  const raw = objectOf(wrapper.created ?? wrapper.archived ?? wrapper.reassigned ?? wrapper);
  const kind: CantonEvent["kind"] = wrapper.archived ? "ARCHIVED" : wrapper.reassigned ? "REASSIGNED" : "CREATED";
  const id = objectOf(raw.templateId ?? raw.interfaceId);
  return [{ offset: offsetOf(raw) ?? offsetOf(transaction) ?? "0",
    transactionId: stringOf(transaction.updateId ?? transaction.transactionId ?? raw.updateId), kind,
    templateOrInterfaceId: [id.packageId, id.moduleName, id.entityName].map(stringOf).filter(Boolean).join(":"),
    payload: raw.createArguments ?? raw.interfaceView ?? raw,
    witnessedBy: arrayOf(raw.witnessParties ?? raw.witnessedBy).map(stringOf) }];
}
function matchesPredicate(payload: unknown, predicate?: Readonly<Record<string, string>>): boolean {
  if (!predicate) return true;
  const object = objectOf(payload);
  return Object.entries(predicate).every(([key, value]) => String(object[key]) === value);
}
function compact(value: JsonObject): JsonObject { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
function objectOf(value: unknown): JsonObject { return value !== null && typeof value === "object" ? value as JsonObject : {}; }
function arrayOf(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringOf(value: unknown): string { return typeof value === "string" ? value : value == null ? "" : String(value); }
function optionalString(value: unknown): string | undefined { const result = stringOf(value); return result || undefined; }
function offsetOf(value: JsonObject): string | undefined { return optionalString(value.offset ?? value.ledgerEnd ?? value.completionOffset); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
