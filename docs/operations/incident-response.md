# Incident response

Severity 1 includes suspected excess supply, threshold/signer/admin compromise, tenant data exposure, finality failure after destination execution, or lost control of a production ledger role. Severity 2 includes sustained dependency outage, reconciliation uncertainty without known excess supply, or degraded validator quorum.

For Severity 1: page the incident commander and security lead; activate the narrowest safe controls; preserve volatile and durable evidence; establish an out-of-band channel; revoke compromised access; notify ledger, custody, compliance, legal, and customer owners; reconcile independently; and publish an approved timeline. No single responder may both remediate and approve reopening.

Every incident record contains detection time, scope, control IDs, decisions, actors, ledger positions, affected tenants/assets, key exposure window, evidence hashes, notifications, recovery validation, and follow-up owners. Post-incident review produces tracked corrective actions and adds the exact failure to automated tests where possible.
