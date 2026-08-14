# Service-level objectives

These are initial targets pending live testnet baselines and production approval.

| Signal | Initial objective | Safety response |
| --- | --- | --- |
| API availability | 99.9% monthly for authenticated reads and accepted writes | Availability never bypasses authorization or idempotency. |
| Accepted-request latency | 99% stored durably within 2 seconds | Do not report ledger finality as API acceptance. |
| Event ingestion lag | 95% within 60 seconds of observable finalized data | Alert and pause affected direction if safety evidence becomes stale. |
| Reconciliation freshness | Every active bridged asset within 5 minutes | Block new issuance after missed windows according to policy. |
| Validator availability | Configured threshold available 99.9% monthly | Stop attestations below threshold; never lower threshold automatically. |
| Safety invariant | Zero excess representation, duplicate effect, or unauthorized execution | Immediate Severity 1 and emergency control. |
| Recovery objectives | Draft RPO 5 minutes; RTO 60 minutes | Must be proven by restore test before approval. |

Error budgets apply only to availability/latency. There is no error budget for supply, replay, authorization, tenant isolation, or reconciliation safety violations.
