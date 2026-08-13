# ADR 0022: Same-network atomic settlement

## Status

Accepted

## Decision

InterWeave exposes one network-neutral settlement request for exactly two reciprocal, positive asset-transfer legs on a single registered network. A network-bound Canton or EVM executor must execute both legs in one native atomic transaction. Partial-success outcomes are not part of the interface.

The service durably claims the immutable request before calling the native executor. Executors must deduplicate with the settlement ID and return `ALREADY_COMMITTED` with finality evidence when a retry observes an earlier commit. Completed, failed, and manual-review records are immutable. Conflicting reuse of an ID is rejected.

A commit is accepted only with a native transaction identifier, observed ledger position, supporting evidence, and finalization time. Native rejection fails the settlement; uncertain submission or finality requires manual review. The service never compensates or guesses.

## Consequences

This provides atomic delivery-versus-payment where one ledger can enforce both legs. It does not provide or imply cross-network atomicity. More complex netting and multi-party structures require a versioned future protocol.
