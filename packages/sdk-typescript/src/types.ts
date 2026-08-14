export type InterWeaveId<T extends string> = `IW:${T}:${string}`;
export type NetworkId = InterWeaveId<"NETWORK">;
export type AssetId = InterWeaveId<"ASSET">;
export type IdentityId = InterWeaveId<"IDENTITY">;
export type TransferId = InterWeaveId<"TRANSFER">;
export type BridgeId = InterWeaveId<"BRIDGE">;
export type SettlementId = InterWeaveId<"SETTLEMENT">;
export type AttestationId = InterWeaveId<"ATTESTATION">;
export type TransactionId = InterWeaveId<"TRANSACTION">;
export type AtomicAmount = string;
export type IsoTimestamp = string;

export interface Network { id: NetworkId; type: "CANTON" | "EVM" | string; name: string; environment: "LOCAL" | "DEVNET" | "TESTNET" | "MAINNET" | string; enabled: boolean }
export interface Asset { id: AssetId; name: string; symbol: string; issuerIdentityId: IdentityId; decimals: number; tokenType: "FUNGIBLE" | "NON_FUNGIBLE" | "MULTI_TOKEN"; canonicalNetworkId?: NetworkId; capabilities: readonly string[]; status: "ACTIVE" | "PAUSED" | "DEGRADED" | "RETIRED"; metadata: Readonly<Record<string, string>>; createdAt: IsoTimestamp }
export interface CreateAssetInput extends Omit<Asset, "createdAt"> { createdAt?: IsoTimestamp }
export interface Balance { assetId: AssetId; identityId: IdentityId; networkId: NetworkId; available: AtomicAmount; locked: AtomicAmount; observedAt: IsoTimestamp }
export interface Identity { id: IdentityId; displayName?: string; bindings: readonly IdentityBinding[]; createdAt: IsoTimestamp }
export interface IdentityBinding { bindingId: InterWeaveId<"BINDING">; networkId: NetworkId; locator: Readonly<Record<string, string>>; proofMethod: string; verifiedAt: IsoTimestamp; expiresAt?: IsoTimestamp; revokedAt?: IsoTimestamp }
export interface CreateIdentityInput { id: IdentityId; displayName?: string }
export interface CreateBindingInput { networkId: NetworkId; locator: Readonly<Record<string, string>>; proof: Readonly<Record<string, string>>; expiresAt?: IsoTimestamp }
export interface Transfer { id: TransferId; assetId: AssetId; networkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; status: string; transactionId?: TransactionId; createdAt: IsoTimestamp }
export interface CreateTransferInput { id?: TransferId; assetId: AssetId; networkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; metadata?: Readonly<Record<string, string>> }
export interface BridgeTransfer { id: BridgeId; assetId: AssetId; sourceNetworkId: NetworkId; destinationNetworkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; state: string; createdAt: IsoTimestamp; expiresAt: IsoTimestamp }
export interface CreateBridgeTransferInput { id?: BridgeId; assetId: AssetId; sourceNetworkId: NetworkId; destinationNetworkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; expiresAt: IsoTimestamp }
export interface SettlementLeg { assetId: AssetId; networkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount }
export interface Settlement { id: SettlementId; mode: "NETWORK_NATIVE_ATOMIC" | "CROSS_NETWORK_SAGA"; guarantee: "NETWORK_NATIVE_ATOMIC" | "CROSS_NETWORK_SAGA_NON_ATOMIC"; legs: readonly SettlementLeg[]; status: string; createdAt: IsoTimestamp }
export interface CreateSettlementInput { id?: SettlementId; legs: readonly [SettlementLeg, SettlementLeg]; expiresAt: IsoTimestamp }
export type ClaimValue = string | number | boolean | null;
export interface Attestation { id: AttestationId; predicateType: string; sourceNetworkId: NetworkId; claims: Readonly<Record<string, ClaimValue>>; status: "VERIFIED_EVIDENCE_ONLY" | "REJECTED"; digest?: `sha256:${string}`; validFrom: IsoTimestamp; expiresAt: IsoTimestamp }
export interface RequestAttestationInput { id?: AttestationId; sourceNetworkId: NetworkId; sourceTransactionId: string; sourceEventPosition: string; predicateType: string; claims: Readonly<Record<string, ClaimValue>>; policyVersion: string; validatorSetId: string; threshold: number; validFrom: IsoTimestamp; expiresAt: IsoTimestamp }
export interface Transaction { id: TransactionId; networkId: NetworkId; status: "PREPARING" | "SUBMITTED" | "CONFIRMED" | "FINALIZED" | "FAILED" | "UNCERTAIN"; createdAt?: IsoTimestamp; updatedAt?: IsoTimestamp }
export interface Webhook { id: InterWeaveId<"WEBHOOK">; url: string; events: readonly string[]; enabled: boolean; createdAt: IsoTimestamp }
export interface CreateWebhookInput { url: string; events: readonly string[]; secret?: string }
export interface WriteOptions { idempotencyKey?: string | undefined; signal?: AbortSignal | undefined }
export interface ReadOptions { signal?: AbortSignal | undefined }
export interface BalanceOptions extends ReadOptions { identityId?: IdentityId | undefined; networkId?: NetworkId | undefined }
export interface ApiMetadata { requestId: string; status: number; headers: Readonly<Record<string, string>> }
export interface RawApiResult<T> { data: T; metadata: ApiMetadata }
