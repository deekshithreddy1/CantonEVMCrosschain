# ADR-0002: Protocol compatibility and research baseline

Status: Accepted (2026-08-08)

Research uses primary specifications as of the decision date.

- CIP-0056 is Final. Integrate its metadata, holdings, transfer instruction, allocation, allocation request, and allocation instruction APIs through a `Cip56Adapter`. Holdings and event views are party-scoped. Canton standard token decimals are 10, but the neutral model does not globally assume 10.
- CIP-0112 is Draft. Reserve a `Cip112Adapter` boundary; do not make public types depend on draft contract shapes.
- Canton Ledger API/JSON Ledger API is the application integration boundary; prepared transactions, signing, submission, and party-scoped update streams remain adapter concerns.
- The Canton Wallet SDK is suitable integration prior art for external-party allocation, active-contract reads, prepared transaction validation, signing/submission, and Token Standard interaction. Adoption is deferred until the Canton adapter phase.
- ERC-20 is Final; callers must handle `false` returns. ERC-3643 is permissioned and requires identity/compliance prechecks. ERC-7943 is Final and uses ERC-165 introspection; capabilities must still be discovered.
- Ethereum receipt inclusion is not finality. Each EVM network config chooses confirmation and/or finalized-block semantics.
- OpenZeppelin Contracts 5.x role-based access patterns are the baseline; no single unrestricted production owner.

Initial tooling is Node.js 22.14.0 (observed locally) and TypeScript 5.9.3 (exactly pinned). Runtime protocol dependencies are intentionally not selected before their implementation phase; each addition requires an ADR with an exact version and compatibility test.

Primary sources: CIP repository (`cip-0056`, `cip-0112`), Digital Asset Canton 3.4 integration documentation, Canton Wallet repository, Ethereum EIPs 20/3643/7943, ethereum.org PoS finality documentation, and OpenZeppelin Contracts 5.x documentation.
