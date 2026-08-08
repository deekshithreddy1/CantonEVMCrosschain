import type { AtomicAmount, BridgeOperation, StateTransition } from "./model.js";

export function parseAtomicAmount(value: AtomicAmount): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("amount must be a non-negative base-10 integer string");
  return BigInt(value);
}

export function assertPositiveAmount(value: AtomicAmount): void {
  if (parseAtomicAmount(value) <= 0n) throw new Error("amount must be positive");
}

export function assertBridgeOperation(operation: BridgeOperation): void {
  assertPositiveAmount(operation.amount);
  if (operation.sourceNetworkId === operation.destinationNetworkId) throw new Error("bridge networks must differ");
  if (operation.idempotencyKey.trim() === "") throw new Error("idempotency key is required");
  const latest = operation.transitions.at(-1);
  if (!latest || latest.to !== operation.state) throw new Error("current state must match the latest persisted transition");
}

export function assertTransitionChain(transitions: readonly StateTransition[]): void {
  transitions.forEach((transition, index) => {
    const previous = transitions[index - 1];
    if (index === 0 && transition.from !== null) throw new Error("first transition must start from null");
    if (index > 0 && transition.from !== previous?.to) throw new Error(`disconnected transition at index ${index}`);
  });
}

export function assertSupplyInvariant(destinationSupply: AtomicAmount, verifiedBacking: AtomicAmount): void {
  if (parseAtomicAmount(destinationSupply) > parseAtomicAmount(verifiedBacking)) throw new Error("destination supply exceeds verified backing");
}
