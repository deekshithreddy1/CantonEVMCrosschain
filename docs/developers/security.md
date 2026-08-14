# Security

## What it is

InterWeave uses scoped authentication, tenant isolation, policy authorization, independent validation, threshold signatures, HSM/MPC boundaries, immutable audit, emergency controls, and supply reconciliation.

## Why it exists

One weak control must not silently become permission to move value across two independently governed ledgers.

## Example

A service account with `bridge:create` can request a bridge but cannot administer policies, activate emergency controls, or sign an attestation. Destination execution still verifies the attestation.

## Failure cases

Leaked credentials, tenant context bugs, key/threshold compromise, malicious RPC/token, replay, denial of service, and insider action remain modeled risks with detection and recovery procedures.

## API usage

Use TLS outside localhost, short-lived scoped credentials, unique idempotency keys, and secret managers. Never submit secrets in bodies/metadata. See the [threat model](../security/threat-model.md).
