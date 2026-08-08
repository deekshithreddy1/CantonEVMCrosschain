# ADR 0005: Canton adapter and party-scoped visibility

Status: Accepted (Phase 4)

## Decision

The public Canton adapter exposes network-neutral metadata, holdings, balance, prepared transfer, submission, observation, event, and state-query records. Ledger API payloads and contract IDs remain opaque behind `CantonTransport` and token gateways.

Every state read, transaction observation, and event subscription requires an explicit party scope. The adapter checks that scope against the parties authorized by its active connection. An empty scope is rejected; absence from one party-scoped view is never interpreted as global absence.

CIP-0056 is implemented as a facade over a replaceable gateway so package/interface resolution and Wallet SDK or Ledger API transport choices do not leak outward. CIP-0112 has a compile-time compatibility seam but deliberately has no placeholder implementation. A transfer submission returns `SUBMITTED`, never finalized; finality requires a separately observed committed transaction and evidence handled by the later finality phase.

## Primary-source basis

- Digital Asset's Canton 3.5 JSON Ledger API documentation uses party filters for active-contract state and command submission.
- Digital Asset's Token Standard documentation exposes token operations through the Wallet SDK and describes prepare, sign, and execute submission.
- CIP-0056 defines the current token metadata, holding, and transfer interfaces. Package IDs and concrete contract structures are therefore transport concerns rather than public domain identifiers.

## Consequences

The Phase 4 package is testable without a Canton node and cannot silently substitute fake production finality. A production gateway, authentication configuration, package resolution, reconnect behavior, pruning recovery, and integration tests against LocalNet remain required before deployment.
