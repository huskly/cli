import assert from "node:assert/strict";
import test from "node:test";
import { renderQuoteObservation } from "#src/cli/quote.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

test("quote renderer warns on partial data and shows missing values as dashes", () => {
  const output = stripAnsi(
    renderQuoteObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "partial",
        value: {
          AAPL: {
            symbol: "AAPL",
            reference: { description: "Apple" },
            quote: { lastPrice: null, bidPrice: null, askPrice: 190 },
          },
        },
      },
      ["AAPL"]
    )
  );
  assert.match(output, /Warning: Broker data is partial/);
  assert.match(output, /Last:\s+\$-/);
  assert.match(output, /Bid\/Ask:\s+\$- \/ \$190.00/);
});

test("quote renderer keeps observation metadata in JSON output", () => {
  const output: unknown = JSON.parse(
    renderQuoteObservation(
      { observedAt: "2026-09-04T00:00:00.000Z", completeness: "partial", value: {} },
      ["AAPL"],
      true
    )
  );
  const parsed = output as { observedAt: string; completeness: string };
  assert.equal(parsed.observedAt, "2026-09-04T00:00:00.000Z");
  assert.equal(parsed.completeness, "partial");
});
