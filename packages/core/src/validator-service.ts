import type { NetworkId, NetworkType, ValidatorSignature } from "./model.js";
import type { AttestationSigner, UnsignedAttestation } from "./attestation-protocol.js";
import { assertUnsignedAttestation, attestationDigest, signAttestation } from "./attestation-protocol.js";
import { RegistryError } from "./registry-errors.js";

export type SourceAssetLocator =
  | { kind: "EVM_CONTRACT"; value: string }
  | { kind: "CANTON_INSTRUMENT"; value: string };

/** A coordinator provides the candidate statement, but never trusted source-state or representation configuration. */
export interface ValidatorCandidate { attestation: UnsignedAttestation }

/** Evidence returned by a network reader owned and configured by the validator. */
export interface IndependentSourceObservation {
  networkId: NetworkId; networkType: NetworkType; transactionId: string; transactionStatus: "SUCCEEDED" | "FAILED";
  eventPosition: string; eventType: string; sourceAsset: SourceAssetLocator; assetId: string; operationId: string;
  amount: string; sender: string; receiver: string; canonical: boolean; finalitySatisfied: boolean;
  observedStatePosition: string; observedAt: string; finalityEvidence: readonly string[];
}

export interface IndependentSourceProvider {
  observe(input: { sourceTransactionId: string; sourceEventPosition: string; expectedSourceAsset: SourceAssetLocator }): Promise<IndependentSourceObservation | undefined>;
}
export interface ValidatorNetworkConfiguration {
  networkId: NetworkId; networkType: NetworkType; endpoints: readonly string[]; enabled: boolean;
  sourceAssets: Readonly<Record<string, SourceAssetLocator>>; allowedPolicyVersions?: readonly string[];
}
export interface ValidatorSourceProviderFactory { create(configuration: ValidatorNetworkConfiguration): IndependentSourceProvider }

export type ValidatorRejectionCode =
  | "NETWORK_DISABLED" | "POLICY_NOT_ALLOWED" | "NOT_YET_VALID" | "EXPIRED" | "SOURCE_NOT_FOUND"
  | "NETWORK_MISMATCH" | "TRANSACTION_FAILED" | "EVENT_NOT_CANONICAL" | "SOURCE_ASSET_MISMATCH"
  | "EVENT_MISMATCH" | "ASSET_MISMATCH" | "OPERATION_MISMATCH" | "AMOUNT_MISMATCH" | "SENDER_MISMATCH"
  | "RECEIVER_MISMATCH" | "FINALITY_NOT_SATISFIED" | "OBSERVED_POSITION_MISMATCH" | "OBSERVATION_TIME_MISMATCH"
  | "PROVIDER_ERROR";

export type ValidatorDecision =
  | { outcome: "SIGNED"; validatorId: string; digest: `sha256:${string}`; signature: ValidatorSignature; evidence: IndependentSourceObservation }
  | { outcome: "REJECTED"; reasons: readonly ValidatorRejectionCode[]; evidence?: IndependentSourceObservation };

export class ValidatorService {
  readonly #networks: ReadonlyMap<NetworkId, ValidatorNetworkConfiguration>;
  readonly #providers = new Map<NetworkId, IndependentSourceProvider>();
  constructor(networks: readonly ValidatorNetworkConfiguration[], readonly providerFactory: ValidatorSourceProviderFactory, readonly signer: AttestationSigner, readonly now: () => Date = () => new Date()) {
    const configured = new Map<NetworkId, ValidatorNetworkConfiguration>();
    for (const network of networks) {
      if (configured.has(network.networkId)) throw new RegistryError("CONFLICT", `duplicate validator network: ${network.networkId}`);
      if (network.endpoints.length === 0 || network.endpoints.some((endpoint) => !endpoint.trim())) throw new RegistryError("INVALID_ARGUMENT", `validator network requires independent endpoints: ${network.networkId}`);
      configured.set(network.networkId, structuredClone(network));
    }
    this.#networks = configured;
  }

