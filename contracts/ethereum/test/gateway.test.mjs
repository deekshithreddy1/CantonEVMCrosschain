import assert from "node:assert/strict";
import test from "node:test";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, NonceManager, Wallet, id, keccak256, toUtf8Bytes } from "ethers";
import { compileContracts } from "../../../scripts/compile-contracts.mjs";

const compiled = compileContracts();
function artifact(file, name) { const value = compiled[file]?.[name]; if (!value) throw new Error(`missing artifact ${file}:${name}`); return value; }
async function deploy(signer, file, name, args = []) { const value = artifact(file, name); const contract = await new ContractFactory(value.abi, `0x${value.evm.bytecode.object}`, signer).deploy(...args); await contract.waitForDeployment(); return contract; }

test("gateway requires threshold signatures, separates effects, prevents replay, and obeys pause", async () => {
  const local = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 8 }, chain: { chainId: 31337 } });
  const provider = new BrowserProvider(local); const accounts = local.getInitialAccounts();
  const wallets = Object.values(accounts).map((account) => new Wallet(account.secretKey, provider));
  const [admin, validatorAdmin, registryAdmin, pauser, receiver, validatorOne, validatorTwo, outsider] = wallets;
  const deployer = new NonceManager(admin);
  const validators = [validatorOne.address, validatorTwo.address];
  const verifier = await deploy(deployer, "contracts/ethereum/AttestationVerifier.sol", "AttestationVerifier", [admin.address, validatorAdmin.address, validators, 2]);
  const registry = await deploy(deployer, "contracts/ethereum/InterWeaveAssetRegistry.sol", "InterWeaveAssetRegistry", [admin.address, registryAdmin.address]);
  const gateway = await deploy(deployer, "contracts/ethereum/InterWeaveGateway.sol", "InterWeaveGateway", [admin.address, pauser.address, await verifier.getAddress(), await registry.getAddress()]);
  const representation = await deploy(deployer, "contracts/ethereum/InterWeaveRepresentation.sol", "InterWeaveRepresentation", ["InterWeave USD", "iwUSD", 6, admin.address, await gateway.getAddress()]);
  const underlying = await deploy(deployer, "contracts/ethereum/test/MockERC20.sol", "MockERC20");
  const representationAddress = await representation.getAddress();
  const underlyingAddress = await underlying.getAddress();
  const assetId = id("IW:ASSET:usd"); await (await registry.connect(registryAdmin).configure(assetId, representationAddress, underlyingAddress, true)).wait();
  await assert.rejects(() => registry.connect(outsider).configure(assetId, representationAddress, outsider.address, true));

  const attestationDigest = keccak256(toUtf8Bytes("canonical-attestation-v1")); const operationId = id("IW:BRIDGE:op-1"); const amount = 100_000_000n;
  const validFrom = 0; const expiresAt = 281474976710655n;
  const digest = await verifier.executionDigest(attestationDigest, operationId, 1, assetId, receiver.address, amount, validFrom, expiresAt);
  const signed = validators.map((address) => ({ address, signature: (address === validatorOne.address ? validatorOne : validatorTwo).signingKey.sign(digest).serialized })).sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
  await (await gateway.executeMint(attestationDigest, operationId, assetId, receiver.address, amount, validFrom, expiresAt, signed.map((item) => item.signature))).wait();
  assert.equal(await representation.balanceOf(receiver.address), amount); assert.equal(await gateway.isOperationProcessed(operationId, 1), true);
  await assert.rejects(() => gateway.executeMint(attestationDigest, operationId, assetId, receiver.address, amount, validFrom, expiresAt, signed.map((item) => item.signature)));

  const burnOperation = id("IW:BRIDGE:burn-1"); const burnAmount = 40_000_000n;
  await (await gateway.connect(receiver).burnRepresentation(burnOperation, assetId, burnAmount, id("Alice::Canton"))).wait();
  assert.equal(await representation.balanceOf(receiver.address), amount - burnAmount); assert.equal(await gateway.isOperationProcessed(burnOperation, 3), true);
  await assert.rejects(() => gateway.connect(receiver).burnRepresentation(burnOperation, assetId, burnAmount, id("Alice::Canton")));

  const unlockedAdmin = await provider.getSigner(admin.address);
  await (await underlying.connect(unlockedAdmin).mint(await gateway.getAddress(), amount)).wait();
  const releaseOperation = id("IW:BRIDGE:release-1"); const releaseDigest = await verifier.executionDigest(attestationDigest, releaseOperation, 2, assetId, receiver.address, burnAmount, validFrom, expiresAt);
  const releaseSignatures = [validatorOne, validatorTwo].map((wallet) => ({ address: wallet.address, signature: wallet.signingKey.sign(releaseDigest).serialized })).sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map((item) => item.signature);
  await (await gateway.executeRelease(attestationDigest, releaseOperation, assetId, receiver.address, burnAmount, validFrom, expiresAt, releaseSignatures)).wait();
  assert.equal(await underlying.balanceOf(receiver.address), burnAmount); assert.equal(await underlying.balanceOf(await gateway.getAddress()), amount - burnAmount); assert.equal(await representation.balanceOf(receiver.address), amount - burnAmount); assert.equal(await gateway.isOperationProcessed(releaseOperation, 2), true);

  const otherOperation = id("IW:BRIDGE:op-2"); const mintDigest = await verifier.executionDigest(attestationDigest, otherOperation, 1, assetId, receiver.address, amount, validFrom, expiresAt);
  const wrongEffectSignatures = [validatorOne, validatorTwo].map((wallet) => ({ address: wallet.address, signature: wallet.signingKey.sign(mintDigest).serialized })).sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map((item) => item.signature);
  await assert.rejects(() => gateway.executeRelease(attestationDigest, otherOperation, assetId, receiver.address, amount, validFrom, expiresAt, wrongEffectSignatures));

  await (await gateway.connect(pauser).pause()).wait();
  const pausedOperation = id("IW:BRIDGE:op-3"); const pausedDigest = await verifier.executionDigest(attestationDigest, pausedOperation, 1, assetId, receiver.address, amount, validFrom, expiresAt);
  const pausedSignatures = [validatorOne, validatorTwo].map((wallet) => ({ address: wallet.address, signature: wallet.signingKey.sign(pausedDigest).serialized })).sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map((item) => item.signature);
  await assert.rejects(() => gateway.executeMint(attestationDigest, pausedOperation, assetId, receiver.address, amount, validFrom, expiresAt, pausedSignatures));
  await assert.rejects(() => gateway.connect(outsider).unpause());
});

