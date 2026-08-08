import type { AssetCapability, AtomicAmount, IsoTimestamp, NetworkId, RepresentationId } from "./model.js";
import { parseAtomicAmount } from "./invariants.js";

export type CantonParty = string;
export type CantonOffset = string;

export interface CantonConnection {
  networkId: NetworkId;
  participantId: string;
  authorizedParties: readonly CantonParty[];
  connectedAt: IsoTimestamp;
}

export interface CantonHealth {
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  participantId?: string;
  ledgerEnd?: CantonOffset;
  checkedAt: IsoTimestamp;
  details: Readonly<Record<string, string>>;
}

export interface CantonAssetMetadata {
  representationId: RepresentationId;
  name: string;
  symbol: string;
  decimals: number;
  issuerParty: CantonParty;
  registryId: string;
  tokenStandard: "CIP0056" | "CIP0112";
  capabilities: readonly AssetCapability[];
}

export interface CantonHolding {
  holdingId: string;
  representationId: RepresentationId;
  owner: CantonParty;
  amount: AtomicAmount;
  locked: boolean;
  visibleAt: CantonOffset;
}

export interface CantonTransferRequest {
  representationId: RepresentationId;
  sender: CantonParty;
  receiver: CantonParty;
  amount: AtomicAmount;
  idempotencyKey: string;
  metadata: Readonly<Record<string, string>>;
}

export interface PreparedCantonTransfer {
  request: CantonTransferRequest;
  commandId: string;
  requiredActAs: readonly CantonParty[];
  expiresAt: IsoTimestamp;
  opaqueCommand: unknown;
}

export interface CantonSubmission {
  commandId: string;
  externalTransactionId?: string;
  status: "SUBMITTED" | "REJECTED";
  rejectionReason?: string;
}

export interface CantonTransactionObservation {
  externalTransactionId: string;
  status: "COMMITTED" | "REJECTED" | "UNKNOWN";
  completionOffset?: CantonOffset;
  synchronizerId?: string;
  observedByParticipant: string;
  observedAt: IsoTimestamp;
}

export interface CantonEvent {
  offset: CantonOffset;
  transactionId: string;
  kind: "CREATED" | "ARCHIVED" | "REASSIGNED";
  templateOrInterfaceId: string;
  payload: unknown;
  witnessedBy: readonly CantonParty[];
}

export interface PartyScope { parties: readonly CantonParty[] }
export interface CantonEventSubscription extends PartyScope { beginExclusive?: CantonOffset; interfaceIds?: readonly string[] }
export interface CantonStateQuery extends PartyScope { interfaceId: string; activeAtOffset?: CantonOffset; predicate?: Readonly<Record<string, string>> }

export interface CantonTokenAdapter {
  readonly standard: "CIP0056" | "CIP0112";
  getAssetMetadata(representationId: RepresentationId, scope: PartyScope): Promise<CantonAssetMetadata>;
  getHoldings(representationId: RepresentationId, scope: PartyScope): Promise<readonly CantonHolding[]>;
  prepareTransfer(request: CantonTransferRequest): Promise<PreparedCantonTransfer>;
}

/** Transport boundary implemented by the official Ledger API/Wallet SDK integration. */
export interface CantonTransport {
  connect(): Promise<CantonConnection>;
  health(): Promise<CantonHealth>;
  resolveParty(hint: string): Promise<CantonParty | undefined>;
  submit(prepared: PreparedCantonTransfer): Promise<CantonSubmission>;
  observeTransaction(externalTransactionId: string, scope: PartyScope): Promise<CantonTransactionObservation>;
  subscribeEvents(subscription: CantonEventSubscription): AsyncIterable<CantonEvent>;
  queryState(query: CantonStateQuery): Promise<readonly CantonEvent[]>;
}

export interface CantonAdapter {
  connect(): Promise<CantonConnection>;
  health(): Promise<CantonHealth>;
  resolveParty(hint: string): Promise<CantonParty | undefined>;
  getAssetMetadata(standard: CantonTokenAdapter["standard"], representationId: RepresentationId, scope: PartyScope): Promise<CantonAssetMetadata>;
  getHoldings(standard: CantonTokenAdapter["standard"], representationId: RepresentationId, scope: PartyScope): Promise<readonly CantonHolding[]>;
  getBalance(standard: CantonTokenAdapter["standard"], representationId: RepresentationId, owner: CantonParty): Promise<AtomicAmount>;
  prepareTransfer(standard: CantonTokenAdapter["standard"], request: CantonTransferRequest): Promise<PreparedCantonTransfer>;
  executeTransfer(prepared: PreparedCantonTransfer): Promise<CantonSubmission>;
  observeTransaction(externalTransactionId: string, scope: PartyScope): Promise<CantonTransactionObservation>;
  subscribeEvents(subscription: CantonEventSubscription): AsyncIterable<CantonEvent>;
  queryState(query: CantonStateQuery): Promise<readonly CantonEvent[]>;
}

export class CantonAuthorizationError extends Error {
  constructor(message: string) { super(message); this.name = "CantonAuthorizationError"; }
}

