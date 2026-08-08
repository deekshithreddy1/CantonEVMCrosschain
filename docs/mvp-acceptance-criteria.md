# MVP acceptance criteria

MVP is accepted only when automated evidence demonstrates:

- reproducible Canton and Anvil environments and deterministic bootstrap;
- one logical asset and verified Canton/EVM identity bindings;
- durable lock→finalize→attest→mint and burn→finalize→attest→release paths;
- independent validator source checks and configurable threshold verification;
- persisted, restart-safe transitions, tenant-scoped API idempotency, network operation replay protection, and signed webhook retries;
- reconciliation showing the golden-path result: 60 represented and 60 locked after minting 100 then burning/releasing 40;
- invariant/property tests for replay, expiry, domain mismatch, invalid/insufficient signatures, pause controls, retries, and supply backing;
- REST/OpenAPI and TypeScript SDK behavior, complete audit reconstruction, observability, and CI failure injection;
- documented trust assumptions and no unresolved critical/high security findings.

A happy-path demonstration alone is not acceptance.
