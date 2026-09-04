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
