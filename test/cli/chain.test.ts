import assert from "node:assert/strict";
import test from "node:test";
import { renderOptionChain, toOptionChainDto } from "#src/cli/chain.js";
import type { OptionQuote } from "@huskly/schwab-client";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

const expiry = new Date(2026, 0, 16);

function leg(strike: number, isCall: boolean): OptionQuote {
  return {
    symbol: `AAPL  260116${isCall ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
    expiry,
    strike,
    isCall,
    bid: 1,
    ask: 2,
    mid: 1.5,
    delta: isCall ? 0.5 : -0.5,
    volume: 10,
    openInterest: 20,
    quoteTime: null,
    tradeTime: null,
    delayed: true,
  };
}

const chain = [100, 105, 110, 115, 120].flatMap((strike) => [
  leg(strike, true),
  leg(strike, false),
]);

test("option chain DTO keeps the requested strike count on each side of center", () => {
  const dto = toOptionChainDto("AAPL", expiry, chain, 110, 110, 1);
  assert.deepEqual(
    dto.strikes.map((row) => row.strike),
    [105, 110, 115]
  );
  assert.equal(dto.expiry, "2026-01-16");
  assert.equal(dto.underlyingPrice, 110);
});

test("option chain DTO keeps every strike when there is no center price", () => {
  const dto = toOptionChainDto("AAPL", expiry, chain, null, null, 1);
  assert.equal(dto.strikes.length, 5);
});

test("option chain DTO exposes volume, open interest, and delayed data that the table drops", () => {
  const dto = toOptionChainDto("AAPL", expiry, chain, 110, 110, 0);
  assert.equal(dto.delayed, true);
  const row = dto.strikes[0];
  assert.ok(row !== undefined);
  assert.equal(row.call?.openInterest, 20);
  assert.equal(row.put?.volume, 10);
});

test("option chain renderer reports an empty expiry instead of an empty table", () => {
  const dto = toOptionChainDto("AAPL", expiry, [], null, null, 10);
  assert.match(stripAnsi(renderOptionChain(dto)), /No options found for this expiry/);
});

test("option chain renderer prints one row per selected strike", () => {
  const output = stripAnsi(renderOptionChain(toOptionChainDto("AAPL", expiry, chain, 110, 110, 1)));
  assert.match(output, /\$105\.00/);
  assert.match(output, /\$110\.00/);
  assert.doesNotMatch(output, /\$120\.00/);
});
