# ADR 0029: Tenant context is enforced end to end

## Status

Accepted (Phase 30)

## Decision

Organizations own projects; projects own environments; credentials and service accounts are bound to that complete hierarchy. API keys are high-entropy secrets stored only as SHA-256 hashes and compared in constant time. OIDC tokens are accepted only through a configured cryptographic verifier and exact issuer, subject, audience, and credential binding. Expiry, revocation, suspension, or inconsistent hierarchy fails closed.

Scopes authorize each REST operation. Tenant identity prefixes idempotency scope and is passed explicitly to services. Network adapters require a separate short-lived grant matching tenant, network, immutable operation ID, and action. PostgreSQL tenant-owned tables enable row-level security using transaction-local organization, project, and environment settings.

## Consequences

Knowing an object ID is insufficient to cross tenant boundaries. Route filtering is defense in depth, not the isolation mechanism. Database sessions must set all three tenant settings inside each transaction before accessing tenant-owned rows.
