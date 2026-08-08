# InterWeave

InterWeave is a network-neutral control plane for durable, attested workflows between Canton and EVM networks. It does **not** claim cross-network atomicity.

This repository contains the Phase 0–1 foundation through the Phase 11 Attestation Protocol. Attestation v1 binds source observation, logical asset, parties, destination, operation, policy, validity, and nonce into canonical domain-separated bytes before signing.

## Verify

```bash
npm install
npm run check
npm test
```

See [the architecture](docs/architecture/overview.md), [domain model](docs/protocol/domain-model.md), and [MVP acceptance criteria](docs/mvp-acceptance-criteria.md).
