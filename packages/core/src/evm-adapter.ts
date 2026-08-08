import type { AssetCapability, AtomicAmount, IsoTimestamp } from "./model.js";
import { parseAtomicAmount } from "./invariants.js";

export type EvmAddress = `0x${string}`;
export type EvmHash = `0x${string}`;
export type EvmBlockTag = "latest" | "safe" | "finalized" | "pending" | "earliest" | bigint;

export interface EvmConnection { chainId: string; clientVersion: string; connectedAt: IsoTimestamp }
export interface EvmHealth { status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE"; chainId?: string; latestBlock?: bigint; checkedAt: IsoTimestamp; details: Readonly<Record<string, string>> }
export interface EvmBlock { hash: EvmHash; number: bigint; parentHash: EvmHash; timestamp: bigint; transactionHashes: readonly EvmHash[] }
export interface EvmTransaction { hash: EvmHash; chainId?: string; from: EvmAddress; to?: EvmAddress; nonce: bigint; value: bigint; input: `0x${string}`; blockNumber?: bigint }
export interface EvmLog { address: EvmAddress; topics: readonly EvmHash[]; data: `0x${string}`; blockNumber: bigint; blockHash: EvmHash; transactionHash: EvmHash; logIndex: bigint; removed: boolean }
export interface EvmReceipt { transactionHash: EvmHash; blockHash: EvmHash; blockNumber: bigint; from: EvmAddress; to?: EvmAddress; status: "SUCCESS" | "REVERTED"; logs: readonly EvmLog[] }
export interface EvmCall { from?: EvmAddress; to: EvmAddress; data: `0x${string}`; value?: bigint }
export interface PreparedEvmTransaction extends EvmCall { chainId: string; nonce?: bigint; gasLimit?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
export interface EvmLogFilter { addresses?: readonly EvmAddress[]; topics?: readonly (EvmHash | null)[]; fromBlock?: EvmBlockTag }
export interface ParsedEvmEvent { name: string; signature: string; address: EvmAddress; arguments: Readonly<Record<string, unknown>>; log: EvmLog }
export interface EvmConfirmation { receipt: EvmReceipt; confirmations: number; observedHead: bigint; observedAt: IsoTimestamp }
export interface EvmFinality { receipt: EvmReceipt; kind: "FINALIZED_TAG" | "CONFIRMATIONS"; observedBlock: bigint; requiredConfirmations?: number; observedAt: IsoTimestamp }

export interface EvmTransport {
  connect(): Promise<EvmConnection>;
  health(): Promise<EvmHealth>;
  getChainId(): Promise<string>;
  getBlock(block: EvmBlockTag | EvmHash): Promise<EvmBlock | undefined>;
  getTransaction(hash: EvmHash): Promise<EvmTransaction | undefined>;
  getReceipt(hash: EvmHash): Promise<EvmReceipt | undefined>;
  getBalance(address: EvmAddress, block?: EvmBlockTag): Promise<bigint>;
  callContract(call: EvmCall, block?: EvmBlockTag): Promise<`0x${string}`>;
  estimateAndPrepare(transaction: PreparedEvmTransaction): Promise<PreparedEvmTransaction>;
  submitTransaction(transaction: PreparedEvmTransaction): Promise<EvmHash>;
  waitForConfirmation(hash: EvmHash, confirmations: number): Promise<EvmConfirmation>;
  waitForFinalizedTag(hash: EvmHash): Promise<EvmFinality>;
  subscribeLogs(filter: EvmLogFilter): AsyncIterable<EvmLog>;
}

export interface EvmEventParser { parse(log: EvmLog): ParsedEvmEvent | undefined }

export interface EvmAdapter {
  connect(): Promise<EvmConnection>;
  health(): Promise<EvmHealth>;
  getChainId(): Promise<string>;
  getBlock(block: EvmBlockTag | EvmHash): Promise<EvmBlock | undefined>;
  getTransaction(hash: EvmHash): Promise<EvmTransaction | undefined>;
  getReceipt(hash: EvmHash): Promise<EvmReceipt | undefined>;
  getBalance(address: EvmAddress, block?: EvmBlockTag): Promise<AtomicAmount>;
  callContract(call: EvmCall, block?: EvmBlockTag): Promise<`0x${string}`>;
  prepareTransaction(transaction: PreparedEvmTransaction): Promise<PreparedEvmTransaction>;
  submitTransaction(transaction: PreparedEvmTransaction): Promise<EvmHash>;
  waitForConfirmation(hash: EvmHash, confirmations: number): Promise<EvmConfirmation>;
  waitForFinality(hash: EvmHash, policy: { kind: "FINALIZED_TAG" } | { kind: "CONFIRMATIONS"; confirmations: number }): Promise<EvmFinality>;
  subscribeLogs(filter: EvmLogFilter): AsyncIterable<EvmLog>;
  parseEvent(log: EvmLog, parsers: readonly EvmEventParser[]): ParsedEvmEvent | undefined;
}

export function assertEvmAddress(address: string): asserts address is EvmAddress {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`invalid EVM address: ${address}`);
}
export function assertChainId(chainId: string): void {
  if (!/^[1-9][0-9]*$/.test(chainId)) throw new Error(`invalid EVM chain ID: ${chainId}`);
}

export class EvmAdapterClient implements EvmAdapter {
  #connection?: EvmConnection;
  constructor(readonly transport: EvmTransport, readonly expectedChainId: string) { assertChainId(expectedChainId); }
  async connect(): Promise<EvmConnection> {
    const connection = await this.transport.connect();
    if (connection.chainId !== this.expectedChainId) throw new Error(`connected chain ${connection.chainId} does not match configured chain ${this.expectedChainId}`);
    this.#connection = structuredClone(connection); return structuredClone(connection);
  }
  health(): Promise<EvmHealth> { return this.transport.health(); }
  async getChainId(): Promise<string> { const chainId = await this.transport.getChainId(); if (chainId !== this.expectedChainId) throw new Error("provider chain ID changed"); return chainId; }
  getBlock(block: EvmBlockTag | EvmHash): Promise<EvmBlock | undefined> { return this.transport.getBlock(block); }
  getTransaction(hash: EvmHash): Promise<EvmTransaction | undefined> { return this.transport.getTransaction(hash); }
  getReceipt(hash: EvmHash): Promise<EvmReceipt | undefined> { return this.transport.getReceipt(hash); }
  async getBalance(address: EvmAddress, block?: EvmBlockTag): Promise<AtomicAmount> { assertEvmAddress(address); return (await this.transport.getBalance(address, block)).toString(); }
  callContract(call: EvmCall, block?: EvmBlockTag): Promise<`0x${string}`> { assertEvmAddress(call.to); return this.transport.callContract(call, block); }
  prepareTransaction(transaction: PreparedEvmTransaction): Promise<PreparedEvmTransaction> { this.#assertConnected(); this.#assertTransaction(transaction); return this.transport.estimateAndPrepare(transaction); }
  submitTransaction(transaction: PreparedEvmTransaction): Promise<EvmHash> { this.#assertConnected(); this.#assertTransaction(transaction); return this.transport.submitTransaction(transaction); }
  waitForConfirmation(hash: EvmHash, confirmations: number): Promise<EvmConfirmation> { this.#assertConfirmations(confirmations); return this.transport.waitForConfirmation(hash, confirmations); }
  waitForFinality(hash: EvmHash, policy: { kind: "FINALIZED_TAG" } | { kind: "CONFIRMATIONS"; confirmations: number }): Promise<EvmFinality> {
    if (policy.kind === "FINALIZED_TAG") return this.transport.waitForFinalizedTag(hash);
    this.#assertConfirmations(policy.confirmations);
    return this.transport.waitForConfirmation(hash, policy.confirmations).then((result) => ({ receipt: result.receipt, kind: "CONFIRMATIONS", observedBlock: result.observedHead, requiredConfirmations: policy.confirmations, observedAt: result.observedAt }));
  }
  subscribeLogs(filter: EvmLogFilter): AsyncIterable<EvmLog> { return this.transport.subscribeLogs(filter); }
  parseEvent(log: EvmLog, parsers: readonly EvmEventParser[]): ParsedEvmEvent | undefined { for (const parser of parsers) { const event = parser.parse(log); if (event) return event; } return undefined; }
  #assertConnected(): void { if (!this.#connection) throw new Error("EVM adapter is not connected"); }
  #assertTransaction(transaction: PreparedEvmTransaction): void { if (transaction.chainId !== this.expectedChainId) throw new Error("transaction chain ID does not match configured chain"); assertEvmAddress(transaction.to); if (transaction.from) assertEvmAddress(transaction.from); }
  #assertConfirmations(value: number): void { if (!Number.isSafeInteger(value) || value < 1) throw new Error("confirmations must be a positive safe integer"); }
}

export interface EvmTokenAdapter { readonly standard: "ERC20" | "ERC721" | "ERC1155" | "ERC3643" | "ERC7943"; readonly contract: EvmAddress; discoverCapabilities(block?: EvmBlockTag): Promise<readonly AssetCapability[]> }
export interface Erc20Metadata { name?: string; symbol?: string; decimals?: number }
export interface Erc20Transfer { from: EvmAddress; to: EvmAddress; amount: AtomicAmount }

/** ABI-aware gateway. Implementations must decode boolean return values, including `false`. */
export interface Erc20Gateway extends EvmEventParser {
  metadata(contract: EvmAddress, block?: EvmBlockTag): Promise<Erc20Metadata>;
  totalSupply(contract: EvmAddress, block?: EvmBlockTag): Promise<bigint>;
  balanceOf(contract: EvmAddress, owner: EvmAddress, block?: EvmBlockTag): Promise<bigint>;
  allowance(contract: EvmAddress, owner: EvmAddress, spender: EvmAddress, block?: EvmBlockTag): Promise<bigint>;
  simulateTransfer(contract: EvmAddress, transfer: Erc20Transfer, block?: EvmBlockTag): Promise<boolean>;
  encodeTransfer(contract: EvmAddress, transfer: Erc20Transfer, chainId: string): Promise<PreparedEvmTransaction>;
  simulateApprove(contract: EvmAddress, owner: EvmAddress, spender: EvmAddress, amount: bigint, block?: EvmBlockTag): Promise<boolean>;
  encodeApprove(contract: EvmAddress, owner: EvmAddress, spender: EvmAddress, amount: bigint, chainId: string): Promise<PreparedEvmTransaction>;
}

export class ERC20Adapter implements EvmTokenAdapter, EvmEventParser {
  readonly standard = "ERC20" as const;
  constructor(readonly contract: EvmAddress, readonly chainId: string, readonly gateway: Erc20Gateway) { assertEvmAddress(contract); assertChainId(chainId); }
  metadata(block?: EvmBlockTag): Promise<Erc20Metadata> { return this.gateway.metadata(this.contract, block); }
  async totalSupply(block?: EvmBlockTag): Promise<AtomicAmount> { return (await this.gateway.totalSupply(this.contract, block)).toString(); }
  async balanceOf(owner: EvmAddress, block?: EvmBlockTag): Promise<AtomicAmount> { assertEvmAddress(owner); return (await this.gateway.balanceOf(this.contract, owner, block)).toString(); }
  async allowance(owner: EvmAddress, spender: EvmAddress, block?: EvmBlockTag): Promise<AtomicAmount> { assertEvmAddress(owner); assertEvmAddress(spender); return (await this.gateway.allowance(this.contract, owner, spender, block)).toString(); }
  async prepareTransfer(transfer: Erc20Transfer, block?: EvmBlockTag): Promise<PreparedEvmTransaction> {
    assertEvmAddress(transfer.from); assertEvmAddress(transfer.to); parseAtomicAmount(transfer.amount);
    if (!await this.gateway.simulateTransfer(this.contract, transfer, block)) throw new Error("ERC-20 transfer simulation returned false");
    return this.gateway.encodeTransfer(this.contract, transfer, this.chainId);
  }
  async prepareApprove(owner: EvmAddress, spender: EvmAddress, amount: AtomicAmount, block?: EvmBlockTag): Promise<PreparedEvmTransaction> {
    assertEvmAddress(owner); assertEvmAddress(spender); const parsed = parseAtomicAmount(amount);
    if (!await this.gateway.simulateApprove(this.contract, owner, spender, parsed, block)) throw new Error("ERC-20 approval simulation returned false");
    return this.gateway.encodeApprove(this.contract, owner, spender, parsed, this.chainId);
  }
  async discoverCapabilities(block?: EvmBlockTag): Promise<readonly AssetCapability[]> {
    await this.gateway.totalSupply(this.contract, block);
    return ["TRANSFER"];
  }
  parse(log: EvmLog): ParsedEvmEvent | undefined { return log.address.toLowerCase() === this.contract.toLowerCase() ? this.gateway.parse(log) : undefined; }
}

/** Compatibility contracts only; later phases must provide standard-specific behavior. */
export interface ERC721Adapter extends EvmTokenAdapter { readonly standard: "ERC721" }
export interface ERC1155Adapter extends EvmTokenAdapter { readonly standard: "ERC1155" }
export interface ERC3643Adapter extends EvmTokenAdapter { readonly standard: "ERC3643" }
export interface ERC7943Adapter extends EvmTokenAdapter { readonly standard: "ERC7943" }