test("verifier rejects insufficient, duplicate, disabled, and wrong-chain/domain signatures", async () => {
  const local = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 6 }, chain: { chainId: 31337 } });
  const provider = new BrowserProvider(local); const accounts = local.getInitialAccounts(); const wallets = Object.values(accounts).map((account) => new Wallet(account.secretKey, provider));
  const [admin, validatorAdmin, v1, v2] = wallets;
  const verifier = await deploy(admin, "contracts/ethereum/AttestationVerifier.sol", "AttestationVerifier", [admin.address, validatorAdmin.address, [v1.address, v2.address], 2]);
  const values = [id("att"), id("op"), 1, id("asset"), admin.address, 10n, 0, 281474976710655n]; const digest = await verifier.executionDigest(...values);
  const sig1 = v1.signingKey.sign(digest).serialized; const sig2 = v2.signingKey.sign(digest).serialized;
  await assert.rejects(() => verifier.verify(...values, [sig1]));
  await assert.rejects(() => verifier.verify(...values, [sig1, sig1]));
  await (await verifier.connect(validatorAdmin).setValidator(v2.address, false)).wait();
  const sorted = [{ address: v1.address, signature: sig1 }, { address: v2.address, signature: sig2 }].sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
  await assert.rejects(() => verifier.verify(...values, sorted.map((item) => item.signature)));
});

test("fuzz: unique operations mint exact amounts once and all replay attempts revert", async () => {
  const local = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 6 }, chain: { chainId: 31337 } });
  const provider = new BrowserProvider(local); const accounts = local.getInitialAccounts(); const wallets = Object.values(accounts).map((account) => new Wallet(account.secretKey, provider));
  const [admin, validatorAdmin, registryAdmin, pauser, receiver, v1] = wallets; const deployer = new NonceManager(admin);
  const verifier = await deploy(deployer, "contracts/ethereum/AttestationVerifier.sol", "AttestationVerifier", [admin.address, validatorAdmin.address, [v1.address], 1]);
  const registry = await deploy(deployer, "contracts/ethereum/InterWeaveAssetRegistry.sol", "InterWeaveAssetRegistry", [admin.address, registryAdmin.address]);
  const gateway = await deploy(deployer, "contracts/ethereum/InterWeaveGateway.sol", "InterWeaveGateway", [admin.address, pauser.address, await verifier.getAddress(), await registry.getAddress()]);
  const representation = await deploy(deployer, "contracts/ethereum/InterWeaveRepresentation.sol", "InterWeaveRepresentation", ["Fuzz RWA", "fRWA", 18, admin.address, await gateway.getAddress()]);
  const assetId = id("IW:ASSET:fuzz"); await (await registry.connect(registryAdmin).configure(assetId, await representation.getAddress(), "0x0000000000000000000000000000000000000000", true)).wait();
  const caller = await provider.getSigner(admin.address); const executableGateway = gateway.connect(caller);
  let seed = 0x12345678, expected = 0n; const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let index = 0; index < 16; index++) {
    const amount = BigInt((next() % 1_000_000) + 1), operationId = id(`IW:BRIDGE:fuzz-${index}`), attestation = id(`attestation-${next()}`), expires = 281474976710655n;
    const digest = await verifier.executionDigest(attestation, operationId, 1, assetId, receiver.address, amount, 0, expires); const signature = v1.signingKey.sign(digest).serialized;
    await (await executableGateway.executeMint(attestation, operationId, assetId, receiver.address, amount, 0, expires, [signature])).wait(); expected += amount;
    await assert.rejects(() => executableGateway.executeMint(attestation, operationId, assetId, receiver.address, amount, 0, expires, [signature]));
    assert.equal(await representation.balanceOf(receiver.address), expected);
  }
});
