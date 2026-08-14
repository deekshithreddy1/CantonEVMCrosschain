import assert from "node:assert/strict";import test from "node:test";import {runCli}from"./index.js";
function io(env:Record<string,string|undefined>={}){const out:string[]=[],err:string[]=[];return{value:{env,out:(x:string)=>out.push(x),err:(x:string)=>err.push(x)},out,err};}
test("auth reports environment configuration in JSON",async()=>{const x=io({INTERWEAVE_API_KEY:"x"});assert.equal(await runCli(["auth","--json"],x.value),0);assert.deepEqual(JSON.parse(x.out[0]!),{configured:true});});
test("projects clearly identifies its phase boundary",async()=>{const x=io();assert.equal(await runCli(["projects"],x.value),0);assert.match(x.out[0]!,/Phase 30/);});
test("unknown command and missing credentials fail consistently",async()=>{const x=io();assert.equal(await runCli(["networks","--json"],x.value),1);assert.equal(JSON.parse(x.err[0]!).error.code,"CLI_ERROR");});
