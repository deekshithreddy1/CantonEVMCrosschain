# InterWeave

### The interoperability control plane for Canton and EVM ecosystems

InterWeave helps builders connect Canton’s privacy-preserving institutional workflows with Ethereum and other EVM networks—without hiding the hard parts of cross-network coordination behind a misleading “atomic bridge” abstraction.

It provides a network-neutral foundation for registering assets and identities, moving value through attested workflows, coordinating settlement, verifying external state, triggering permissioned actions, and continuously reconciling supply and backing.

> InterWeave is not a simple token bridge. It is infrastructure for building durable, policy-aware applications across ledgers that do not share consensus.

## Why InterWeave matters

Canton gives builders something public blockchains cannot easily provide: privacy-aware composability for regulated institutions, synchronized workflows, and fine-grained visibility. EVM networks bring a different set of strengths—deep liquidity, widely adopted token standards, programmable assets, and a large developer ecosystem.

The opportunity is powerful: a private Canton workflow should be able to use verified facts and assets from Ethereum, while an authorized Canton event should be able to drive a controlled action on an EVM network.

The engineering challenge is equally important. Canton and Ethereum:

- have independent consensus and finality models;
- represent identities and assets differently;
- expose different privacy and data-visibility guarantees;
- cannot provide native atomicity across both ledgers;
- require explicit recovery when one side succeeds and the other side is delayed or uncertain.

InterWeave is designed around those realities. It gives Canton builders reusable infrastructure for interoperability so each application does not have to invent its own validator network, replay protection, settlement state machine, policy layer, reconciliation process, and failure-recovery model.

## What builders can create

InterWeave is intended to support applications such as:

- **Tokenized assets and EVM liquidity** — lock or reserve a Canton asset and issue an authorized EVM representation, then burn and release it safely.
- **Delivery-versus-payment settlement** — coordinate a Canton tokenized RWA against an Ethereum stablecoin with explicit finality and compensation boundaries.
- **Private credit workflows** — verify an Ethereum collateral deposit and provide signed evidence to a permissioned Canton credit workflow.
- **Cross-network eligibility** — use finalized EVM ownership or credential evidence inside a Canton application without exposing unnecessary private state.
- **Canton-authorized EVM actions** — turn an approved Canton trade or workflow event into a policy-controlled payment or asset action on Ethereum.
- **Unified operational tooling** — expose assets, balances, transactions, attestations, and settlements through one network-neutral API.

## How it works

```text
Applications
    |
    |  REST API / TypeScript SDK / Python SDK / CLI
    v
InterWeave Control Plane
    |-- Network, asset, and identity registries
    |-- Versioned policy engine
    |-- Durable transaction and settlement coordinators
    |-- Finality and threshold-attestation services
    |-- Permissioned workflow engine
    |-- Supply invariants and reconciliation
    v
Adapter Layer
    |-- Canton Ledger API / Canton token standards
    `-- Ethereum and EVM contracts/providers
