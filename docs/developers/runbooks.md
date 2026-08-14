# Runbooks

## What it is

Runbooks define repeatable operator actions for reconciliation mismatch, network outage, validator compromise, contract/route pause, backup/restore, incidents, and upgrades.

## Why it exists

Under pressure, improvised recovery can duplicate effects, destroy evidence, or resume before backing is known.

## Example

On a representation/backing mismatch: activate the narrowest mint/route control, preserve evidence, query both ledgers independently, append reconciliation results, and require a different emergency administrator to approve lifting.

## Failure cases

Missing access, unavailable providers, incomplete Canton visibility, corrupted backups, threshold loss, or unresolved mismatch keeps the route paused and escalated. Do not silently edit history.

## API usage

Use `GET/POST /v1/emergency-controls` for control status/actions and `/v1/transactions/{id}` for evidence reconstruction. Follow the full [operational runbooks](../operations/runbooks.md) and [incident response](../operations/incident-response.md).
