# MVP completion status

InterWeave is **not yet claiming MVP completion**. Thirteen of seventeen definition-of-MVP criteria have automated repository evidence. Four require live evidence against the official Digital Asset Canton LocalNet and EVM environment:

1. Start the pinned Digital Asset LocalNet and Anvil reproducibly and pass all health checks.
2. Register one logical asset on the running Canton and EVM ledgers.
3. Execute Canton lock/finality/threshold attestation/EVM mint against those running ledgers.
4. Execute EVM burn/finality/threshold attestation/Canton release and reconcile the round trip.

Run `npm run mvp:status` for the evidence report. `npm run mvp:assert-complete` intentionally fails until live artifacts replace the four pending markers. Unit tests, deterministic examples, and simulated integration tests are necessary evidence but are not relabeled as live ledger validation.

When Docker Desktop 27+, Compose 2.27+, GNU Make, and at least 8 GB Docker memory are available, follow `docs/local-development.md`, start the pinned official LocalNet, run `npm run canton-localnet:health`, and capture ledger transaction IDs, package/contract IDs, finality positions, validator signatures, and reconciliation output.
