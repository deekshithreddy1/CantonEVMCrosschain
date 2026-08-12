import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];
if (command !== "build" && command !== "test") throw new Error("usage: node scripts/run-daml.mjs <build|test>");
const result = spawnSync("daml", [command], {
  cwd: path.join(root, "contracts", "daml"),
  env: { ...process.env, DAML_SDK_VERSION: "2.10.2" },
  encoding: "utf8",
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
