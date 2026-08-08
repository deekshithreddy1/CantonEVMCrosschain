declare module "node:assert/strict" { const assert: { equal(a: unknown, b: unknown): void; doesNotThrow(fn: () => void): void; throws(fn: () => void, expected?: RegExp): void }; export default assert; }
declare module "node:test" { type Test = (name: string, fn: () => void) => void; const test: Test; export default test; }
