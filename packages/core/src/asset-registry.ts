import type { Asset, AssetCapability, AssetId, AssetRepresentation, CapabilityEvidence, NetworkId, RepresentationId } from "./model.js";
import type { NetworkRegistry } from "./network-registry.js";
import { RegistryError } from "./registry-errors.js";

export interface CapabilityDiscoverer {
  discover(representation: AssetRepresentation): Promise<readonly CapabilityEvidence[]>;
}

export interface AssetRegistry {
  registerAsset(asset: Asset): Promise<Asset>;
  getAsset(id: AssetId): Promise<Asset | undefined>;
  listAssets(status?: Asset["status"]): Promise<readonly Asset[]>;
  registerRepresentation(representation: AssetRepresentation): Promise<AssetRepresentation>;
  getRepresentation(id: RepresentationId): Promise<AssetRepresentation | undefined>;
  listRepresentations(assetId: AssetId, networkId?: NetworkId): Promise<readonly AssetRepresentation[]>;
  discoverCapabilities(id: RepresentationId): Promise<readonly CapabilityEvidence[]>;
  effectiveCapabilities(assetId: AssetId, representationId: RepresentationId): Promise<readonly AssetCapability[]>;
}

export class InMemoryAssetRegistry implements AssetRegistry {
  readonly #assets = new Map<AssetId, Asset>();
  readonly #representations = new Map<RepresentationId, AssetRepresentation>();
  readonly #evidence = new Map<RepresentationId, readonly CapabilityEvidence[]>();
  readonly #networks: NetworkRegistry;
  readonly #discoverer: CapabilityDiscoverer;
  constructor(networks: NetworkRegistry, discoverer: CapabilityDiscoverer) {
    this.#networks = networks;
    this.#discoverer = discoverer;
  }

  async registerAsset(asset: Asset): Promise<Asset> {
    if (!asset.id.startsWith("IW:ASSET:") || asset.id.length === "IW:ASSET:".length) throw new RegistryError("INVALID_ARGUMENT", "invalid asset ID");
    if (asset.name.trim() === "" || asset.symbol.trim() === "") throw new RegistryError("INVALID_ARGUMENT", "asset name and symbol are required");
    if (!Number.isSafeInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255) throw new RegistryError("INVALID_ARGUMENT", "asset decimals must be an integer from 0 to 255");
    if (new Set(asset.capabilities).size !== asset.capabilities.length) throw new RegistryError("INVALID_ARGUMENT", "asset capabilities must be unique");
    if (asset.canonicalNetworkId && !await this.#networks.get(asset.canonicalNetworkId)) throw new RegistryError("NOT_FOUND", `canonical network not found: ${asset.canonicalNetworkId}`);
    if (this.#assets.has(asset.id)) throw new RegistryError("ALREADY_EXISTS", `asset already exists: ${asset.id}`);
    const stored = structuredClone(asset); this.#assets.set(asset.id, stored); return structuredClone(stored);
  }

  async getAsset(id: AssetId): Promise<Asset | undefined> { const value = this.#assets.get(id); return value ? structuredClone(value) : undefined; }
  async listAssets(status?: Asset["status"]): Promise<readonly Asset[]> { return [...this.#assets.values()].filter((asset) => status === undefined || asset.status === status).map((asset) => structuredClone(asset)); }

  async registerRepresentation(representation: AssetRepresentation): Promise<AssetRepresentation> {
    if (!representation.id.startsWith("IW:REPRESENTATION:") || representation.id.length === "IW:REPRESENTATION:".length) throw new RegistryError("INVALID_ARGUMENT", "invalid representation ID");
    if (!this.#assets.has(representation.assetId)) throw new RegistryError("NOT_FOUND", `asset not found: ${representation.assetId}`);
    const network = await this.#networks.get(representation.networkId);
    if (!network) throw new RegistryError("NOT_FOUND", `network not found: ${representation.networkId}`);
    if (network.type !== representation.locator.kind) throw new RegistryError("INVALID_ARGUMENT", "representation locator does not match network type");
    if (representation.locator.kind === "EVM" && representation.locator.chainId !== network.chainId) throw new RegistryError("INVALID_ARGUMENT", "representation chain ID does not match network");
    if (this.#representations.has(representation.id)) throw new RegistryError("ALREADY_EXISTS", `representation already exists: ${representation.id}`);
    const stored = structuredClone(representation); this.#representations.set(representation.id, stored); return structuredClone(stored);
  }

  async getRepresentation(id: RepresentationId): Promise<AssetRepresentation | undefined> { const value = this.#representations.get(id); return value ? structuredClone(value) : undefined; }
  async listRepresentations(assetId: AssetId, networkId?: NetworkId): Promise<readonly AssetRepresentation[]> { return [...this.#representations.values()].filter((item) => item.assetId === assetId && (networkId === undefined || item.networkId === networkId)).map((item) => structuredClone(item)); }

  async discoverCapabilities(id: RepresentationId): Promise<readonly CapabilityEvidence[]> {
    const representation = this.#representations.get(id);
    if (!representation) throw new RegistryError("NOT_FOUND", `representation not found: ${id}`);
    const evidence = await this.#discoverer.discover(structuredClone(representation));
    const capabilities = evidence.map((item) => item.capability);
    if (new Set(capabilities).size !== capabilities.length) throw new RegistryError("INVALID_ARGUMENT", "discoverer returned duplicate capability evidence");
    const updated = { ...representation, discoveredCapabilities: capabilities };
    this.#representations.set(id, updated); this.#evidence.set(id, structuredClone(evidence));
    return structuredClone(evidence);
  }

  async effectiveCapabilities(assetId: AssetId, representationId: RepresentationId): Promise<readonly AssetCapability[]> {
    const asset = this.#assets.get(assetId); const representation = this.#representations.get(representationId);
    if (!asset) throw new RegistryError("NOT_FOUND", `asset not found: ${assetId}`);
    if (!representation || representation.assetId !== assetId) throw new RegistryError("NOT_FOUND", `representation not found for asset: ${representationId}`);
    if (!representation.enabled || asset.status !== "ACTIVE" || !this.#evidence.has(representationId)) return [];
    const discovered = new Set(representation.discoveredCapabilities);
    return asset.capabilities.filter((capability) => discovered.has(capability));
  }
}
