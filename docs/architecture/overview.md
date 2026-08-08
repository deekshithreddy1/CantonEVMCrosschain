# Architecture

## Outcome and boundary

InterWeave is a durable interoperability control plane. Same-ledger operations may use ledger-native atomicity. A Canton↔EVM operation is a saga: source reservation/burn, independent finality verification, threshold attestation, one-time destination execution, and reconciliation. The coordinator is not a trust oracle.

## Initial shape

Customer interfaces (REST, TypeScript, Python, CLI) call one modular control-plane application. Modules own network-neutral assets, identities, policy decisions, durable transactions, settlements, attestations, workflows, audit records, events, and reconciliation. Canton and EVM adapters are anti-corruption layers. Validators, signers, indexers, and reconciliation workers are separate security/scaling boundaries.

PostgreSQL is authoritative for control-plane state and transition history. A durable broker carries notifications and work; consumers must tolerate redelivery. Redis, if added, is never authoritative. Every write has a tenant-scoped idempotency key and every ledger effect has an immutable operation ID.

## Trust and data flow

1. API authenticates the tenant, validates an idempotent request, and stores `CREATED`.
2. Policy engine stores its exact versioned decision.
3. The source adapter prepares/submits; finality service persists evidence.
4. Independent validators query independently configured providers and sign canonical, domain-separated bytes.
5. The destination verifies membership, threshold, expiry, domain, and replay state before execution.
6. Destination finality is independently evidenced; reconciler compares supply and backing.
7. Only a successful reconciliation reaches `COMPLETED`; ambiguity reaches `MANUAL_REVIEW`.

No party can read arbitrary Canton state: queries and subscriptions are party-scoped and absence from one participant is not proof of global absence. EVM providers are cross-checked where policy requires it.

## Module contracts

Public APIs use logical `IW:*` IDs and exact integer atomic amounts. Network locators live only in `AssetRepresentation` and `NetworkIdentity`. Adapter capabilities are discovered, never inferred merely from a token standard. CIP-0056 and future CIP-0112 implementations sit behind `CantonTokenAdapter`; EVM token standards sit behind `EvmTokenAdapter`.

## Deployment progression

Local development uses a single API/control-plane process plus PostgreSQL, NATS, Anvil, and a Canton sandbox/participant. Production separation is reserved for signer, validator, reconciler, and indexers. Kubernetes and Terraform are deferred until runtime boundaries are proven.
