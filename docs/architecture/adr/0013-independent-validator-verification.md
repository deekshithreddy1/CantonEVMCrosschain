# ADR 0013: Independent validator source verification

Status: Accepted (Phase 12)

## Decision

Validators own their source-network endpoint and logical-asset-to-representation configuration and obtain observations through an `IndependentSourceProvider`. A coordinator candidate supplies only the proposed attestation. It cannot select the trusted contract/instrument or supply the observation that is used as evidence.

Before signing, the validator checks the configured network and policy, validity window, transaction existence and success, canonical event status, expected contract or Canton instrument, event and position, logical asset, operation ID, exact amount, sender, receiver, observed state position, and explicit finality evidence. Any missing evidence, provider error, mismatch, disabled network, or empty finality proof fails closed. Rejections do not invoke the signer.

EVM providers must cross-check the transaction, successful receipt, log address/data, block membership, configured chain ID, and the configured finality rule. Canton providers must query through an independently authorized participant connection and can only attest facts visible to their explicit party scope. Absence from a party-scoped Canton view is not proof of global absence.

## Primary-source basis

- Ethereum JSON-RPC distinguishes transactions, receipts (including execution status), logs, blocks, and `safe`/`finalized` block tags.
- Canton Ledger APIs expose update streams and update lookup by offset under authenticated, party-scoped visibility.

## Consequences

The core package defines and tests the verification policy and provider boundary, not production RPC credentials or network clients. Deployments must configure endpoints independently from the coordinator, protect signer custody, retain returned evidence, and implement provider-specific finality checks. Threshold aggregation and validator membership/rotation begin in Phase 13.
