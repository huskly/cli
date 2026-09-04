import assert from "node:assert/strict";
import test from "node:test";
import { renderTransactionObservation } from "#src/cli/transactions.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};
const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2026-01-31T00:00:00Z");

test("transactions renderer warns on partial data and shows missing numbers", () => {
  const output = stripAnsi(
    renderTransactionObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "partial",
        value: [
          {
            accountNumber: "acct",
            transactions: [
              {
                activityId: "1",
                time: "2026-01-02T12:00:00Z",
                type: "TRADE",
                status: "VALID",
                netAmount: null,
                transferItems: [
                  { instrument: { assetType: "EQUITY", symbol: "AAPL" }, amount: null },
                ],
              },
            ],
          },
        ],
      },
      {},
      start,
      end
    )
  );
  assert.match(output, /Warning: Broker data is partial/);
  assert.match(output, /AAPL/);
  assert.match(output, /-\s+\s/);
});

test("transactions renderer keeps observation metadata in JSON output", () => {
  const output: unknown = JSON.parse(
    renderTransactionObservation(
      { observedAt: "2026-09-04T00:00:00.000Z", completeness: "partial", value: [] },
      { json: true },
      start,
      end
    )
  );
  const parsed = output as { observedAt: string; completeness: string };
  assert.equal(parsed.observedAt, "2026-09-04T00:00:00.000Z");
  assert.equal(parsed.completeness, "partial");
});
