import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractOccSymbol } from "#src/ibkr/ibkrClient.js";
import { IbkrClient } from "#src/ibkr/ibkrClient.js";
import { parseOccSymbol } from "#src/helpers.js";
import type { IbkrLiveOrdersResponse } from "#src/ibkr/ibkrApiTypes.js";

describe("extractOccSymbol", () => {
  it("extracts the OCC symbol from a put contractDesc", () => {
    const contractDesc = "STRC   JUL2026 95 P [STRC  260717P00095000 100]";
    assert.equal(extractOccSymbol(contractDesc), "STRC  260717P00095000");
  });

  it("extracts the OCC symbol from a call contractDesc", () => {
    const contractDesc = "AAPL   JAN2027 150 C [AAPL  270115C00150000 100]";
    assert.equal(extractOccSymbol(contractDesc), "AAPL  270115C00150000");
  });

  it("round-trips through parseOccSymbol into the same human-readable format Schwab uses", () => {
    const contractDesc = "STRC   JUL2026 95 P [STRC  260717P00095000 100]";
    const occSymbol = extractOccSymbol(contractDesc);
    assert.ok(occSymbol);
    assert.equal(parseOccSymbol(occSymbol), "STRC Jul 17 2026 95 P");
  });

  it("returns undefined for an equity contractDesc with no bracketed OCC symbol", () => {
    assert.equal(extractOccSymbol("PFXF"), undefined);
  });

  it("returns undefined when the bracket is missing the trailing multiplier", () => {
    assert.equal(extractOccSymbol("STRC   JUL2026 95 P [STRC  260717P00095000]"), undefined);
  });

  it("returns undefined for a malformed bracket contents", () => {
    assert.equal(extractOccSymbol("SOME DESC [not an occ symbol 100]"), undefined);
  });
});

describe("IbkrClient.fetchOrders", () => {
  it("treats all active IBKR statuses as WORKING", async () => {
    const client = Object.create(IbkrClient.prototype) as IbkrClient;
    let requestParams: Record<string, string | boolean> | undefined;
    Reflect.set(client, "getAccountId", () => Promise.resolve("test-account"));
    Reflect.set(client, "prepareBrokerageAccount", () => Promise.resolve());
    Reflect.set(
      client,
      "req",
      (request: { params?: Record<string, string | boolean> }): Promise<IbkrLiveOrdersResponse> => {
        requestParams = request.params;
        return Promise.resolve({
          orders: [
            { account: "test-account", orderId: 1, status: "ApiPending" },
            { account: "test-account", orderId: 2, status: "PendingSubmit" },
            { account: "test-account", orderId: 3, status: "PreSubmitted" },
            { account: "test-account", orderId: 4, status: "Submitted" },
            { account: "test-account", orderId: 5, status: "PendingCancel" },
            { account: "test-account", orderId: 6, status: "Filled" },
            { account: "test-account", orderId: 7, status: "Cancelled" },
            { account: "test-account", orderId: 8, status: "Inactive" },
          ],
        });
      }
    );

    const result = await client.fetchOrders({
      fromEnteredTime: new Date("2026-01-01T00:00:00Z"),
      toEnteredTime: new Date("2026-12-31T23:59:59Z"),
      status: "WORKING",
    });

    assert.deepEqual(requestParams, {});
    assert.deepEqual(
      result[0]?.orders.map(({ orderId }) => orderId),
      [1, 2, 3, 4, 5]
    );
  });
});
