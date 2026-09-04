import assert from "node:assert/strict";
import test from "node:test";
import { renderSearchObservation } from "#src/cli/search.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

test("search renderer reports a true empty result", () => {
  const output = stripAnsi(
    renderSearchObservation(
      { observedAt: "2026-09-04T00:00:00.000Z", completeness: "empty", value: [] },
      "ibkr",
      "AAPL",
      { projection: "search" }
    )
  );
  assert.match(output, /No instruments found matching "AAPL"/);
});

test("search renderer warns on partial data", () => {
  const output = stripAnsi(
    renderSearchObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "partial",
        value: [{ symbol: "AAPL", description: "Apple Inc." }],
      },
      "ibkr",
      "AAPL",
      { projection: "search" }
    )
  );
  assert.match(output, /Warning: Broker data is partial/);
});
