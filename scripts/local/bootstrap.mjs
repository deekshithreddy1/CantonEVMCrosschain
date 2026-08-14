import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Wallet, id } from "ethers";

const rpc = process.env.EVM_RPC_URL ?? "http://127.0.0.1:8545";
const output = process.env.BOOTSTRAP_OUTPUT ?? ".interweave/bootstrap.json";
const devKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function source(file) { return { content: await readFile(file, "utf8") }; }
async function compile() {
  const files = ["AttestationVerifier.sol", "InterWeaveAssetRegistry.sol", "InterWeaveGateway.sol", "InterWeaveRepresentation.sol", "IReplayProtectedExecutor.sol"];
  const sources = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await source(path.join("contracts/ethereum", file))])));
  const input = { language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
  const result = JSON.parse(solc.compile(JSON.stringify(input), { import: (name) => {
    try { return { contents: requireFile(name) }; } catch { return { error: `missing import ${name}` }; }
  }}));
  const errors = (result.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  return result.contracts;
}
function requireFile(name) {
  const normalized = name.startsWith("@") ? path.join("node_modules", name) : path.join("contracts/ethereum", name);
  return globalThis.process.getBuiltinModule("fs").readFileSync(normalized, "utf8");
}
async function deploy(contracts, file, name, signer, args) {
  const artifact = contracts[file][name];
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
async function main() {
  const provider = new JsonRpcProvider(rpc);
  try {
    const previous = JSON.parse(await readFile(output, "utf8"));
    const gatewayCode = await provider.getCode(previous?.evm?.contracts?.gateway ?? "0x0");
    if (gatewayCode !== "0x") {
      console.log(`local bootstrap already complete: ${output}`);
      return;
    }
  } catch { /* First run or a fresh Anvil chain. */ }
  const signer = new Wallet(devKey, provider);
  const contracts = await compile();
  const admin = signer.address;
  const verifier = await deploy(contracts, "AttestationVerifier.sol", "AttestationVerifier", signer, [admin, admin, [admin], 1]);
  const registry = await deploy(contracts, "InterWeaveAssetRegistry.sol", "InterWeaveAssetRegistry", signer, [admin, admin]);
  const gateway = await deploy(contracts, "InterWeaveGateway.sol", "InterWeaveGateway", signer, [admin, admin, await verifier.getAddress(), await registry.getAddress()]);
  const representation = await deploy(contracts, "InterWeaveRepresentation.sol", "InterWeaveRepresentation", signer, ["InterWeave Test RWA", "iwRWA", 18, admin, await gateway.getAddress()]);
  const assetId = id("INTERWEAVE_LOCAL_RWA_V1");
  await (await registry.configure(assetId, await representation.getAddress(), "0x0000000000000000000000000000000000000000", true)).wait();
  const state = { version: 1, environment: "local-only", canton: { parties: ["Alice", "InterWeaveOperator", "Validator"], package: "interweave-canton", issuedTestAssets: "1000" }, evm: { chainId: 31337, fundedAccount: admin, assetId, contracts: { verifier: await verifier.getAddress(), registry: await registry.getAddress(), gateway: await gateway.getAddress(), representation: await representation.getAddress() } } };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`local bootstrap complete: ${output}`);
}
if (process.argv.includes("--check")) {
  await compile();
  console.log("local EVM bootstrap contracts compile successfully");
} else {
  await main();
}