  async verifyAndSign(candidate: ValidatorCandidate): Promise<ValidatorDecision> {
    assertUnsignedAttestation(candidate.attestation);
    const attestation = candidate.attestation;
    const configuration = this.#networks.get(attestation.sourceNetworkId);
    if (!configuration || !configuration.enabled) return { outcome: "REJECTED", reasons: ["NETWORK_DISABLED"] };
    const preliminary: ValidatorRejectionCode[] = [];
    if (configuration.networkType !== attestation.sourceNetworkType) preliminary.push("NETWORK_MISMATCH");
    if (configuration.allowedPolicyVersions && !configuration.allowedPolicyVersions.includes(attestation.policyVersion)) preliminary.push("POLICY_NOT_ALLOWED");
    const expectedSourceAsset = configuration.sourceAssets[attestation.assetId];
    if (!expectedSourceAsset) preliminary.push("SOURCE_ASSET_MISMATCH");
    const now = this.now().getTime();
    if (now < Date.parse(attestation.validFrom)) preliminary.push("NOT_YET_VALID");
    if (now >= Date.parse(attestation.expiresAt)) preliminary.push("EXPIRED");
    if (preliminary.length) return { outcome: "REJECTED", reasons: preliminary };

    let observation: IndependentSourceObservation | undefined;
    try {
      let provider = this.#providers.get(configuration.networkId);
      if (!provider) { provider = this.providerFactory.create(structuredClone(configuration)); this.#providers.set(configuration.networkId, provider); }
      observation = await provider.observe({ sourceTransactionId: attestation.sourceTransactionId, sourceEventPosition: attestation.sourceEventPosition, expectedSourceAsset: structuredClone(expectedSourceAsset!) });
    } catch { return { outcome: "REJECTED", reasons: ["PROVIDER_ERROR"] }; }
    if (!observation) return { outcome: "REJECTED", reasons: ["SOURCE_NOT_FOUND"] };

    const reasons: ValidatorRejectionCode[] = [];
    if (observation.networkId !== attestation.sourceNetworkId || observation.networkType !== attestation.sourceNetworkType) reasons.push("NETWORK_MISMATCH");
    if (observation.transactionId !== attestation.sourceTransactionId || observation.transactionStatus !== "SUCCEEDED") reasons.push("TRANSACTION_FAILED");
    if (!observation.canonical) reasons.push("EVENT_NOT_CANONICAL");
    if (!sameLocator(observation.sourceAsset, expectedSourceAsset!)) reasons.push("SOURCE_ASSET_MISMATCH");
    if (observation.eventPosition !== attestation.sourceEventPosition || observation.eventType !== attestation.eventType) reasons.push("EVENT_MISMATCH");
    if (observation.assetId !== attestation.assetId) reasons.push("ASSET_MISMATCH");
    if (observation.operationId !== attestation.operationId) reasons.push("OPERATION_MISMATCH");
    if (observation.amount !== attestation.amount) reasons.push("AMOUNT_MISMATCH");
    if (observation.sender !== attestation.sender) reasons.push("SENDER_MISMATCH");
    if (observation.receiver !== attestation.receiver) reasons.push("RECEIVER_MISMATCH");
    if (!observation.finalitySatisfied || observation.finalityEvidence.length === 0) reasons.push("FINALITY_NOT_SATISFIED");
    if (observation.observedStatePosition !== attestation.observedStatePosition) reasons.push("OBSERVED_POSITION_MISMATCH");
    if (observation.observedAt !== attestation.observedAt) reasons.push("OBSERVATION_TIME_MISMATCH");
    if (reasons.length) return { outcome: "REJECTED", reasons, evidence: structuredClone(observation) };

    const signature = await signAttestation(attestation, this.signer, this.now().toISOString());
    return { outcome: "SIGNED", validatorId: this.signer.validatorId, digest: attestationDigest(attestation), signature, evidence: structuredClone(observation) };
  }
}

function sameLocator(left: SourceAssetLocator, right: SourceAssetLocator): boolean {
  return left.kind === right.kind && (left.kind === "EVM_CONTRACT" ? left.value.toLowerCase() === right.value.toLowerCase() : left.value === right.value);
}
