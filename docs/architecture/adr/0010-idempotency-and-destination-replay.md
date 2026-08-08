# ADR 0010: Durable request idempotency and atomic destination replay protection

Status: Accepted (Phase 9)

## Decision

Every external write is scoped by tenant/API operation and a caller-provided 8–128 character idempotency key. The durable record binds that scope/key to a canonical SHA-256 request fingerprint and immutable `IW:BRIDGE:*` operation ID. Same-payload retries return the prior completed response, concurrent requests report in-progress, failed attempts may be reclaimed, and key reuse with a different payload or operation ID fails.

Internal financial effects carry the immutable operation ID. Destination replay protection must be atomic with the effect itself: Ethereum gateway storage and Canton authorization/release workflows must record the operation ID in the same ledger transaction that mints, releases, pays, or settles. A control-plane database check followed by a ledger call is explicitly insufficient.

Phase 9 defines `AtomicDestinationExecutor` and the Solidity compatibility interface. Concrete Ethereum and Canton implementations remain in their contract phases, but adapters must only call atomic `executeOnce` implementations.

## Consequences

Canonical request payloads may contain only JSON-safe values. Responses stored for replay must be sanitized and bounded. Retention cannot remove destination replay markers while an effect could still be retried. Database records improve API behavior but do not replace ledger-local replay protection.
