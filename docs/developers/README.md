# InterWeave developer documentation

InterWeave gives applications one control-plane vocabulary for Canton and EVM operations without pretending the ledgers share consensus. Begin with the [Quick Start](quick-start.md), then use the topic pages below.

| Build with | Read |
| --- | --- |
| Core objects | [Concepts](concepts.md), [Networks](networks.md), [Assets](assets.md), [Identity](identity.md) |
| Value movement | [Transfers](transfers.md), [Bridge operations](bridge-operations.md), [Settlements](settlements.md) |
| Evidence and automation | [Attestations](attestations.md), [Finality](finality.md), [Workflows](workflows.md), [Webhooks](webhooks.md) |
| Correct integrations | [Errors](errors.md), [Idempotency](idempotency.md), [Trust model](trust-model.md), [Security](security.md) |
| Operate and verify | [Testing](testing.md), [Runbooks](runbooks.md) |

API paths are relative to `/v1`. Atomic amounts are decimal integer strings, never floating-point values. Every cross-network write is a durable saga with explicit finality, attestation, destination execution, and reconciliation stages.
