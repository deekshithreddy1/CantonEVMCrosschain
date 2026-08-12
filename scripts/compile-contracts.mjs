import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = path.join(root, "contracts", "ethereum");

function solidityFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? solidityFiles(path.join(directory, entry.name))
    : entry.name.endsWith(".sol") ? [path.join(directory, entry.name)] : []);
}

export function compileContracts() {
  const sources = Object.fromEntries(solidityFiles(contractsRoot).map((file) => [path.relative(root, file).replaceAll("\\", "/"), { content: fs.readFileSync(file, "utf8") }]));
  const input = { language: "Solidity", sources, settings: { evmVersion: "shanghai", optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: (name) => {
    const candidates = [path.join(root, "node_modules", name), path.join(root, name), path.join(contractsRoot, name)];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    return found ? { contents: fs.readFileSync(found, "utf8") } : { error: `Import not found: ${name}` };
  } }));
  const errors = (output.errors ?? []).filter((item) => item.severity === "error");
  if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  return output.contracts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contracts = compileContracts();
  const count = Object.values(contracts).reduce((sum, file) => sum + Object.keys(file).length, 0);
  process.stdout.write(`Compiled ${count} Solidity contracts with solc ${solc.version()}\n`);
}
