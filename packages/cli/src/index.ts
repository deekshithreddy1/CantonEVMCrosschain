#!/usr/bin/env node
import { InterWeave, InterWeaveApiError } from "@interweave/sdk";
export interface CliIo { out(value:string):void; err(value:string):void; env:Readonly<Record<string,string|undefined>> }
export async function runCli(argv:string[],io:CliIo={out:console.log,err:console.error,env:process.env}):Promise<number>{
 const json=argv.includes("--json"),args=argv.filter(x=>x!=="--json");const [command,action,...rest]=args;
 if(command==="auth"){const configured=Boolean(io.env.INTERWEAVE_API_KEY);return output(io,json,{configured},configured?"Authentication configured":"INTERWEAVE_API_KEY is not set",configured?0:1);}
 if(command==="projects")return output(io,json,{status:"available with Phase 30 multi-tenancy"},"Projects require Phase 30 multi-tenancy",0);
 let client:InterWeave;try{client=new InterWeave({apiKey:io.env.INTERWEAVE_API_KEY??"",baseUrl:io.env.INTERWEAVE_BASE_URL});}catch(e){return failure(io,json,e);}
 try{let value:unknown;
  if(command==="networks")value=await client.networks.list();
  else if(command==="assets"&&action==="get")value=await client.assets.get(required(rest[0],"asset ID") as `IW:ASSET:${string}`);
  else if(command==="assets"&&action==="create")value=await client.assets.create(payload(rest));
  else if(command==="balances")value=await client.assets.balance(required(action,"asset ID") as `IW:ASSET:${string}`);
  else if(command==="transfers"&&action==="get")value=await client.transfers.get(required(rest[0],"transfer ID") as `IW:TRANSFER:${string}`);
  else if(command==="transfers"&&action==="create")value=await client.transfers.create(payload(rest));
  else if(command==="bridge"&&action==="get")value=await client.bridge.get(required(rest[0],"bridge ID") as `IW:BRIDGE:${string}`);
  else if(command==="bridge"&&action==="move")value=await client.bridge.move(payload(rest));
  else if(command==="settlements"&&action==="get")value=await client.settlement.get(required(rest[0],"settlement ID") as `IW:SETTLEMENT:${string}`);
  else if(command==="settlements"&&action==="create")value=await client.settlement.create(payload(rest));
  else if(command==="transactions"&&action==="get")value=await client.transactions.get(required(rest[0],"transaction ID") as `IW:TRANSACTION:${string}`);
  else if(command==="attestations"&&action==="get")value=await client.attestations.get(required(rest[0],"attestation ID") as `IW:ATTESTATION:${string}`);
  else if(command==="attestations"&&action==="request")value=await client.attestations.request(payload(rest));
  else if(command==="doctor"){await client.networks.list();value={status:"healthy",api:true,authentication:true};}
  else throw new Error("Unknown command. Use auth, projects, networks, assets, balances, transfers, bridge, settlements, transactions, attestations, or doctor.");
  return output(io,json,value,json?JSON.stringify(value,null,2):format(value),0);
 }catch(e){return failure(io,json,e);}
}
function payload(args:string[]):any{const index=args.indexOf("--data"),raw=args[index+1];if(index<0||!raw)throw new Error("create commands require --data '{...}'");const value:unknown=JSON.parse(raw);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("--data must be a JSON object");return value;}
function required(v:string|undefined,name:string){if(!v)throw new Error(`${name} is required`);return v;} function format(v:unknown){return Array.isArray(v)?v.map(x=>JSON.stringify(x)).join("\n"):JSON.stringify(v,null,2);} function output(io:CliIo,json:boolean,value:unknown,text:string,code:number){io.out(json?JSON.stringify(value):text);return code;} function failure(io:CliIo,json:boolean,e:unknown){const x=e instanceof InterWeaveApiError?{code:e.code,message:e.message,requestId:e.requestId}: {code:"CLI_ERROR",message:e instanceof Error?e.message:String(e)};io.err(json?JSON.stringify({error:x}):`Error: ${x.message}`);return 1;}
if(import.meta.url===`file://${process.argv[1]?.replace(/\\/g,"/")}`)process.exitCode=await runCli(process.argv.slice(2));
