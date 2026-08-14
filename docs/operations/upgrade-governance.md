# Upgrade governance

Protocol, Solidity, DAML, validator-set, signer, policy, schema, and infrastructure upgrades use immutable versioned proposals. Each proposal records compatibility/security review, migration and rollback boundaries, testnet evidence, reconciliation plan, monitoring, approvers, and maintenance window.

At least two distinct authorized approvers are required for production. Solidity and DAML changes require their specialist review. Database migrations must be backward-compatible through the rollback window. Irreversible ledger/package changes require a forward-recovery plan because rollback may be impossible. Canary routes begin with low limits; automatic testnet-to-production promotion is prohibited.

After deployment, verify code/package/configuration identity, access roles, finality, alerts, golden path, and reconciliation. Any unexplained mismatch triggers emergency controls and the incident procedure.
