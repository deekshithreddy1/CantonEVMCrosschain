# InterWeave threat model

## Purpose and scope

InterWeave coordinates value and evidence between Canton and EVM networks. It does not merge their consensus, make cross-network execution atomic, or turn a coordinator/RPC/database into a source of truth. This model covers the API, coordinator, validators, signers, indexers, adapters, PostgreSQL, message broker, EVM contracts, Canton application, tenant boundary, and their operators.

The safety objective is simple: no accepted failure or compromise may cause destination representation supply to exceed verified source backing, repeat a financial effect, or conceal an unresolved mismatch. Availability is secondary to safety; uncertain operations stop or enter manual review.

This document describes implemented controls but is not an audit. Production use still requires independent protocol, Solidity, DAML authorization, key-management, and operational reviews.

## Assets and security properties

| Asset | Required property |
| --- | --- |
| Canton holdings and locked backing | Only authorized parties can lock or release; backing remains attributable to a finalized operation. |
| EVM underlying and representation tokens | Mint/release/burn executes once, for the exact asset, amount, receiver, chain, and destination. |
| Validator and administrative keys | Keys remain confidential, scoped, rotatable, attributable, and unavailable to ordinary application processes. |
| Attestations and finality evidence | Canonical, domain-separated, threshold-authorized, time-bounded, immutable, and replay-resistant. |
| Transaction and reconciliation history | Durable, tenant-scoped, append-only, reconstructable, and never silently repaired. |
| Tenant identities and metadata | Confidential across tenants and visible only to authorized principals and Canton parties. |
| Service availability | Backpressure or outage cannot weaken authorization, finality, or one-time execution. |

## Trust boundaries and assumptions

- Canton and each EVM network are trusted only for their own consensus and finalized state.
- The coordinator is trusted for liveness and sequencing, not truth or unilateral authorization.
- Fewer validators than the configured threshold may be malicious without compromising safety. Threshold compromise is a catastrophic authorization failure.
- Validators must use independently administered providers; identical responses from one shared provider are not independent evidence.
- Destination contracts and Canton choices enforce authorization and replay protection even when upstream services are hostile.
- HSM/MPC systems protect production keys. Local keys, Anvil accounts, and the 1-of-1 local verifier are development fixtures only.
- Administrators can change risk configuration within their roles. Separation of duties, multi-party approval, immutable audit, and external monitoring constrain that trust.
- Reconciliation is an independent detector and safety gate, not a repair mechanism.

## Threat analysis

### 1. Coordinator compromise

- **Asset at risk:** operation ordering, liveness, transaction metadata, and attempts to trigger unauthorized mint or release.
- **Preconditions:** attacker controls the coordinator process, its service credential, or its message-consumer identity.
- **Detection:** impossible/duplicate transition attempts, validator claim disagreement, destination reverts, audit-chain anomalies, reconciliation mismatches, and unusual stuck-operation/RPC-error metrics.
- **Preventive controls:** the coordinator cannot sign validator attestations; validators independently observe source finality; destination execution verifies threshold, domain, expiry, and operation replay state; state transitions and ledger effects use immutable idempotency keys.
- **Recovery:** revoke the coordinator credential, stop affected workers, preserve queues and audit evidence, deploy a known-good instance, replay from durable checkpoints, and reconcile before resuming issuance. Pause the affected direction if destination attempts occurred.
- **Residual risk:** a compromised coordinator can deny or delay service and may expose metadata visible to its tenant scope.

### 2. Single-validator compromise

- **Asset at risk:** one share of attestation authority and the integrity of validator observations.
- **Preconditions:** attacker controls one validator key/process while fewer than the threshold are compromised.
- **Detection:** disagreement against other validators, abnormal signing rate, provider-position divergence, key-use audit, and validator health/disagreement alerts.
- **Preventive controls:** configurable threshold sets, unique validator keys, independent provider queries, canonical signed claims, membership intervals, and destination threshold enforcement.
- **Recovery:** disable and rotate the validator, retain disputed evidence, recompute threshold availability, replace independent infrastructure, and investigate every signature produced during the exposure window.
- **Residual risk:** availability can fall below threshold; correlated providers can make nominally independent validators agree on false data.

### 3. Threshold-validator compromise

