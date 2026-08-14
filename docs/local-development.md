# Local development

Phase 34 provides a reproducible local topology for the InterWeave golden path. The only host prerequisites are Docker Engine with Compose v2 and enough memory for Canton Sandbox.

## Start everything

```bash
docker compose up --build
```

The stack starts PostgreSQL, NATS JetStream, three independent validator processes, the API, coordinator, reconciler, Anvil, and a Canton Sandbox/JSON API. Health checks gate dependent services, and the one-shot `bootstrap` container runs only after the complete topology is ready.

The Canton project builds and uploads automatically. Its initialization script allocates Alice, operator, and governance parties, registers the local RWA route, and issues 1,000 local test units to Alice. Anvil starts ten pre-funded development accounts. Bootstrap deploys the verifier, asset registry, gateway, and representation token; it then registers `INTERWEAVE_LOCAL_RWA_V1` and saves addresses in the `bootstrap-state` volume.

Useful endpoints:

| Component | Address |
| --- | --- |
| InterWeave API health | `http://localhost:8080/healthz` |
| Canton Ledger API | `localhost:6865` |
| Canton JSON API | `http://localhost:7575` |
| Anvil JSON-RPC | `http://localhost:8545` |
| PostgreSQL | `localhost:5432` |
| NATS | `localhost:4222` |

Inspect bootstrap completion with `docker compose logs bootstrap`. Re-running Compose is safe: database migrations, the Canton init script, and the EVM deployment are scoped to persistent named volumes.

Stop the environment with `docker compose down`. To deliberately erase all local ledger, database, broker, and deployment state, use `docker compose down --volumes`; this destroys local development data.

All keys, passwords, validator thresholds, accounts, and assets in this profile are public development fixtures. They must never be reused outside a local machine.

## Digital Asset Canton Network LocalNet

For validator-node integration, use the official [Digital Asset CN Quickstart](https://github.com/digital-asset/cn-quickstart) instead of treating `daml start` as a production-shaped validator. The pinned checkout lives under ignored `.local/cn-quickstart` and includes separate app-provider and app-user validators plus a Super Validator, Canton Coin, and supporting services.

Run `npm run canton-localnet:prepare`. It verifies the official remote and pinned commit, builds the InterWeave DAR, checks the launch prerequisites, and prints the exact setup/start commands. You control the interactive `make setup` and `make start`; no repository command starts or stops Docker automatically. Use Docker 27+ with Compose 2.27+, allocate at least 8 GB to Docker Desktop, and run the Make commands from WSL, Git Bash, or another environment with GNU Make.

The InterWeave Compose override mounts its DAR into official `splice-onboarding`, which uploads packages after LocalNet becomes operational. After startup, run `npm run canton-localnet:health`. The check requires the three validator readiness endpoints plus the app-provider gRPC Ledger API (`3901`) and JSON Ledger API (`3975`). InterWeave should use the app-provider participant for its hosted parties and party-scoped reads.

LocalNet exposes development admin and database ports. Keep it bound to a trusted local machine and never reuse this topology or its credentials for DevNet, TestNet, or MainNet.
