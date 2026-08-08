declare module "node:assert/strict" { const assert: { equal(a: unknown, b: unknown): void; deepEqual(a: unknown, b: unknown): void; doesNotThrow(fn: () => void): void; throws(fn: () => void, expected?: RegExp): void; rejects(fn: () => Promise<unknown>, expected?: RegExp): Promise<void> }; export default assert; }
declare module "node:test" { type Test = (name: string, fn: () => void) => void; const test: Test; export default test; }
declare module "node:crypto" { export function createHash(algorithm: string): { update(data: string | Uint8Array): { digest(encoding: "hex"): string } }; }
