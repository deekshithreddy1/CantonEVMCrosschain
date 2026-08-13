import assert from "node:assert/strict";
import test from "node:test";
import type { CrossNetworkSettlementActions, CrossNetworkSettlementRequest, CrossNetworkSettlementState, SettlementStepEvidence } from "./cross-network-settlement.js";
import { CrossNetworkSettlementService, InMemoryCrossNetworkSettlementStore } from "./cross-network-settlement.js";

const request: CrossNetworkSettlementRequest = {
  id: "IW:SETTLEMENT:rwa-usdc", idempotencyKey: "rwa-usdc", policyVersion: "settlement-v1",
  delivery: { networkId: "IW:NETWORK:canton", assetId: "IW:ASSET:rwa", sender: "IW:IDENTITY:alice", receiver: "IW:IDENTITY:bob", amount: "10" },
  payment: { networkId: "IW:NETWORK:ethereum", assetId: "IW:ASSET:usdc", sender: "IW:IDENTITY:bob", receiver: "IW:IDENTITY:alice", amount: "1000" },
  createdAt: "2026-08-12T12:00:00.000Z", expiresAt: "2026-08-12T13:00:00.000Z"
};
const evidence = (name: string): SettlementStepEvidence => ({ transactionId: `${name}-tx`, position: `${name}-position`, evidence: [`${name}-proof`], observedAt: "2026-08-12T12:01:00.000Z" });
function fixture(failAt?: string, now = "2026-08-12T12:05:00.000Z") {
  const calls: string[] = [];
  const action = async (name: string) => { calls.push(name); if (name === failAt) throw new Error(`${name} failed`); return evidence(name); };
  const actions: CrossNetworkSettlementActions = {
    reserveDelivery: () => action("reserveDelivery"), verifyDeliveryReservation: () => action("verifyDeliveryReservation"),
    reserveOrTransferPayment: () => action("reserveOrTransferPayment"), verifyPaymentFinality: () => action("verifyPaymentFinality"),
    attestPayment: () => action("attestPayment"), releaseDelivery: () => action("releaseDelivery"), verifyDelivery: () => action("verifyDelivery"),
    reconcile: async () => { calls.push("reconcile"); if (failAt === "reconcile") return { outcome: "MISMATCH", evidence: ["mismatch"] }; return { outcome: "MATCH", evidence: ["matched"] }; },
    cancelDeliveryReservation: () => action("cancelDeliveryReservation")
  };
  return { service: new CrossNetworkSettlementService(new InMemoryCrossNetworkSettlementStore(), { check: async () => ({ outcome: "ALLOW", evidence: ["policy-proof"], reason: "allowed" }) }, actions, () => new Date(now)), calls };
}

test("Canton RWA for Ethereum USDC follows the explicit non-atomic saga", async () => {
  const value = fixture(); const result = await value.service.execute(request);
  assert.equal(result.state, "COMPLETED"); assert.equal(result.guarantee, "CROSS_NETWORK_SAGA_NON_ATOMIC");
  assert.deepEqual(result.transitions.map((item) => item.state), ["CREATED", "POLICY_CHECKED", "DELIVERY_RESERVED", "DELIVERY_RESERVATION_VERIFIED", "PAYMENT_SUBMITTED", "PAYMENT_FINALIZED", "PAYMENT_ATTESTED", "DELIVERY_RELEASED", "DELIVERY_FINALIZED", "RECONCILED", "COMPLETED"]);
});

test("failure before payment finality cancels the delivery reservation", async () => {
  const value = fixture("verifyPaymentFinality"); const result = await value.service.execute(request);
  assert.equal(result.state, "COMPENSATED"); assert.equal(result.compensation, "CANCEL_DELIVERY_BEFORE_PAYMENT_FINALITY_ONLY");
  assert.equal(value.calls.at(-1), "cancelDeliveryReservation");
});

test("failure after payment finality never attempts unsafe automatic reversal", async () => {
  const value = fixture("releaseDelivery"); const result = await value.service.execute(request);
  assert.equal(result.state, "MANUAL_REVIEW"); assert.equal(value.calls.includes("cancelDeliveryReservation"), false);
  assert.match(result.transitions.at(-1)?.reason ?? "", /post-payment-finality/);
});

test("reconciliation mismatch cannot complete settlement", async () => {
  const result = await fixture("reconcile").service.execute(request);
  assert.equal(result.state, "MANUAL_REVIEW"); assert.equal(result.transitions.some((item) => item.state === "COMPLETED"), false);
});

test("timeout behavior respects the irreversible payment-finality boundary", async () => {
  const pre = fixture(undefined, "2026-08-12T13:01:00.000Z"); assert.equal((await pre.service.execute({ ...request, id: "IW:SETTLEMENT:expired-pre" })).state, "EXPIRED");
  const store = new InMemoryCrossNetworkSettlementStore(); const value = fixture();
  const partial = await store.create(request, "hash", { sequence: 0, state: "CREATED", occurredAt: request.createdAt, evidence: [], reason: "created" });
  await store.transition(request.id, partial.version, { sequence: 1, state: "PAYMENT_FINALIZED", occurredAt: request.createdAt, evidence: ["final"], reason: "final" });
  const service = new CrossNetworkSettlementService(store, value.service.policy, value.service.actions, () => new Date("2026-08-12T13:01:00.000Z"));
  const saved = await store.get(request.id); assert.ok(saved); saved.requestHash = (await import("./idempotency.js")).requestFingerprint(request); store.records.set(request.id, saved);
  assert.equal((await service.execute(request)).state, "MANUAL_REVIEW");
});

test("same-network and non-reciprocal requests are rejected", async () => {
  const service = fixture().service;
  await assert.rejects(service.execute({ ...request, payment: { ...request.payment, networkId: request.delivery.networkId } }), /different networks/);
  await assert.rejects(service.execute({ ...request, payment: { ...request.payment, receiver: "IW:IDENTITY:carol" } }), /reciprocal/);
});
