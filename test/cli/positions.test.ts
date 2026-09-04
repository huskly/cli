import assert from "node:assert/strict";
import test from "node:test";
import { renderPositionsObservation } from "#src/cli/positions.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

test("positions renderer reports a true empty result", () => {
  const output = stripAnsi(
    renderPositionsObservation({
      observedAt: "2026-09-04T00:00:00.000Z",
      completeness: "empty",
      value: [],
    })
  );
  assert.match(output, /No positions found/);
});

test("positions renderer shows partial warning and dashes for missing numbers", () => {
  const output = stripAnsi(
    renderPositionsObservation({
      observedAt: "2026-09-04T00:00:00.000Z",
      completeness: "partial",
      value: [
        {
          instrument: { assetType: "EQUITY", symbol: "AAPL" },
          longQuantity: null,
          shortQuantity: 0,
          averagePrice: null,
          marketValue: null,
          currentDayProfitLoss: null,
          longOpenProfitLoss: null,
          shortOpenProfitLoss: null,
        },
      ],
    })
  );
  assert.match(output, /Warning: Broker data is partial/);
  assert.match(output, /AAPL/);
  assert.match(output, /-\s+-\s+-/);
});
