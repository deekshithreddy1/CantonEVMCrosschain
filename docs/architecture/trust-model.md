# Trust model

InterWeave does not merge Canton and EVM consensus and cannot provide cross-network atomicity.

Trusted components are narrowly scoped: source ledgers establish their own finalized state; destination ledgers execute their own authorization rules; a configured validator threshold attests independently observed facts; issuers remain trusted for asset-specific controls and, for private Canton holdings, supply reporting permitted by the token standard.

The coordinator is trusted for liveness and ordering, not truth. A compromised coordinator must be unable to mint/release without threshold signatures or replay an operation. A single RPC endpoint is not authoritative. PostgreSQL loss may interrupt progress but ledger operation IDs and reconciliation must prevent duplicate financial effects after recovery.

Privacy is authorization, not obscurity. Canton visibility depends on hosted parties and contract stakeholders. InterWeave stores only identifiers and evidence necessary for operations; KYC data remains in the responsible identity/compliance system.

Execution guarantees exposed to clients are `NETWORK_NATIVE_ATOMIC` or `CROSS_NETWORK_SAGA`. Timeouts do not imply rollback. Compensation is allowed only when its safety is demonstrated; otherwise operations enter manual review.
