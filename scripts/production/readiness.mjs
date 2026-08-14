import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),manifest=JSON.parse(await readFile(path.join(root,"config/production/readiness.json"),"utf8"));
if(manifest.environment!=="production"||manifest.automaticPromotion!==false)throw new Error("production manifest must prohibit automatic promotion");
const required=["independent-security-review","smart-contract-audit","daml-authorization-review","cross-network-protocol-review","key-management-review","operational-runbooks","incident-response","backup-restore-test","reconciliation-procedure","network-outage-procedure","validator-compromise-procedure","contract-pause-procedure","upgrade-governance","slos","monitoring","alerts","live-testnet-qualification"];
for(const id of required)if(!manifest.gates.some(g=>g.id===id))throw new Error(`missing production gate: ${id}`);
for(const gate of manifest.gates){if(!["PENDING","EVIDENCED","APPROVED"].includes(gate.status))throw new Error(`invalid gate status: ${gate.id}`);for(const reference of gate.evidence){const file=reference.split("#")[0];await access(path.join(root,file));}}
const pending=manifest.gates.filter(g=>g.status!=="APPROVED").map(g=>g.id),report={status:pending.length?"NOT_READY":"READY",automaticPromotion:false,approved:manifest.gates.filter(g=>g.status==="APPROVED").length,documented:manifest.gates.filter(g=>g.status==="EVIDENCED").length,awaitingEvidence:manifest.gates.filter(g=>g.status==="PENDING").map(g=>g.id),total:manifest.gates.length,awaitingApproval:pending};console.log(JSON.stringify(report,null,2));
if(process.argv.includes("--assert-ready")&&pending.length)throw new Error(`production readiness blocked by ${pending.length} gate(s)`);
