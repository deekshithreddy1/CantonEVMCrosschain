# InterWeave

InterWeave is a network-neutral control plane for durable, attested workflows between Canton and EVM networks. It does **not** claim cross-network atomicity.

This repository contains the Phase 0–1 foundation through the Phase 18 round-trip orchestration slices. Durable coordinators cover evidenced Canton→EVM lock/mint and EVM→Canton burn/release, independent threshold attestations, replay protection, finality, and reconciliation. Live two-network deployment remains explicitly incomplete.

## Verify

```bash
npm install
npm run check
npm test
```

See [the architecture](docs/architecture/overview.md), [domain model](docs/protocol/domain-model.md), and [MVP acceptance criteria](docs/mvp-acceptance-criteria.md).
