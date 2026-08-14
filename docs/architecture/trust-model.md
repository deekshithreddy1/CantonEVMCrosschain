# Trust model

InterWeave does not merge Canton and EVM consensus and cannot provide cross-network atomicity.

Trusted components are narrowly scoped: source ledgers establish their own finalized state; destination ledgers execute their own authorization rules; a configured validator threshold attests independently observed facts; issuers remain trusted for asset-specific controls and, for private Canton holdings, supply reporting permitted by the token standard.

The coordinator is trusted for liveness and ordering, not truth. A compromised coordinator must be unable to mint/release without threshold signatures or replay an operation. A single RPC endpoint is not authoritative. PostgreSQL loss may interrupt progress but ledger operation IDs and reconciliation must prevent duplicate financial effects after recovery.

Privacy is authorization, not obscurity. Canton visibility depends on hosted parties and contract stakeholders. InterWeave stores only identifiers and evidence necessary for operations; KYC data remains in the responsible identity/compliance system.

Execution guarantees exposed to clients are `NETWORK_NATIVE_ATOMIC` or `CROSS_NETWORK_SAGA`. Timeouts do not imply rollback. Compensation is allowed only when its safety is demonstrated; otherwise operations enter manual review.

## What integrators must trust

Integrators trust their source and destination ledgers for their own finalized state, the configured validator threshold for cross-network factual attestations, asset governance for registration and limits, and their hosted Canton party/provider configuration for complete authorized visibility. They do not need to trust the coordinator to invent facts or repeat effects successfully. A threshold compromise, catastrophic ledger-finality failure, unsafe governance quorum, or incorrect asset integration remains capable of loss; these risks cannot be removed by marketing claims or ordinary retries.

Integrators should independently monitor destination supply, source backing, validator-set/configuration changes, emergency status, and reconciliation freshness. Deployment topology, quorum assumptions, finality policies, limits, audit reports, and incident contacts must be disclosed before production onboarding.
