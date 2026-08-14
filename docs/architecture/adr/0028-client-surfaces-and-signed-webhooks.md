# ADR 0028: Equivalent clients and durable signed webhooks

## Status

Accepted (Phases 27–29)

## Decision

The Python SDK mirrors TypeScript resource names, idempotency, HTTPS rules, typed errors, and explicit raw metadata. The CLI uses the public SDK, reads credentials from environment variables, supports the roadmap command groups, and provides `--json` output.

Webhook messages use canonical event JSON and HMAC-SHA256 over version, immutable event ID, Unix timestamp, and exact body. Receivers enforce timestamp tolerance and deduplicate by event ID. Attempts are immutable; non-2xx/network failures use bounded exponential retry and become dead letters after the endpoint limit.

## Consequences

All client surfaces share public API semantics. Webhook redelivery is expected and safe, while delivery history remains auditable.
