# Trust Model

## What it is

The trust model states which components can establish facts or authorize effects and where irreducible cross-network risk remains.

## Why it exists

Interoperability marketing often hides the validator, governance, finality, RPC, and custody assumptions that determine actual loss scenarios.

## Example

The coordinator orders work but cannot mint alone. A configured validator threshold attests a finalized lock; the destination enforces threshold/domain/replay; reconciliation independently compares backing and supply.

## Failure cases

Threshold compromise, catastrophic source finality failure, malicious asset governance, unsafe package upgrade, or colluding administrators can still cause loss. Reconciliation detects some failures after execution; it does not undo them.

## API usage

Integrators should monitor `/v1/emergency-controls`, transaction/reconciliation status, validator/configuration changes, and disclosed finality policies. Read the public [full trust model](../architecture/trust-model.md).
