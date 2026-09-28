import assert from "node:assert/strict";
import test from "node:test";
import { parseForexPair } from "../../src/forex/forexPair.js";

test("accepts BASE.QUOTE, BASE/QUOTE, and BASEQUOTE and normalizes to BASE.QUOTE", () => {
  for (const value of ["USD.JPY", "USD/JPY", "USDJPY", " usd.jpy ", "usdjpy"]) {
    assert.deepEqual(parseForexPair(value), { base: "USD", quote: "JPY", pair: "USD.JPY" }, value);
  }
});

test("rejects bad currency codes and other forms", () => {
  for (const value of [
    "",
    "USD",
    "US.JPY",
    "USD.JP",
    "USD-JPY",
    "USD.JPY.X",
    "USD JPY",
    "U5D.JPY",
  ]) {
    assert.throws(() => parseForexPair(value), /Invalid FX pair/, value);
  }
});

test("rejects a pair whose base equals its quote", () => {
  for (const value of ["USD.USD", "USDUSD", "usd/usd"]) {
    assert.throws(() => parseForexPair(value), /base and quote are the same/, value);
  }
});
