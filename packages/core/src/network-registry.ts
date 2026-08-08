import type { Network, NetworkId } from "./model.js";
import { RegistryError } from "./registry-errors.js";

export interface NetworkRegistry {
  register(network: Network): Promise<Network>;
  get(id: NetworkId): Promise<Network | undefined>;
  list(filter?: { type?: string; environment?: string; enabled?: boolean }): Promise<readonly Network[]>;
  setEnabled(id: NetworkId, enabled: boolean): Promise<Network>;
}

export function assertNetworkConfiguration(network: Network): void {
  if (!network.id.startsWith("IW:NETWORK:") || network.id.length === "IW:NETWORK:".length) throw new RegistryError("INVALID_ARGUMENT", "invalid network ID");
  if (network.name.trim() === "") throw new RegistryError("INVALID_ARGUMENT", "network name is required");
  if (network.type.trim() === "") throw new RegistryError("INVALID_ARGUMENT", "network type is required");
  if (network.endpoints.length === 0) throw new RegistryError("INVALID_ARGUMENT", "at least one network endpoint is required");
  for (const endpoint of network.endpoints) {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new RegistryError("INVALID_ARGUMENT", `invalid endpoint: ${endpoint}`); }
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") throw new RegistryError("INVALID_ARGUMENT", `unsupported endpoint protocol: ${url.protocol}`);
    if (url.username || url.password) throw new RegistryError("INVALID_ARGUMENT", "endpoint credentials must not be stored in the registry");
  }
  if (network.type === "EVM" && (!network.chainId || !/^(0|[1-9][0-9]*)$/.test(network.chainId))) throw new RegistryError("INVALID_ARGUMENT", "EVM networks require a decimal chain ID");
  if (network.type === "CANTON" && network.chainId !== undefined) throw new RegistryError("INVALID_ARGUMENT", "Canton networks do not use an EVM chain ID");
  if (network.finalityPolicy.kind === "EVM_CONFIRMATIONS" && (!Number.isSafeInteger(network.finalityPolicy.confirmations) || network.finalityPolicy.confirmations < 0)) throw new RegistryError("INVALID_ARGUMENT", "confirmations must be a non-negative safe integer");
}

export class InMemoryNetworkRegistry implements NetworkRegistry {
  readonly #networks = new Map<NetworkId, Network>();

  async register(network: Network): Promise<Network> {
    assertNetworkConfiguration(network);
    if (this.#networks.has(network.id)) throw new RegistryError("ALREADY_EXISTS", `network already exists: ${network.id}`);
    if ([...this.#networks.values()].some((item) => item.type === "EVM" && network.type === "EVM" && item.chainId === network.chainId)) throw new RegistryError("CONFLICT", `EVM chain ID already registered: ${network.chainId}`);
    const stored = structuredClone(network);
    this.#networks.set(network.id, stored);
    return structuredClone(stored);
  }

  async get(id: NetworkId): Promise<Network | undefined> { const value = this.#networks.get(id); return value ? structuredClone(value) : undefined; }

  async list(filter: { type?: string; environment?: string; enabled?: boolean } = {}): Promise<readonly Network[]> {
    return [...this.#networks.values()].filter((network) =>
      (filter.type === undefined || network.type === filter.type) &&
      (filter.environment === undefined || network.environment === filter.environment) &&
      (filter.enabled === undefined || network.enabled === filter.enabled)
    ).map((network) => structuredClone(network));
  }

  async setEnabled(id: NetworkId, enabled: boolean): Promise<Network> {
    const existing = this.#networks.get(id);
    if (!existing) throw new RegistryError("NOT_FOUND", `network not found: ${id}`);
    const updated = { ...existing, enabled };
    this.#networks.set(id, updated);
    return structuredClone(updated);
  }
}
