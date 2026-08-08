# ADR 0006: EVM adapter, chain binding, and finality evidence

Status: Accepted (Phase 5)

## Decision

The EVM adapter is bound to a configured decimal-string chain ID. Connection, preparation, and submission reject chain mismatch. Amounts leave the adapter as exact integer strings; transport internals use `bigint`. Provider and ABI-library details stay behind `EvmTransport` and token gateways.

Receipt success, confirmation depth, and finalized-block inclusion are distinct records. A receipt is execution evidence, not finality. `waitForFinality` requires an explicit confirmations policy or finalized-tag policy and returns the observation used. Reorg handling remains a transport obligation; removed logs are retained rather than discarded.

ERC-20 is the only complete token adapter in Phase 5. It implements metadata, total supply, balances, allowances, transfer and approval preparation, and event parsing through an ABI-aware gateway. Optional metadata remains optional. Transfer/approval simulation returning `false` is rejected, following ERC-20's requirement that callers handle false results. Zero-value transfer remains valid. ERC-721, ERC-1155, ERC-3643, and ERC-7943 are compatibility interfaces only and grant no capabilities.

## Primary-source basis

- Ethereum JSON-RPC defines transaction receipts and the `safe` and `finalized` block tags.
- ERC-20 defines exact methods/events, optional metadata, valid zero transfers, and the requirement to handle `false` return values.

## Consequences

Production transports must pin and cross-check providers according to network policy, implement polling/subscriptions with reorg recovery, validate RPC responses, and use audited ABI tooling. Phase 5 does not provide signing or custody and never stores private keys.
