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

import { toIbkrChainDto } from "#src/cli/chain.js";
import type { OptionChainResearch } from "#src/derivatives/derivativeResearch.js";

function ibkrQuote(strike: number, right: "CALL" | "PUT") {
  return {
    contract: {
      identity: {
        assetClass: "OPT",
        underlying: "IBIT",
        expiration: "2026-10-02",
        strike,
        right,
        tradingClass: "IBIT",
        exchange: "SMART",
        multiplier: 100,
      },
      brokerReference: { broker: "ibkr", contractId: "1" },
    },
    dataAvailability: "live",
    timestamp: null,
    bid: 1,
    ask: 2,
    last: 1.4,
    mark: 1.5,
    delta: right === "CALL" ? 0.58 : -0.42,
    impliedVolatility: null,
    volume: 5,
    openInterest: 7,
  };
}

const ibkrResearch = {
  referenceQuote: null,
  center: 43,
  referenceQuoteError: "Derivative contract is incomplete for a reference quote",
  quotes: {
    observedAt: "2026-09-15T18:00:00.000Z",
    completeness: "partial",
    value: [ibkrQuote(43, "CALL"), ibkrQuote(43, "PUT"), ibkrQuote(42, "CALL")],
  },
} as unknown as OptionChainResearch;

void test("an IBKR chain renders through the same table as Schwab", () => {
  const dto = toIbkrChainDto("IBIT", "2026-10-02", ibkrResearch);
  assert.equal(dto.broker, "ibkr");
  assert.equal(dto.expiry, "2026-10-02");
  assert.deepEqual(
    dto.strikes.map((row) => row.strike),
    [42, 43]
  );
  const row = dto.strikes[1];
  assert.ok(row !== undefined);
  assert.ok(row.call !== null && row.put !== null);
  assert.equal(row.call.delta, 0.58);
  assert.equal(row.put.openInterest, 7);
  assert.equal(row.call.mid, 1.5);
});

void test("an IBKR chain keeps the series routing facts Schwab does not expose", () => {
  const dto = toIbkrChainDto("IBIT", "2026-10-02", ibkrResearch);
  assert.deepEqual(dto.series, { tradingClass: "IBIT", exchange: "SMART", multiplier: 100 });
});

void test("a missing underlying price is reported, and never discards the chain", () => {
  const dto = toIbkrChainDto("IBIT", "2026-10-02", ibkrResearch);
  assert.equal(dto.underlyingPrice, null);
  assert.match(String(dto.underlyingPriceError), /incomplete for a reference quote/);
  assert.equal(dto.strikes.length, 2);

  const output = stripAnsi(renderOptionChain(dto));
  assert.match(output, /Underlying price unavailable/);
  assert.match(output, /IBIT · SMART · multiplier 100/);
  assert.match(output, /\$43\.00/);
});

void test("a strike with only one side renders the missing side as dashes", () => {
  const output = stripAnsi(renderOptionChain(toIbkrChainDto("IBIT", "2026-10-02", ibkrResearch)));
  const line = output.split("\n").find((row) => row.includes("$42.00"));
  assert.ok(line !== undefined);
  assert.match(line, /-\s+-\s+-/);
});
