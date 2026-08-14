# Docker development runtime

The root [`docker-compose.yml`](../../docker-compose.yml) is the Phase 34 one-command local environment. The shared root Dockerfile builds the InterWeave TypeScript workspace, while `scripts/local/service.mjs` exposes distinct health-checked API, coordinator, validator, and reconciler processes.

See [`docs/local-development.md`](../../docs/local-development.md) for startup, endpoints, bootstrap behavior, and reset instructions.
