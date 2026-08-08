# ADR-0003: Cross-network operations are durable sagas

Status: Accepted (2026-08-08)

Never model a cross-network operation as atomic. Persist every transition and its evidence. Destination authorization requires independent validator verification and configurable threshold signatures. Destination workflows enforce operation-ID replay protection. Timeout and ambiguous evidence lead to explicit expiry or manual review; compensation is opt-in and evidence-based. Reconciliation gates completion.
