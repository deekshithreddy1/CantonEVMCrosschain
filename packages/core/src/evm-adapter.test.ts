import assert from "node:assert/strict";
import test from "node:test";
import { ERC20Adapter, EvmAdapterClient } from "./evm-adapter.js";
import type { Erc20Gateway, EvmHash, EvmTransport, PreparedEvmTransaction } from "./evm-adapter.js";

const account = "0x0000000000000000000000000000000000000001" as const;
const recipient = "0x0000000000000000000000000000000000000002" as const;
const contract = "0x0000000000000000000000000000000000000003" as const;
const hash = `0x${"1".repeat(64)}` as EvmHash;
const transaction: PreparedEvmTransaction = { chainId: "11155111", from: account, to: recipient, data: "0x", value: 0n };

function transport(chainId = "11155111"): EvmTransport {
  const receipt = { transactionHash: hash, blockHash: hash, blockNumber: 10n, from: account, to: recipient, status: "SUCCESS" as const, logs: [] };
  return {
    connect: async () => ({ chainId, clientVersion: "test", connectedAt: "2026-08-08T00:00:00.000Z" }), health: async () => ({ status: "HEALTHY", chainId, checkedAt: "2026-08-08T00:00:00.000Z", details: {} }),
    getChainId: async () => chainId, getBlock: async () => undefined, getTransaction: async () => undefined, getReceipt: async () => receipt,
    getBalance: async () => 9n, callContract: async () => "0x", estimateAndPrepare: async (value) => value, submitTransaction: async () => hash,
    waitForConfirmation: async (_hash, confirmations) => ({ receipt, confirmations, observedHead: 10n + BigInt(confirmations) - 1n, observedAt: "2026-08-08T00:00:00.000Z" }),
    waitForFinalizedTag: async () => ({ receipt, kind: "FINALIZED_TAG", observedBlock: 10n, observedAt: "2026-08-08T00:00:00.000Z" }),
    subscribeLogs: () => (async function* () {})()
  };
}

test("EVM adapter rejects provider and transaction chain mismatch", async () => {
  const wrongProvider = new EvmAdapterClient(transport("1"), "11155111");
  await assert.rejects(() => wrongProvider.connect(), /does not match/);
  const adapter = new EvmAdapterClient(transport(), "11155111"); await adapter.connect();
  assert.throws(() => adapter.submitTransaction({ ...transaction, chainId: "1" }), /chain ID/);
});

test("confirmation and finalized-tag evidence remain distinct", async () => {
  const adapter = new EvmAdapterClient(transport(), "11155111"); await adapter.connect();
  assert.equal((await adapter.waitForFinality(hash, { kind: "CONFIRMATIONS", confirmations: 12 })).kind, "CONFIRMATIONS");
  assert.equal((await adapter.waitForFinality(hash, { kind: "FINALIZED_TAG" })).kind, "FINALIZED_TAG");
  assert.throws(() => adapter.waitForConfirmation(hash, 0), /positive/);
});

function gateway(simulation = true): Erc20Gateway {
  return {
    metadata: async () => ({ name: "Token", symbol: "TOK", decimals: 18 }), totalSupply: async () => 100n, balanceOf: async () => 40n, allowance: async () => 5n,
    simulateTransfer: async () => simulation, encodeTransfer: async () => ({ ...transaction, to: contract }), simulateApprove: async () => simulation, encodeApprove: async () => ({ ...transaction, to: contract }),
    parse: () => undefined
  };
}

test("ERC-20 supports exact reads and refuses a false transfer result", async () => {
  const token = new ERC20Adapter(contract, "11155111", gateway());
  assert.equal(await token.totalSupply(), "100"); assert.equal(await token.balanceOf(account), "40"); assert.equal(await token.allowance(account, recipient), "5");
  assert.equal((await token.prepareTransfer({ from: account, to: recipient, amount: "0" })).to, contract);
  const refusingToken = new ERC20Adapter(contract, "11155111", gateway(false));
  await assert.rejects(() => refusingToken.prepareTransfer({ from: account, to: recipient, amount: "1" }), /returned false/);
});