```

A typical cross-network operation follows a durable sequence:

1. Validate identities, assets, capabilities, and the exact policy version.
2. Reserve, lock, or burn value on the source network.
3. Verify source finality using network-specific evidence.
4. Ask independently configured validators to observe and sign canonical facts.
5. Verify threshold, membership, domain, expiry, and replay protection.
6. Perform the one-time destination action.
7. Verify destination finality and reconcile the resulting state.
8. Complete only when the invariants match; otherwise enter a clear failure or manual-review state.

The coordinator is never treated as a trust oracle. Destination effects require verifiable source evidence.

## Built for Canton’s privacy model

InterWeave does not treat Canton like a public blockchain with different RPC methods.

Canton reads and subscriptions are party-scoped. A participant can only observe data visible to its authorized parties, and absence from one participant is not proof that something does not exist globally. InterWeave preserves this boundary in its adapter contracts and evidence model instead of pretending all ledger state is universally queryable.

Network-specific identifiers—such as Canton parties, contract/instrument references, EVM addresses, and chain IDs—remain behind representations and identity bindings. Public application interfaces use logical `IW:*` identifiers so business workflows remain portable and network-neutral.

## Safety principles

InterWeave follows a few non-negotiable rules:

- **No false cross-network atomicity.** Same-ledger settlement may be atomic; Canton–EVM settlement is a durable saga.
- **Finality is evidence, not a timer.** Submission, confirmation, canonicality, and finalization are modeled separately.
- **Independent verification.** Validators query independently configured source providers before signing.
- **Replay-safe effects.** Every write has an idempotency key and every ledger effect has an immutable operation identifier.
- **Fail closed.** Invalid signatures, expired attestations, mismatched domains, uncertain finality, and unsafe retries cannot silently succeed.
- **Compensate only when safe.** Before an irreversible boundary, a reservation may be cancelled; afterward, ambiguity requires recovery or manual review.
- **Reconcile continuously.** Representation supply must never exceed verified backing, and discrepancies are preserved and escalated rather than silently repaired.
- **Evidence does not equal authority.** A generic attestation cannot mutate destination state unless an enabled, versioned workflow and policy explicitly authorize a predefined action.

## Current capabilities

The repository currently implements the engineering foundation through **Phase 25 — Versioned REST API**, including:

- network, asset, representation, identity, and policy registries;
- Canton and EVM adapter boundaries;
- durable transaction state and restart-safe idempotency;
- normalized network events and finality evidence;
- canonical, domain-separated attestations;
- independent validator verification and configurable threshold signatures;
- Canton lock → EVM mint and EVM burn → Canton release coordinators;
- append-only supply invariants and independent reconciliation;
- same-network native atomic settlement abstraction;
- non-atomic Canton–EVM settlement sagas with explicit timeout and compensation behavior;
- generic evidence-only state attestations;
- versioned workflows with predefined, permissioned action handlers;
- a Fetch-compatible `/v1` REST boundary and [OpenAPI specification](docs/openapi.yaml).

The test suite includes replay, restart recovery, expiry, invalid and insufficient signatures, domain separation, finality uncertainty, pause controls, settlement compensation, backing invariants, and reconciliation mismatch scenarios.

## Project status

InterWeave is under active development. The architecture and core protocol behavior are implemented and tested, but this repository should not yet be treated as a production deployment.

Authentication and tenant isolation, signed webhook delivery, public SDK packages, complete observability, deployment automation, live Canton–EVM environment validation, and an external security review are still required before MVP acceptance.

This distinction matters: a passing happy path is not enough for institutional interoperability. See the full [MVP acceptance criteria](docs/mvp-acceptance-criteria.md).

## Getting started

### Requirements

- Node.js 22 or newer
- npm
- Java and the DAML toolchain for Canton builds/tests

Install dependencies:

```bash
npm install
```

Run all static and protocol checks:

```bash
npm run check
```

Run the full TypeScript, Solidity/local-EVM, and DAML test suite:

```bash
npm test
```

## Repository guide

```text
contracts/        Ethereum gateway, verifier, and test contracts
docs/             Architecture, protocol documentation, ADRs, and OpenAPI
packages/core/    Network-neutral domain services and persistence contracts
scripts/          Solidity and DAML build/test helpers
examples/         Planned end-to-end integration examples
apps/             Application entry points as runtime phases are introduced
sdk/              Public SDK surfaces as they are implemented
infra/            Local and deployment infrastructure
```

Start with these documents:

- [Architecture overview](docs/architecture/overview.md)
- [Protocol domain model](docs/protocol/domain-model.md)
- [OpenAPI specification](docs/openapi.yaml)
- [MVP acceptance criteria](docs/mvp-acceptance-criteria.md)
- [Architecture decision records](docs/architecture/adr)

## A note to Canton builders

The Canton ecosystem makes it possible to build financial applications where privacy, authorization, and composability are part of the ledger model—not layers added afterward. InterWeave’s goal is to help those applications reach beyond a single network without weakening those properties.

That means interoperability should feel useful to application developers while remaining honest to protocol engineers and risk teams. Builders should be able to ask for a settlement, an attestation, or a workflow—not manually orchestrate confirmations, signatures, retries, and compensations. At the same time, the system should always show what guarantee it can actually provide.

That is the standard InterWeave is being built toward: **an open, verifiable path between Canton workflows and EVM assets, designed for real-world failure—not only the demo.**

---

InterWeave is an independent open-source project under active development. Canton, Ethereum, and other names are the property of their respective owners; references indicate ecosystem compatibility and do not imply endorsement.
