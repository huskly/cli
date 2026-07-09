import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractOccSymbol } from "#src/ibkr/ibkrClient.js";
import { parseOccSymbol } from "#src/helpers.js";

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
