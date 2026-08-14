import path from "node:path";
import { JsonRpcProvider, Wallet } from "ethers";
import { assertNonProductionChain, loadTarget, redactUrl } from "./deployment-policy.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evm = await loadTarget(path.join(root, "config/testnet/sepolia.json"));
const canton = await loadTarget(path.join(root, "config/testnet/canton-devnet.json"));
const report = { evm: { target: evm.name, configured: false }, canton: { target: canton.name, configured: false }, safeToAutoPromote: false };
if (process.env.SEPOLIA_RPC_URL) {
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL); const network = await provider.getNetwork(); assertNonProductionChain(network.chainId);
  if (network.chainId !== BigInt(evm.chainId)) throw new Error(`wrong EVM chain: expected ${evm.chainId}, received ${network.chainId}`);
  const address = process.env.TESTNET_DEPLOYER_PRIVATE_KEY ? new Wallet(process.env.TESTNET_DEPLOYER_PRIVATE_KEY).address : undefined;
  report.evm = { target: evm.name, configured: true, rpc: redactUrl(process.env.SEPOLIA_RPC_URL), chainId: network.chainId.toString(), ...(address ? { deployer: address, balance: (await provider.getBalance(address)).toString() } : {}) };
}
if (process.env.CANTON_DEVNET_LEDGER_URL && process.env.CANTON_DEVNET_ACCESS_TOKEN) report.canton = { target: canton.name, configured: true, ledgerUrl: redactUrl(process.env.CANTON_DEVNET_LEDGER_URL), sponsoredValidator: true };
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--require-ready") && (!report.evm.configured || !report.canton.configured || !process.env.TESTNET_DEPLOYER_PRIVATE_KEY)) throw new Error("testnet access is incomplete; configure funded Sepolia and sponsored Canton DevNet credentials");