- **Asset at risk:** all destination assets authorized by the compromised validator set.
- **Preconditions:** attacker controls enough active validator keys or operators to satisfy the threshold.
- **Detection:** reconciliation detects unbacked issuance; signer/provider telemetry shows correlated anomalies; external ledger monitoring disagrees with attested evidence.
- **Preventive controls:** organizationally independent validators, HSM/MPC key custody, short attestation validity, exact domain binding, least-privilege set administration, and multi-party validator rotation.
- **Recovery:** immediately pause mint/release for affected routes, rotate to a non-overlapping validator set, preserve keys/logs for investigation, quantify unauthorized effects through ledger evidence, notify affected operators, and follow governed remediation rather than silently rewriting state.
- **Residual risk:** a valid threshold can authorize a fraudulent but cryptographically valid operation before reconciliation reacts. This is a catastrophic residual risk requiring external review and conservative limits.

### 4. Signer compromise

- **Asset at risk:** signatures produced by custody adapters, approval artifacts, and any role tied to the key.
- **Preconditions:** HSM/MPC credentials, policy route, or signing service is compromised.
- **Detection:** signatures outside approved digest/request pairs, unexpected key/reference use, approval mismatch, signing-rate alerts, and audit reconstruction.
- **Preventive controls:** opaque key references, digest-only signer interface, HSM/MPC boundary, signing policy, exact-request multi-party approval for privileged actions, and no export of private material.
- **Recovery:** disable the key reference, rotate the key and dependent validator/admin configuration, pause affected capabilities, enumerate signatures from immutable audit records, and re-authorize only after reconciliation.
- **Residual risk:** a signer authorized by weak upstream policy can produce valid signatures; custody does not replace authorization policy.

### 5. Admin compromise

- **Asset at risk:** registries, validator membership, thresholds, asset status, network configuration, signing policy, and emergency controls.
- **Preconditions:** attacker obtains an administrative credential or colludes with required approvers.
- **Detection:** privileged-action audit events, out-of-band configuration comparison, unexpected role/grant changes, and alerts on validator/asset policy changes.
- **Preventive controls:** scoped RBAC, separate administrative roles, tenant/network grants, multi-party approvals, immutable versions, on-chain access control, and no shared application/admin credential.
- **Recovery:** revoke sessions/API keys, pause affected routes, restore reviewed configuration through a new authorized quorum, rotate dependent keys, reconstruct every administrative action, and reconcile affected assets.
- **Residual risk:** a legitimately authorized administrative quorum can make unsafe configuration changes; timelocks and independent governance review remain production requirements.

### 6. RPC compromise

- **Asset at risk:** observed balances, receipts, canonical block membership, finality evidence, and validator decisions.
- **Preconditions:** attacker controls or intercepts one or more configured RPC providers.
- **Detection:** cross-provider disagreement, malformed-response validation, chain-ID/genesis mismatch, impossible positions, reorg events, ingestion lag, and reconciliation against independent readers.
- **Preventive controls:** explicit chain identity, strict response parsing, independent validator providers, distinct confirmation/canonicality/finalized evidence, bounded retries, and fail-closed adapter behavior.
- **Recovery:** quarantine the endpoint, invalidate unfinalized observations, switch to independently verified providers, replay from the last trusted checkpoint, and re-evaluate finality before signing or continuing.
- **Residual risk:** correlated provider compromise or a network-wide consensus failure may evade comparison until an independent data source recovers.

### 7. Database compromise

- **Asset at risk:** workflow state, idempotency records, tenant data, evidence indexes, configuration, and audit availability.
- **Preconditions:** attacker can read or mutate PostgreSQL, credentials, backups, or migration execution.
- **Detection:** hash-chain verification failure, illegal version/transition sequence, ledger-to-database reconciliation mismatch, RLS access anomalies, backup integrity checks, and missing checkpoint continuity.
- **Preventive controls:** transactional append semantics, unique operation/effect keys, row-level tenant isolation, least-privilege service accounts, immutable audit hashes, encrypted transport/backups, and ledger-side replay protection.
- **Recovery:** isolate the database, restore a verified backup, rotate credentials, replay authoritative ledger/broker events, verify audit chains, and reconcile every affected asset before reopening writes.
- **Residual risk:** database loss can destroy non-ledger metadata and delay recovery; a privileged attacker may alter data and hashes unless audit anchors are exported to an independent system.

### 8. Indexer omission

