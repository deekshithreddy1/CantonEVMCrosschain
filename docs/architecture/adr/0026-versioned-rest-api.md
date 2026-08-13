# ADR 0026: Versioned REST API delegates to domain services

## Status

Accepted (Phase 25)

## Decision

The first public HTTP boundary is `/v1` and implements the network, asset, balance, identity/binding, transfer, bridge, settlement, attestation, transaction, and webhook routes in `docs/openapi.yaml`. It uses the standard Fetch `Request`/`Response` contract and delegates through a typed backend port; HTTP routing does not duplicate domain workflow logic.

Every write requires an `Idempotency-Key` header and JSON object body. Successful responses use `{data, requestId}`. Errors use `{error: {code, message, requestId, details?}}`; unexpected internal errors are not disclosed. Request IDs appear in both bodies and `X-Request-Id`.

Public payloads are network-neutral. Backend adapters may expose explicitly requested low-level metadata later, but infrastructure locators are not part of this route contract by default.

## Consequences

The Fetch handler can be embedded in Node, edge-compatible test harnesses, or a framework adapter without changing the API contract. Authentication and tenant authorization remain Phase 30 work; signed webhook delivery remains Phase 29 work.
