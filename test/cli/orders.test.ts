import assert from "node:assert/strict";
import test from "node:test";
import { renderOrdersObservation } from "#src/cli/orders.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};
const fromDate = new Date("2026-01-01T00:00:00Z");
const toDate = new Date("2026-01-31T00:00:00Z");

test("orders renderer reports a true empty result", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      { observedAt: "2026-09-04T00:00:00.000Z", completeness: "empty", value: [] },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );
  assert.match(output, /No IBKR accounts found/);
});

test("orders renderer warns on partial data and shows missing numeric evidence", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "partial",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "WORKING",
                orderType: "LMT",
                quantity: null,
                filledQuantity: null,
                price: null,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "BUY" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );
  assert.match(output, /Warning: Broker data is partial/);
  assert.match(output, /AAPL/);
  assert.match(output, /\s-\s+\s-\s+\s-/);
});

test("orders renderer shows the stop price when the regular price is null", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "available",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "PRE_SUBMITTED",
                orderType: "STOP",
                quantity: 100,
                filledQuantity: 0,
                price: null,
                stopPrice: 42.5,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "SELL" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );

  assert.match(output, /Stop: \$42\.50/);
});

test("orders renderer shows separate time-in-force and session columns", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "available",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-03T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                tif: "GTC",
                session: "OVERNIGHT",
                quantity: 10,
                filledQuantity: 0,
                price: 42.5,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "BUY" }],
              },
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                tif: "DAY",
                session: "REGULAR",
                quantity: 5,
                filledQuantity: 0,
                price: 40,
                orderLegCollection: [{ instrument: { symbol: "MSFT" }, instruction: "SELL" }],
              },
              {
                enteredTime: "2026-01-01T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                tif: "IOC",
                session: "UNKNOWN",
                quantity: 1,
                filledQuantity: 0,
                price: 10,
                orderLegCollection: [{ instrument: { symbol: "NVDA" }, instruction: "BUY" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );

  assert.match(output, /Type\s+TIF\s+Session\s+Symbol/);
  assert.match(output, /LIMIT\s+GTC\s+OVERNIGHT\s+AAPL/);
  assert.match(output, /LIMIT\s+DAY\s+REGULAR\s+MSFT/);
  assert.match(output, /LIMIT\s+IOC\s+-\s+NVDA/);
});

test("orders renderer shows dashes for missing order timing evidence", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "available",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                quantity: 1,
                filledQuantity: 0,
                price: 10,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "BUY" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );

  assert.match(output, /LIMIT\s+-\s+-\s+AAPL/);
});
