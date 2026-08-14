# Idempotency

## What it is

Every API write, durable transition, event, attestation, webhook delivery, and financial effect has a stable identity preventing duplicate execution.

## Why it exists

Clients, brokers, databases, coordinators, and networks can retry or restart at any moment—including after execution but before acknowledgement.

## Example

Send `Idempotency-Key: order-8472-rwa-leg`. The same tenant, key, and canonical request returns/reuses the original operation; reusing it with different content is a conflict.

## Failure cases

Missing key, changed payload under one key, cross-tenant reuse assumptions, or generating a new key after a timeout can cause rejection or a genuinely new operation.

## API usage

Use a business-stable key on every `POST`. Persist it before sending, retry byte-equivalent intent with the same key, and query the original resource before creating another.
