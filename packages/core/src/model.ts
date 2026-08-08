/** Network-neutral identifiers are deliberately unrelated to contract IDs or addresses. */
export type InterWeaveId<T extends string> = `IW:${T}:${string}`;
export type NetworkId = InterWeaveId<"NETWORK">;
export type AssetId = InterWeaveId<"ASSET">;
export type RepresentationId = InterWeaveId<"REPRESENTATION">;
export type IdentityId = InterWeaveId<"IDENTITY">;
export type PolicyId = InterWeaveId<"POLICY">;
export type TransferId = InterWeaveId<"TRANSFER">;
export type BridgeOperationId = InterWeaveId<"BRIDGE">;
export type SettlementId = InterWeaveId<"SETTLEMENT">;
export type AttestationId = InterWeaveId<"ATTESTATION">;
export type TransactionId = InterWeaveId<"TRANSACTION">;
export type WorkflowId = InterWeaveId<"WORKFLOW">;
export type AuditEventId = InterWeaveId<"AUDIT">;
export type IsoTimestamp = string;
export type AtomicAmount = string;

export type NetworkType = "CANTON" | "EVM" | (string & {});
export type Environment = "LOCAL" | "DEVNET" | "TESTNET" | "MAINNET" | (string & {});
export type FinalityPolicy =
  | { kind: "EVM_CONFIRMATIONS"; confirmations: number; requireFinalizedTag: boolean }
  | { kind: "CANTON_COMPLETION"; synchronizerId?: string }
  | { kind: "ADAPTER_DEFINED"; name: string; configuration: Readonly<Record<string, unknown>> };

export interface Network {
  id: NetworkId;
  type: NetworkType;
  name: string;
  environment: Environment;
  endpoints: readonly string[];
  chainId?: string;
  finalityPolicy: FinalityPolicy;
  adapterConfiguration: Readonly<Record<string, unknown>>;
  enabled: boolean;
}

export type AssetCapability = "TRANSFER" | "MINT" | "BURN" | "LOCK" | "UNLOCK" | "FREEZE" | "SETTLE" | "CROSS_NETWORK_TRANSFER";
export type TokenType = "FUNGIBLE" | "NON_FUNGIBLE" | "MULTI_TOKEN";
export type AssetStatus = "ACTIVE" | "PAUSED" | "DEGRADED" | "RETIRED";
export type SupplyModel = "FIXED" | "ISSUER_MANAGED" | "REPRESENTATION";
export type BridgeModel = "NONE" | "LOCK_MINT_BURN_RELEASE";

export interface Asset {
  id: AssetId;
  name: string;
  symbol: string;
  issuerIdentityId: IdentityId;
  decimals: number;
  tokenType: TokenType;
  canonicalNetworkId?: NetworkId;
  supplyModel: SupplyModel;
  bridgeModel: BridgeModel;
  capabilities: readonly AssetCapability[];
  metadata: Readonly<Record<string, string>>;
  status: AssetStatus;
  createdAt: IsoTimestamp;
}

export type RepresentationLocator =
  | { kind: "EVM"; chainId: string; contractAddress: string; tokenStandard: "ERC20" | "ERC721" | "ERC1155" | "ERC3643" | "ERC7943" }
  | { kind: "CANTON"; instrumentId: string; issuerParty: string; registryId: string; tokenStandard: "CIP0056" | "CIP0112" };

export interface AssetRepresentation {
  id: RepresentationId;
  assetId: AssetId;
  networkId: NetworkId;
  locator: RepresentationLocator;
  discoveredCapabilities: readonly AssetCapability[];
  enabled: boolean;
}

export type NetworkIdentityLocator =
  | { kind: "EVM"; address: string }
  | { kind: "CANTON"; party: string };
export interface NetworkIdentity {
  networkId: NetworkId;
  locator: NetworkIdentityLocator;
  proofMethod: string;
  verifiedAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  revokedAt?: IsoTimestamp;
}
export interface Identity { id: IdentityId; displayName?: string; bindings: readonly NetworkIdentity[]; createdAt: IsoTimestamp }