- **Asset at risk:** completeness of events, balances, finality observations, and timely operation progress.
- **Preconditions:** faulty or malicious indexer skips a canonical Canton/EVM event or advances its checkpoint incorrectly.
- **Detection:** checkpoint gaps, source-versus-destination reconciliation, direct validator queries, ingestion-lag/stuck-operation alerts, and periodic range rescans.
- **Preventive controls:** event identity includes ledger position/index, checkpoint advancement follows durable ingestion, validators do not trust coordinator/indexer assertions, and reconciliation reads independently.
- **Recovery:** stop checkpoint advancement, rewind to a verified position, replay the range idempotently, compare against an independent endpoint, and resume only after reconciliation matches.
- **Residual risk:** privacy-scoped Canton visibility can make a real event invisible to a participant lacking the correct party authorization.

### 9. Event replay

- **Asset at risk:** financial effects, webhook consumers, workflow transitions, and processing capacity.
- **Preconditions:** attacker or broker redelivers a valid event/message/API request or reuses an attestation.
- **Detection:** duplicate-event/idempotency counters, destination `processed` state, duplicate transition attempts, and immutable delivery logs.
- **Preventive controls:** stable normalized event IDs, tenant-scoped API idempotency, transition keys, attestation/effect domain binding, broker consumers designed for redelivery, and on-ledger operation replay maps.
- **Recovery:** acknowledge the duplicate without repeating the effect, investigate unusual replay volume, preserve the original and replay attempt, and rate-limit abusive sources.
- **Residual risk:** replay remains a denial-of-service vector even when it cannot duplicate value.

### 10. Chain reorganization

- **Asset at risk:** source-event truth, minted backing, burn evidence, and finality assumptions.
- **Preconditions:** an EVM block containing an observed event is removed before the configured finality boundary, or the policy underestimates reorg depth.
- **Detection:** canonical block-hash disagreement, removed-log events, provider divergence, finalized-position changes, and reconciliation mismatch.
- **Preventive controls:** submission/confirmation/canonicality/finalization are separate states; validators sign only policy-satisfying finality evidence; unfinalized normalized events can be marked removed; conservative network-specific policies.
- **Recovery:** discard removed unfinalized evidence, rewind the indexer, observe the canonical replacement, and do not attest. If an allegedly finalized event reorganizes after destination execution, pause the route and enter incident-led reconciliation/manual remediation.
- **Residual risk:** finality failure beyond the assumed security model can create an unbacked destination effect that no software rollback can safely erase.

### 11. Malicious token contract

- **Asset at risk:** gateway-held tokens, accounting correctness, execution availability, and reentrancy boundary.
- **Preconditions:** governance registers a hostile/non-standard EVM token or upgradeable token changes behavior.
- **Detection:** capability probes, return-value/revert anomalies, balance-delta disagreement, code-hash monitoring, gateway errors, and reconciliation mismatch.
- **Preventive controls:** asset allowlisting, explicit capability discovery, `SafeERC20`, reentrancy guard, exact integer accounting, gateway pause, and restricted registry administration.
- **Recovery:** disable/pause the asset, block new issuance/release, snapshot balances and implementation/code hashes, reconcile affected operations, and require reviewed migration/remediation.
- **Residual risk:** fee-on-transfer, rebasing, blacklist, proxy-upgrade, or callback behavior can invalidate assumptions unless explicitly supported and continuously monitored.

### 12. Canton package or application upgrade

- **Asset at risk:** authorization semantics, template/interface compatibility, contract visibility, and lock/release behavior.
- **Preconditions:** a new DAR/package mapping or Canton application version is deployed without compatible authorization and migration review.
- **Detection:** package-ID/interface mismatch, command rejection, compatibility suite failure, changed stakeholder visibility, indexer decode errors, and reconciliation mismatch.
- **Preventive controls:** pinned SDK/package versions, explicit supported package mapping, immutable workflow/policy versions, DAML authorization tests, staged upgrades, and no automatic production promotion.
- **Recovery:** pause the Canton route, retain old/new package IDs and evidence, roll back application routing where supported or perform a governed DAML migration, replay indexers, and reconcile before resuming.
- **Residual risk:** DAML contract migration may be irreversible and privacy changes may prevent the old participant scope from reconstructing state.

### 13. Denial of service

