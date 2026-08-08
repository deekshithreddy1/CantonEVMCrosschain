import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAssetRegistry } from "./asset-registry.js";
import type { Asset, AssetRepresentation, CapabilityEvidence, Network } from "./model.js";
import { InMemoryNetworkRegistry } from "./network-registry.js";

const evm: Network = { id: "IW:NETWORK:sepolia", type: "EVM", name: "Sepolia", environment: "TESTNET", endpoints: ["https://rpc.example.invalid"], chainId: "11155111", finalityPolicy: { kind: "EVM_CONFIRMATIONS", confirmations: 12, requireFinalizedTag: true }, adapterConfiguration: {}, enabled: true };
const asset: Asset = { id: "IW:ASSET:usd", name: "Test Dollar", symbol: "TUSD", issuerIdentityId: "IW:IDENTITY:issuer", decimals: 6, tokenType: "FUNGIBLE", canonicalNetworkId: evm.id, supplyModel: "ISSUER_MANAGED", bridgeModel: "LOCK_MINT_BURN_RELEASE", capabilities: ["TRANSFER", "MINT", "BURN"], metadata: {}, status: "ACTIVE", createdAt: "2026-08-08T00:00:00.000Z" };
const representation: AssetRepresentation = { id: "IW:REPRESENTATION:usd-sepolia", assetId: asset.id, networkId: evm.id, locator: { kind: "EVM", chainId: "11155111", contractAddress: "0x0000000000000000000000000000000000000001", tokenStandard: "ERC20" }, discoveredCapabilities: [], enabled: true };

test("network registry validates, isolates values, filters, and disables networks", async () => {
  const registry = new InMemoryNetworkRegistry();
  const registered = await registry.register(evm);
  (registered.adapterConfiguration as Record<string, unknown>).changed = true;
  assert.equal((await registry.get(evm.id))?.adapterConfiguration.changed, undefined);
  assert.equal((await registry.list({ type: "EVM", enabled: true })).length, 1);
  assert.equal((await registry.setEnabled(evm.id, false)).enabled, false);
  await assert.rejects(() => registry.register({ ...evm, id: "IW:NETWORK:duplicate" }), /chain ID already registered/);
  await assert.rejects(() => registry.register({ ...evm, id: "IW:NETWORK:secret", chainId: "2", endpoints: ["https://user:pass@example.invalid"] }), /credentials/);
});

test("asset capabilities require explicit discovery evidence and policy intersection", async () => {
  const networks = new InMemoryNetworkRegistry(); await networks.register(evm);
  const evidence: CapabilityEvidence[] = [
    { capability: "TRANSFER", source: "erc165-and-probe", observedAt: "2026-08-08T00:00:00.000Z", evidence: { block: "123" } },
    { capability: "FREEZE", source: "contract-probe", observedAt: "2026-08-08T00:00:00.000Z", evidence: { block: "123" } }
  ];
  const registry = new InMemoryAssetRegistry(networks, { discover: async () => evidence });
  await registry.registerAsset(asset); await registry.registerRepresentation(representation);
  assert.equal((await registry.effectiveCapabilities(asset.id, representation.id)).length, 0);
  await registry.discoverCapabilities(representation.id);
  assert.deepEqual(await registry.effectiveCapabilities(asset.id, representation.id), ["TRANSFER"]);
  assert.deepEqual((await registry.getRepresentation(representation.id))?.discoveredCapabilities, ["TRANSFER", "FREEZE"]);
});

test("representations must reference a matching registered network", async () => {
  const networks = new InMemoryNetworkRegistry(); await networks.register(evm);
  const registry = new InMemoryAssetRegistry(networks, { discover: async () => [] }); await registry.registerAsset(asset);
  await assert.rejects(() => registry.registerRepresentation({ ...representation, locator: { kind: "EVM", chainId: "1", contractAddress: "0x0000000000000000000000000000000000000001", tokenStandard: "ERC20" } }), /chain ID does not match/);
});
