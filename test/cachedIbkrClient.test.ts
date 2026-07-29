import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CachedIbkrClient } from "#src/cachedIbkrClient.js";
import type {
  BrokerAccountOrders,
  BrokerClient,
  BrokerOrdersOptions,
} from "#src/brokers/brokerClient.js";

describe("CachedIbkrClient.fetchOrders", () => {
  it("does not cache empty order responses", async () => {
    const stored = new Map<string, BrokerAccountOrders[]>();
    const ordersCache = {
      get: (key: string) => Promise.resolve(stored.get(key) ?? null),
      set: (key: string, value: BrokerAccountOrders[]) => {
        stored.set(key, value);
        return Promise.resolve();
      },
    };
    let fetchCount = 0;
    const responses: BrokerAccountOrders[][] = [
      [{ accountNumber: "test-account", orders: [] }],
      [{ accountNumber: "test-account", orders: [{ orderId: 1, status: "SUBMITTED" }] }],
    ];
    const broker = {
      fetchOrders: () =>
        Promise.resolve(responses[Math.min(fetchCount++, responses.length - 1)] ?? []),
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

    assert.deepEqual(emptyResult[0]?.orders, []);
    assert.equal(populatedResult[0]?.orders[0]?.orderId, 1);
    assert.equal(cachedResult[0]?.orders[0]?.orderId, 1);
    assert.equal(fetchCount, 2);
    assert.equal(stored.size, 1);
  });
});