- **Asset at risk:** API availability, validator quorum, queue/database capacity, RPC quotas, and timely expiry/finality processing.
- **Preconditions:** request/event flood, dependency outage, expensive malformed inputs, lock contention, or targeted validator disruption.
- **Detection:** latency/error/stuck metrics, queue and ingestion lag, saturation, rate-limit events, validator uptime, and expiring-operation counts.
- **Preventive controls:** authentication, tenant quotas, bounded payloads and retries, backpressure, durable queues, independent validators/providers, circuit breakers, and horizontal role separation.
- **Recovery:** shed/rate-limit traffic, isolate abusive tenants, scale or fail over dependencies, preserve queued work, allow unsafe/expired operations to fail closed, and reconcile after recovery.
- **Residual risk:** threshold services and external ledgers are availability dependencies; safety may require an extended bridge pause.

### 14. Tenant-isolation failure

- **Asset at risk:** customer metadata, operation history, identities, policies, webhook secrets, key references, and Canton-visible data.
- **Preconditions:** missing tenant predicate/RLS context, credential confusion, cache-key collision, overly broad Canton party scope, or administrative misuse.
- **Detection:** cross-tenant canary tests, access/audit logs, RLS violations, unexpected resource IDs in responses, webhook signature complaints, and privacy review.
- **Preventive controls:** organization/project/environment hierarchy, tenant-bound credentials and idempotency, scoped RBAC/grants, database RLS, strict repository/API tenant context, party-scoped Canton queries, and rejection of secret material in audit records.
- **Recovery:** revoke affected credentials, disable exposed endpoints, determine scope from immutable access/audit evidence, rotate secrets, correct authorization/RLS, notify affected parties as required, and retest isolation before restoration.
- **Residual risk:** infrastructure administrators and incorrectly hosted Canton parties may have broader visibility than application tenants; organizational controls and independent audit are necessary.

### 15. Insider threat

- **Asset at risk:** any system reachable through legitimate operational, validator, signer, database, or governance access.
- **Preconditions:** authorized personnel acts maliciously, is coerced, or combines privileges through collusion.
- **Detection:** immutable administrative/signing audit, separation-of-duty violations, anomalous access/time/location, configuration drift, reconciliation discrepancies, and independent review.
- **Preventive controls:** least privilege, just-in-time access, two-person approval, independent validator organizations, HSM/MPC, environment separation, protected branches, reviewed deployments, and credential rotation.
- **Recovery:** suspend identities and sessions, preserve forensic evidence, invoke incident governance, rotate affected trust roots, restore reviewed state, reconcile assets, and conduct legal/regulatory notification where applicable.
- **Residual risk:** colluding authorized quorums can bypass technical separation; governance, personnel controls, insurance, limits, and external transparency remain necessary.

## Detection and response priorities

1. Stop new unsafe effects: pause the narrowest affected asset, network, direction, or capability.
2. Preserve evidence: do not delete queues, transitions, audit records, provider responses, or ledger positions.
3. Establish scope independently: compare Canton, EVM, database, validator, signer, and audit evidence.
4. Rotate compromised credentials or validator sets without overwriting historical configuration.
5. Recover idempotently from the last trusted checkpoint.
6. Reconcile supply and backing; unresolved discrepancies remain blocked or in manual review.
7. Resume only through authorized change control and record the decision.

## Verification map

| Control claim | Executable evidence |
| --- | --- |
| Domain, expiry, signature, threshold, membership, and replay enforcement | `attestation-protocol`, `threshold-attestation`, Solidity gateway, and Phase 37 property tests |
| Restart/redelivery safety | transaction/idempotency/coordinator tests and Phase 36 failure injection |
| Supply never exceeds backing | supply-invariant, reconciliation, Phase 35 golden path, and Phase 37 property tests |
| Tenant and credential isolation | tenancy/auth, REST API, audit, webhook, and identity tests |
| Canton authorization and privacy | Canton adapter tests and DAML authorization scenarios |
| Operational detection | OpenTelemetry instrumentation, dashboard, and alert rules |

## Required production follow-up

Before production value is enabled, owners must define quantitative validator independence, asset/route limits, chain-specific finality and reorg budgets, key ceremonies, external audit anchoring, retention/privacy classification, recovery objectives, incident contacts, notification obligations, and tested emergency/backup runbooks. Phase 39 adds granular emergency controls; those controls are not assumed complete by this document.
