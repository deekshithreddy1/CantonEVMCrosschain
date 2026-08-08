# Domain model specification

The executable source of truth is `packages/core/src/model.ts`.

Logical objects use stable `IW:<KIND>:<value>` identifiers. Ethereum addresses, chain IDs, Canton parties, instrument IDs, registry IDs, and contract IDs are locators—not primary domain identity. Amounts are non-negative base-10 integer strings in the representation's atomic unit, avoiding floating-point loss; conversion rules belong to adapters.

`Network` selects an extensible adapter and explicit finality policy. `Asset` expresses economic identity and declared capabilities. `AssetRepresentation` binds it to a network locator and separately records discovered capabilities. `Identity` has proof-bearing, revocable network bindings. `PolicyDecision` freezes the exact policy version and reason codes.

`BridgeOperation` is the durable aggregate. Its current state must equal the final persisted `StateTransition`; history must be continuous and auditable. `NetworkTransaction` separates submitted, confirmed, finalized, failed, and uncertain states and retains finality evidence. `Attestation` binds version, operation, networks, transaction/event position, asset, amount, parties, nonce, validity interval, and policy version.

`Settlement` explicitly labels native atomic versus cross-network saga execution. `ReconciliationRecord` compares backing and representation supply without silently repairing discrepancies. `Workflow` permits only named predicates/actions; `AuditEvent` records evidence hashes rather than mutable claims.

Core invariants are executable: exact positive operation amounts, distinct bridge networks, required idempotency, continuous transitions, and `destinationSupply <= verifiedBacking`.
