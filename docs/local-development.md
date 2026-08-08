# Local-development strategy

Target one-command environment: Docker Compose starts PostgreSQL, NATS JetStream, API/coordinator, validators, independent reconciler, EVM indexer, Canton indexer, Anvil, and a supported Canton local participant/sandbox.

Bootstrap must deploy pinned Daml packages and EVM contracts, create parties/accounts, register one logical asset, issue test backing, and fund EVM accounts. Development signers and 1-of-1 attestations must be visibly marked and impossible to enable in production profiles. Test/staging uses at least 2-of-3 independent validator configurations.

Phase 1 stays dependency-light and runs model checks directly on Node. Later Compose images will be pinned by digest, health-checked, and initialized idempotently. The golden-path test owns its tenant namespace and operation IDs so it can be safely rerun.
