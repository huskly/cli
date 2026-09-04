import assert from "node:assert/strict";
import test from "node:test";
import { renderAccountObservation } from "#src/cli/account.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

test("account renderer warns on partial data and shows missing numeric evidence", () => {
  const output = stripAnsi(
    renderAccountObservation({
      observedAt: "2026-09-04T00:00:00.000Z",
      completeness: "partial",
      value: {
        liquidationValue: 10,
        equity: 9,
        cashBalance: null,
        marginBalance: null,
        availableFunds: 4,
        buyingPower: null,
      },
    })
  );
  assert.match(output, /Warning: Broker data is partial/);
  assert.match(output, /Cash Balance:\s+-/);
  assert.match(output, /Buying Power:\s+-/);
});

test("account renderer keeps observation metadata in JSON output", () => {
  const output: unknown = JSON.parse(
    renderAccountObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "partial",
        value: {
          liquidationValue: 1,
          equity: 1,
          cashBalance: 1,
          availableFunds: 1,
          buyingPower: 1,
        },
      },
      true
    )
  );
  const parsed = output as { observedAt: string; completeness: string };
  assert.equal(parsed.observedAt, "2026-09-04T00:00:00.000Z");
  assert.equal(parsed.completeness, "partial");
});
