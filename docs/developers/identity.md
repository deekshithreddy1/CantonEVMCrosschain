# Identity

## What it is

An InterWeave identity binds a logical actor to proven Canton parties and EVM addresses through expiring, revocable network bindings.

## Why it exists

An arbitrary address or party string is not proof of control. Bindings make receiver/sender authorization explicit without storing KYC secrets in the interoperability layer.

## Example

Create Alice with `POST /v1/identities`, request a binding challenge, sign it with the target EVM key or satisfy the configured Canton proof, then submit to `/v1/identities/{id}/bindings`.

## Failure cases

Invalid or expired challenge, replayed proof, revoked binding, wrong network locator, or missing required source/destination binding prevents policy approval.

## API usage

Both writes require `Idempotency-Key` and the `identities:write` scope. Never send private keys, API secrets, or KYC documents in identity metadata.
