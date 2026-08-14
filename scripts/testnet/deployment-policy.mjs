import { readFile } from "node:fs/promises";

export async function loadTarget(file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  if (value.allowProduction !== false || !["testnet", "devnet"].includes(value.environment)) throw new Error("production deployment is prohibited by this tool");
  if (!value.name || !value.confirmPhrase) throw new Error("deployment target is incomplete");
  return value;
}
export function requireConfirmation(target, supplied) { if (supplied !== target.confirmPhrase) throw new Error(`explicit confirmation required: ${target.confirmPhrase}`); }
export function assertNonProductionChain(chainId) { if ([1n, 137n, 42161n, 10n, 8453n].includes(BigInt(chainId))) throw new Error("production chain deployment is prohibited"); }
export function redactUrl(value) { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; return url.toString(); }
