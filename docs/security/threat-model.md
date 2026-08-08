# Threat-model outline

Detailed reviews will use: asset at risk, preconditions, attack, detection, preventive controls, containment, recovery, and residual risk.

| Threat | Primary preventive boundary | Detection / recovery direction |
|---|---|---|
| Coordinator compromise | Threshold verification and destination replay state | Audit divergence; pause affected direction |
| Validator compromise | Independent providers, membership and configurable threshold | Disagreement metrics; rotate/disable validator |
| Threshold compromise | HSM/MPC direction, domain separation, short validity | Emergency pause; rotate set; investigate issuance |
| Signer/admin compromise | Split roles, least privilege, delayed/multi-party admin | Privileged-action alerts; revoke and rotate |
| RPC compromise or reorg | Provider diversity and explicit finality evidence | Conflicting observations; manual review/reconcile |
| Database/indexer failure | Ledger operation IDs, checkpoints, idempotent consumers | Replay from checkpoint; reconcile before resume |
| Event/attestation replay | Immutable operation IDs, nonce, destination replay map | Duplicate telemetry; reject without effect |
| Malicious token | Capability probing and allowlisting | Adapter errors; pause asset |
| Canton package upgrade | Package/interface resolution boundary | Compatibility tests; pin/approve package mapping |
| Privacy/tenant failure | Party-scoped reads, tenant predicates and minimal data | Access audit; revoke credentials and notify |
| Denial of service | Queues, quotas, backpressure and expiry | Lag/stuck metrics; safe retry |
| Insider threat | Separation of duties and immutable audit | Review/admin alerts; revoke and reconstruct |

Open items for later phases include quantitative quorum assumptions, key ceremonies, data-retention classification, concrete RLS policy, chain-specific reorg budgets, and incident runbooks.
