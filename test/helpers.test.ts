import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOccOptionSymbol, ensureFloat, parseOccSymbol } from "#src/helpers.js";

describe("buildOccOptionSymbol", () => {
  it("builds a call symbol", () => {
    const symbol = buildOccOptionSymbol("MSTR", new Date(2026, 7, 21), "CALL", 135);
    assert.equal(symbol, "MSTR  260821C00135000");
  });

  it("builds a put symbol", () => {
    const symbol = buildOccOptionSymbol("AAPL", new Date(2025, 11, 19), "PUT", 195);
    assert.equal(symbol, "AAPL  251219P00195000");
  });

  it("round-trips through parseOccSymbol", () => {
    const symbol = buildOccOptionSymbol("AAPL", new Date(2025, 11, 19), "CALL", 195);
    assert.equal(parseOccSymbol(symbol), "AAPL Dec 19 2025 195 C");
  });

  it("handles fractional strikes and short roots", () => {
    const symbol = buildOccOptionSymbol("SPX", new Date(2026, 0, 2), "PUT", 4500.5);
    assert.equal(symbol, "SPX   260102P04500500");
  });

  it("throws for underlyings longer than the 6-character OCC root", () => {
    assert.throws(() => buildOccOptionSymbol("TOOLONGSYM", new Date(2026, 7, 21), "CALL", 100));
  });
});

describe("ensureFloat", () => {
  it("accepts a well-formed positive decimal string", () => {
    assert.equal(ensureFloat("2.30"), 2.3);
  });

  it("rejects trailing-garbage strings instead of truncating them (parseFloat pitfall)", () => {
    assert.throws(() => ensureFloat("2.30oops"));
  });

  it("rejects comma-formatted numbers instead of truncating them (parseFloat pitfall)", () => {
    assert.throws(() => ensureFloat("1,000"));
  });

  it("rejects empty and whitespace-only strings (parseFloat('') is NaN but Number('') is 0)", () => {
    assert.throws(() => ensureFloat(""));
    assert.throws(() => ensureFloat("   "));
  });

  it("rejects zero and negative values", () => {
    assert.throws(() => ensureFloat("0"));
    assert.throws(() => ensureFloat("-5"));
  });
});
