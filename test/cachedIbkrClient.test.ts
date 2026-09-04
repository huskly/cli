import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CachedIbkrClient } from "#src/cachedIbkrClient.js";
import type {
  BrokerAccountOrders,
  BrokerClient,
  BrokerOrdersOptions,
  Observation,
} from "#src/brokers/brokerClient.js";

describe("CachedIbkrClient.fetchOrders", () => {
  it("does not cache empty order responses", async () => {
    const stored = new Map<string, Observation<BrokerAccountOrders[]>>();
    const ordersCache = {
      get: (key: string) => Promise.resolve(stored.get(key) ?? null),
      set: (key: string, value: Observation<BrokerAccountOrders[]>) => {
        stored.set(key, value);
        return Promise.resolve();
      },
    };
    let fetchCount = 0;
    const responses: Observation<BrokerAccountOrders[]>[] = [
      { observedAt: "2026-01-01T00:00:00Z", completeness: "empty", value: [{ accountNumber: "test-account", orders: [] }] },
      { observedAt: "2026-01-01T00:00:00Z", completeness: "available", value: [{ accountNumber: "test-account", orders: [{ orderId: 1, status: "SUBMITTED" }] }] },
    ];
    const broker = {
      fetchOrders: () =>
        Promise.resolve(responses[Math.min(fetchCount++, responses.length - 1)] ?? responses[0]),
    } as unknown as BrokerClient;
    const client = new CachedIbkrClient(() => Promise.resolve(broker), ordersCache);
    const options: BrokerOrdersOptions = {
      fromEnteredTime: new Date("2026-01-01T00:00:00Z"),
      toEnteredTime: new Date("2026-12-31T23:59:59Z"),
      status: "WORKING",
    };

    const emptyResult = await client.fetchOrders(options);
    const populatedResult = await client.fetchOrders(options);
    const cachedResult = await client.fetchOrders(options);

    assert.deepEqual(emptyResult.value[0]?.orders, []);
    assert.equal(populatedResult.value[0]?.orders[0]?.orderId, 1);
    assert.equal(cachedResult.value[0]?.orders[0]?.orderId, 1);
    assert.equal(fetchCount, 2);
    assert.equal(stored.size, 1);
  });
});
