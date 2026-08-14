# InterWeave operational runbooks

These procedures preserve safety before availability. The incident commander records every command, actor, time, reason, ledger position, and resulting control ID. Never delete evidence or claim cross-network rollback.

## Reconciliation

1. Identify the asset, representation, source/destination positions, and last matching check.
2. Activate the narrowest applicable mint/release/settlement or route control.
3. Snapshot database records, validator observations, Canton contracts/offsets, EVM blocks/receipts/supply, and audit-chain hashes.
4. Query both ledgers through independent providers and recompute canonical supply, circulating source, locked backing, representation supply, pending effects, mint, burn, and release totals.
5. If evidence matches, record a new reconciliation check and require emergency-admin approval before lifting controls. If it does not, keep issuance blocked and escalate to manual remediation and incident response.
6. Never alter a historical check; append resolution evidence.

## Network outage

1. Confirm whether API, validator providers, source ledger, destination ledger, or finality observation is unavailable.
2. Stop submissions for the affected source, destination, or direction; retain queued operations.
3. Do not infer failure or finality from a timeout. Operations remain at their last durable state.
4. Fail over only to an approved, chain-identity-verified endpoint. Watch ingestion lag and validator disagreement.
5. After recovery, rewind indexers to a trusted position, replay idempotently, re-evaluate finality, reconcile, then lift controls through independent approval.

## Validator compromise

1. Activate controls for every route authorized by the affected validator set.
2. Disable the validator key/member and revoke infrastructure access; preserve HSM, service, provider, and audit logs.
3. Determine the exposure interval and enumerate every signature and attestation involving the validator.
4. If threshold compromise is possible, treat all interval attestations as suspect and reconcile every affected asset.
5. Register a new non-overlapping validator set with independent keys/providers. Test old-key rejection and threshold availability.
6. Resume only after security approval and matching reconciliation.

## Contract and route pause

1. Choose the narrowest control: asset, source network, destination network, direction, mint, release, or settlement.
2. Record incident reason and expected impact, activate through an emergency operator, and verify status through the API and destination ledger where applicable.
3. Confirm new targeted submissions fail while read, audit, and reconciliation paths remain available.
4. Diagnose and reconcile; do not clear pending evidence.
5. A different emergency-admin reviews evidence and lifts the control with a reason. Verify an approved test operation before restoring normal limits.

## Backup and restore

1. Take encrypted PostgreSQL, configuration, audit-anchor, deployment-manifest, and key-reference backups; private keys remain inside HSM/MPC backup procedures.
2. Record checksum, retention class, encryption key reference, and ledger/indexer checkpoints.
3. Restore into an isolated environment, rotate restored credentials, verify migrations and audit chains, then replay from recorded ledger checkpoints.
4. Run the golden path, failure injection, and reconciliation. Measure RPO/RTO and attach immutable evidence to the readiness gate.
5. A backup is not accepted until restore is demonstrated. This repository currently has no approved production restore evidence.

## Routine operations

- Review safety alerts and stuck operations continuously.
- Review access, validator, signer, emergency, and reconciliation evidence daily.
- Exercise pause, provider failover, key rotation, validator rotation, and restore at the approved cadence.
- Keep operational and security contacts outside the affected infrastructure.
