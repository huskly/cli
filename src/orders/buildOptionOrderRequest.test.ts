import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOptionOrderRequest } from "./buildOptionOrderRequest.js";

const occSymbol = "MSTR  260821C00135000";

describe("buildOptionOrderRequest", () => {
  it("builds a single-leg LIMIT sell-to-open order", () => {
    const order = buildOptionOrderRequest({
      occSymbol,
      instruction: "SELL_TO_OPEN",
      quantity: 7,
      orderType: "LIMIT",
      price: 2.3,
    });

    assert.deepEqual(order, {
      session: "NORMAL",
      duration: "DAY",
      orderType: "LIMIT",
      orderStrategyType: "SINGLE",
      price: 2.3,
      orderLegCollection: [
        {
          instruction: "SELL_TO_OPEN",
          quantity: 7,
          instrument: { assetType: "OPTION", symbol: occSymbol },
        },
      ],
    });
  });

  it("omits price for MARKET orders", () => {
    const order = buildOptionOrderRequest({
      occSymbol,
      instruction: "BUY_TO_CLOSE",
      quantity: 1,
      orderType: "MARKET",
    });
    assert.equal(order.price, undefined);
  });

  it("sets stopPrice (not price) for STOP orders", () => {
    const order = buildOptionOrderRequest({
      occSymbol,
      instruction: "BUY_TO_CLOSE",
      quantity: 1,
      orderType: "STOP",
      price: 5,
    });
    assert.equal(order.stopPrice, 5);
    assert.equal(order.price, undefined);
  });

  it("defaults session and duration when omitted", () => {
    const order = buildOptionOrderRequest({
      occSymbol,
      instruction: "SELL_TO_OPEN",
      quantity: 1,
      orderType: "MARKET",
      session: "AM",
      duration: "GOOD_TILL_CANCEL",
    });
    assert.equal(order.session, "AM");
    assert.equal(order.duration, "GOOD_TILL_CANCEL");
  });
});
