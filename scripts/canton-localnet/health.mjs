import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),config=JSON.parse(await readFile(path.join(root,"config/canton/digital-asset-localnet.json"),"utf8"));
async function http(name,url){try{const r=await fetch(url,{signal:AbortSignal.timeout(3000)});return{name,url,ready:r.ok,status:r.status};}catch(error){return{name,url,ready:false,error:error instanceof Error?error.name:"UNKNOWN"};}}
function tcp(name,port){return new Promise(resolve=>{const socket=connect({host:"127.0.0.1",port});const done=ready=>{socket.destroy();resolve({name,port,ready});};socket.setTimeout(3000);socket.once("connect",()=>done(true));socket.once("timeout",()=>done(false));socket.once("error",()=>done(false));});}
const checks=await Promise.all([http("app-provider-validator",config.appProvider.readinessUrl),http("app-user-validator",config.appUser.readinessUrl),http("super-validator",config.superValidator.readinessUrl),tcp("app-provider-ledger-api",config.appProvider.ledgerApiPort),tcp("app-provider-json-ledger-api",config.appProvider.jsonLedgerApiPort)]),report={status:checks.every(x=>x.ready)?"READY":"NOT_READY",checks};console.log(JSON.stringify(report,null,2));if(process.argv.includes("--require-ready")&&report.status!=="READY")throw new Error("Digital Asset Canton LocalNet is not ready");
