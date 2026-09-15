import assert from "node:assert/strict";
import test from "node:test";
import chalk from "chalk";

// Tests run without a TTY, so chalk would emit plain text and the shading
// assertions would pass vacuously. Force basic colour for this file.
chalk.level = 1;
import {
  estimateUnderlying,
  moneynessReference,
  renderOptionChain,
  toOptionChainDto,
} from "#src/cli/chain.js";
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

/** Extract the ANSI background codes on each side of one rendered strike row. */
function shading(output: string, strike: string): string[] {
  const line = output.split("\n").find((row) => row.includes(strike));
  // 41 is the put shade and 42 the call shade; 49 is only the reset.
  const background = new RegExp(`${String.fromCharCode(27)}\\[(41|42)m`, "g");
  return line === undefined ? [] : [...line.matchAll(background)].map((match) => match[1] ?? "");
}

void test("moneyness uses the broker price when the broker gives one", () => {
  const dto = toOptionChainDto("AAPL", expiry, chain, 110, 110, 10);
  assert.deepEqual(moneynessReference(dto), { price: 110, estimated: false });
});

void test("put-call parity implies the underlying when the broker cannot price it", () => {
  // call - put = underlying - strike, so 3.00 - 1.00 at strike 100 implies 102.
  const strikes = [
    { strike: 95, call: { mid: 7.4 }, put: { mid: 0.4 } },
    { strike: 100, call: { mid: 3 }, put: { mid: 1 } },
    { strike: 105, call: { mid: 1.1 }, put: { mid: 4.1 } },
  ] as unknown as Parameters<typeof estimateUnderlying>[0];
  assert.equal(estimateUnderlying(strikes), 102);
});

void test("parity estimation needs both legs and reports null otherwise", () => {
  const callsOnly = [{ strike: 100, call: { mid: 3 }, put: null }] as unknown as Parameters<
    typeof estimateUnderlying
  >[0];
  assert.equal(estimateUnderlying(callsOnly), null);
  assert.equal(estimateUnderlying([]), null);
});

void test("an IBKR chain without a broker price still marks moneyness, flagged as estimated", () => {
  const dto = toIbkrChainDto("IBIT", "2026-10-02", ibkrResearch);
  const reference = moneynessReference(dto);
  assert.equal(reference?.estimated, true);

  const output = renderOptionChain(dto);
  assert.match(output, /≈\$/);
});

void test("in-the-money calls and puts are shaded on opposite sides of the underlying", () => {
  const dto = toOptionChainDto("AAPL", expiry, chain, 112, 112, 10);
  const output = renderOptionChain(dto);

  // Below the underlying the call is in the money; above it the put is.
  assert.deepEqual(shading(output, "$105.00"), ["42"]);
  assert.deepEqual(shading(output, "$110.00"), ["42"]);
  assert.deepEqual(shading(output, "$115.00"), ["41"]);
  assert.deepEqual(shading(output, "$120.00"), ["41"]);
});

void test("the table marks where the underlying sits and explains the shading", () => {
  const output = stripAnsi(
    renderOptionChain(toOptionChainDto("AAPL", expiry, chain, 112, 112, 10))
  );
  assert.match(output, /·+ \$112\.00 ·+/);
  assert.match(output, /ITM {2}in the money/);
  assert.match(output, /underlying \$112\.00/);
});

void test("an unknown underlying says so instead of guessing moneyness", () => {
  const noPairs = toOptionChainDto(
    "AAPL",
    expiry,
    chain.filter((quote) => quote.isCall),
    null,
    null,
    10
  );
  const output = stripAnsi(renderOptionChain(noPairs));
  assert.match(output, /Moneyness unknown: no underlying price available/);
});