export interface Policy { id: PolicyId; version: string; status: "DRAFT" | "ACTIVE" | "RETIRED"; documentHash: string; createdAt: IsoTimestamp }
export interface PolicyDecision { outcome: "ALLOW" | "DENY" | "REQUIRES_APPROVAL"; reasonCodes: readonly string[]; policyId: PolicyId; policyVersion: string; decidedAt: IsoTimestamp }

export type TransactionStatus = "PREPARING" | "SUBMITTED" | "CONFIRMED" | "FINALIZED" | "FAILED" | "UNCERTAIN";
export interface FinalityEvidence { policy: FinalityPolicy; observedPosition: string; providerObservations: readonly string[]; observedAt: IsoTimestamp }
export interface NetworkTransaction { id: TransactionId; networkId: NetworkId; externalTransactionId?: string; status: TransactionStatus; finalityEvidence?: FinalityEvidence }

export interface Transfer { id: TransferId; assetId: AssetId; networkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; policyDecision: PolicyDecision; transactionId?: TransactionId; createdAt: IsoTimestamp }

export const BRIDGE_STATES = ["CREATED", "POLICY_CHECKED", "SOURCE_PREPARING", "SOURCE_SUBMITTED", "SOURCE_CONFIRMED", "SOURCE_FINALIZED", "ATTESTATION_PENDING", "ATTESTED", "DESTINATION_PREPARING", "DESTINATION_SUBMITTED", "DESTINATION_CONFIRMED", "DESTINATION_FINALIZED", "RECONCILIATION_PENDING", "RECONCILED", "COMPLETED", "POLICY_REJECTED", "SOURCE_FAILED", "ATTESTATION_FAILED", "DESTINATION_FAILED", "EXPIRED", "RECONCILIATION_FAILED", "MANUAL_REVIEW"] as const;
export type BridgeState = typeof BRIDGE_STATES[number];
export interface StateTransition { from: BridgeState | null; to: BridgeState; occurredAt: IsoTimestamp; reason: string; actor: string }
export interface BridgeOperation { id: BridgeOperationId; idempotencyKey: string; assetId: AssetId; sourceNetworkId: NetworkId; destinationNetworkId: NetworkId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; state: BridgeState; policyDecision?: PolicyDecision; transitions: readonly StateTransition[]; expiresAt: IsoTimestamp; createdAt: IsoTimestamp }

export interface ValidatorSignature { validatorId: string; algorithm: string; publicKeyId: string; signature: string; signedAt: IsoTimestamp }
export interface Attestation { version: string; id: AttestationId; operationId: BridgeOperationId; sourceNetworkId: NetworkId; sourceTransactionId: string; sourceEventPosition: string; eventType: string; assetId: AssetId; amount: AtomicAmount; sender: IdentityId; receiver: IdentityId; destinationNetworkId: NetworkId; nonce: string; observedStatePosition: string; observedAt: IsoTimestamp; validFrom: IsoTimestamp; expiresAt: IsoTimestamp; policyVersion: string; signatures: readonly ValidatorSignature[] }

export interface SettlementLeg { id: string; networkId: NetworkId; assetId: AssetId; sender: IdentityId; receiver: IdentityId; amount: AtomicAmount; status: "PENDING" | "RESERVED" | "FINALIZED" | "FAILED" | "COMPENSATED" }
export interface Settlement { id: SettlementId; mode: "NETWORK_NATIVE_ATOMIC" | "CROSS_NETWORK_SAGA"; legs: readonly SettlementLeg[]; status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "EXPIRED" | "MANUAL_REVIEW"; createdAt: IsoTimestamp }
export interface ReconciliationRecord { id: InterWeaveId<"RECONCILIATION">; assetId: AssetId; sourceLockedBacking: AtomicAmount; destinationSupply: AtomicAmount; pendingAmount: AtomicAmount; outcome: "MATCH" | "MISMATCH"; evidence: readonly string[]; checkedAt: IsoTimestamp }
export interface Workflow { id: WorkflowId; version: string; sourcePredicateType: string; actionType: string; policyId: PolicyId; enabled: boolean }
export interface AuditEvent { id: AuditEventId; operationId: string; actor: string; action: string; evidenceHash: string; occurredAt: IsoTimestamp; metadata: Readonly<Record<string, string>> }
