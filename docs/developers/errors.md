# Errors

## What it is

Errors use a stable code, safe message, and request ID. SDKs convert API failures into typed errors while retaining retry and correlation metadata.

## Why it exists

Cross-network failures require different action: validation must be fixed, conflicts investigated, and transient provider errors retried with the same identity.

## Example

```json
{"error":{"code":"CONFLICT","message":"operation paused by emergency control","requestId":"req_123"}}
```

## Failure cases

`400` indicates invalid input, `404` an unavailable scoped resource, `409` a state/idempotency conflict, and `500` an unexpected internal failure. A timeout may occur after durable acceptance.

## API usage

Log the request ID and InterWeave operation ID, not credentials or full private payloads. Retry only documented transient conditions and retain the original idempotency key.
