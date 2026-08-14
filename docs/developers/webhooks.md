# Webhooks

## What it is

Webhooks deliver immutable domain events to registered HTTPS endpoints with timestamped HMAC signatures, retries, and dead-letter state.

## Why it exists

Applications need push notifications, but networks and consumers redeliver. Signed, idempotent delivery prevents tampering and duplicate business effects.

## Example

Register via `POST /v1/webhooks`. Verify the signature over the exact timestamp and body, reject stale timestamps, and deduplicate by event ID before processing.

## Failure cases

Invalid signature, stale timestamp, changed body, endpoint timeout, repeated non-success response, or exhausted retries results in rejection/retry/dead-letter. A replay endpoint never redelivers already successful deliveries.

## API usage

Registration needs `webhooks:write` and `Idempotency-Key`. Store webhook secrets in a secret manager and support rotation; never log them.