export class CantonAdapterClient implements CantonAdapter {
  #connection?: CantonConnection;
  readonly #tokens: ReadonlyMap<CantonTokenAdapter["standard"], CantonTokenAdapter>;
  constructor(readonly transport: CantonTransport, tokens: readonly CantonTokenAdapter[]) {
    this.#tokens = new Map(tokens.map((token) => [token.standard, token]));
  }

  async connect(): Promise<CantonConnection> { const connection = await this.transport.connect(); this.#connection = structuredClone(connection); return structuredClone(connection); }
  health(): Promise<CantonHealth> { return this.transport.health(); }
  resolveParty(hint: string): Promise<CantonParty | undefined> { if (!hint.trim()) throw new Error("party hint is required"); return this.transport.resolveParty(hint); }

  async getAssetMetadata(standard: CantonTokenAdapter["standard"], representationId: RepresentationId, scope: PartyScope): Promise<CantonAssetMetadata> {
    this.#assertScope(scope); return this.#token(standard).getAssetMetadata(representationId, scope);
  }
  async getHoldings(standard: CantonTokenAdapter["standard"], representationId: RepresentationId, scope: PartyScope): Promise<readonly CantonHolding[]> {
    this.#assertScope(scope); return this.#token(standard).getHoldings(representationId, scope);
  }
  async getBalance(standard: CantonTokenAdapter["standard"], representationId: RepresentationId, owner: CantonParty): Promise<AtomicAmount> {
    this.#assertScope({ parties: [owner] });
    const holdings = await this.#token(standard).getHoldings(representationId, { parties: [owner] });
    return holdings.filter((holding) => holding.owner === owner && !holding.locked).reduce((sum, holding) => sum + parseAtomicAmount(holding.amount), 0n).toString();
  }
  async prepareTransfer(standard: CantonTokenAdapter["standard"], request: CantonTransferRequest): Promise<PreparedCantonTransfer> {
    this.#assertScope({ parties: [request.sender] });
    if (parseAtomicAmount(request.amount) <= 0n) throw new Error("transfer amount must be positive");
    if (!request.idempotencyKey.trim()) throw new Error("idempotency key is required");
    return this.#token(standard).prepareTransfer(request);
  }
  async executeTransfer(prepared: PreparedCantonTransfer): Promise<CantonSubmission> {
    this.#assertScope({ parties: prepared.requiredActAs });
    if (!prepared.requiredActAs.includes(prepared.request.sender)) throw new CantonAuthorizationError("prepared transfer must act as sender");
    return this.transport.submit(prepared);
  }
  observeTransaction(externalTransactionId: string, scope: PartyScope): Promise<CantonTransactionObservation> { this.#assertScope(scope); return this.transport.observeTransaction(externalTransactionId, scope); }
  subscribeEvents(subscription: CantonEventSubscription): AsyncIterable<CantonEvent> { this.#assertScope(subscription); return this.transport.subscribeEvents(subscription); }
  queryState(query: CantonStateQuery): Promise<readonly CantonEvent[]> { this.#assertScope(query); return this.transport.queryState(query); }

  #token(standard: CantonTokenAdapter["standard"]): CantonTokenAdapter { const token = this.#tokens.get(standard); if (!token) throw new Error(`unsupported Canton token standard: ${standard}`); return token; }
  #assertScope(scope: PartyScope): void {
    if (!this.#connection) throw new Error("Canton adapter is not connected");
    if (scope.parties.length === 0) throw new CantonAuthorizationError("an explicit party scope is required");
    const authorized = new Set(this.#connection.authorizedParties);
    for (const party of scope.parties) if (!authorized.has(party)) throw new CantonAuthorizationError(`party is not authorized by this connection: ${party}`);
  }
}

/** CIP-0056 implementation delegates package/interface resolution to a replaceable gateway. */
export interface Cip56Gateway {
  metadata(representationId: RepresentationId, scope: PartyScope): Promise<CantonAssetMetadata>;
  holdings(representationId: RepresentationId, scope: PartyScope): Promise<readonly CantonHolding[]>;
  transfer(request: CantonTransferRequest): Promise<PreparedCantonTransfer>;
}

export class Cip56Adapter implements CantonTokenAdapter {
  readonly standard = "CIP0056" as const;
  constructor(readonly gateway: Cip56Gateway) {}
  getAssetMetadata(representationId: RepresentationId, scope: PartyScope): Promise<CantonAssetMetadata> { return this.gateway.metadata(representationId, scope); }
  getHoldings(representationId: RepresentationId, scope: PartyScope): Promise<readonly CantonHolding[]> { return this.gateway.holdings(representationId, scope); }
  prepareTransfer(request: CantonTransferRequest): Promise<PreparedCantonTransfer> { return this.gateway.transfer(request); }
}

/** Compatibility seam only; no CIP-0112 behavior is claimed until an implementation is supplied. */
export interface Cip112Adapter extends CantonTokenAdapter { readonly standard: "CIP0112" }
