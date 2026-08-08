# InterWeave

InterWeave is a network-neutral control plane for durable, attested workflows between Canton and EVM networks. It does **not** claim cross-network atomicity.

This repository currently contains the Phase 0–1 foundation requested by `Prompt.txt`: researched architecture and security boundaries, domain types and invariants, ADRs, an expandable monorepo skeleton, local-development strategy, and acceptance criteria.

## Verify

```bash
npm install
npm run check
npm test
```

See [the architecture](docs/architecture/overview.md), [domain model](docs/protocol/domain-model.md), and [MVP acceptance criteria](docs/mvp-acceptance-criteria.md).
