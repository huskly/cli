import test from "node:test";
import assert from "node:assert/strict";
import type { DerivativeQuote, DerivativeRight } from "./derivativeDiscovery.js";
import { buildVerticalSpread, type VerticalSpreadKind } from "./verticalSpread.js";

interface QuoteInput {
  strike: number;
  right: DerivativeRight;
  bid: number | null;
  ask: number | null;
  delta?: number | null;
  multiplier?: number;
  tradingClass?: string;
}

function quote(input: QuoteInput): DerivativeQuote {
  return {
    contract: {
      identity: {
        assetClass: input.multiplier === 100 ? "OPT" : "FOP",
        underlying: input.multiplier === 100 ? "NDX" : "NQ",
        expiration: "2026-08-21",
        strike: input.strike,
        right: input.right,
        tradingClass: input.tradingClass ?? (input.multiplier === 100 ? "NDXP" : "QN3"),
        exchange: input.multiplier === 100 ? "SMART" : "CME",
        multiplier: input.multiplier ?? 20,
      },
      brokerReference: { broker: "ibkr", contractId: String(input.strike) },
    },
    dataAvailability: "live",
    timestamp: "2026-07-29T12:00:00.000Z",
    bid: input.bid,
    ask: input.ask,
    last: null,
    mark: null,
    delta: input.delta ?? null,
    impliedVolatility: null,
    volume: null,
    openInterest: null,
  };
}

function analysis(kind: VerticalSpreadKind) {
  const call = kind.startsWith("call");
  const credit = kind.endsWith("credit");
  const longStrike = call === credit ? 110 : 100;
  const shortStrike = call === credit ? 100 : 110;
  const spread = buildVerticalSpread({
    kind,
    quantity: 2,
    longQuote: quote({
      strike: longStrike,
      right: call ? "CALL" : "PUT",
      bid: credit ? 2 : 7,
      ask: credit ? 3 : 8,
      delta: call ? 0.3 : -0.3,
      multiplier: 100,
    }),
    shortQuote: quote({
      strike: shortStrike,
      right: call ? "CALL" : "PUT",
      bid: credit ? 7 : 2,
      ask: credit ? 8 : 3,
      delta: call ? 0.6 : -0.6,
      multiplier: 100,
    }),
  });
  const midpoint = spread.scenarios.find(({ source }) => source === "synthetic-midpoint");
  assert.ok(midpoint?.analysis);
  return midpoint.analysis;
}

void test("NQ put-credit analytics use the actual leg markets and futures multiplier", () => {
  const spread = buildVerticalSpread({
    kind: "put-credit",
    quantity: 1,
    longQuote: quote({ strike: 26400, right: "PUT", bid: 291, ask: 297, delta: -0.229 }),
    shortQuote: quote({
      strike: 26600,
      right: "PUT",
      bid: 330.5,
      ask: 337.5,
      delta: -0.257,
    }),
    limit: 39,
  });

  assert.equal(spread.multiplier, 20);
  assert.equal(spread.width, 200);
  assert.match(spread.settlementWarning, /residual futures position/);
  const [natural, midpoint, limit] = spread.scenarios;
  assert.ok(natural);
  assert.ok(midpoint);
  assert.ok(limit);
  assert.equal(natural.price, 33.5);
  assert.equal(midpoint.price, 40);
  assert.ok(midpoint.analysis);
  assert.deepEqual(
    {
      maximumProfit: midpoint.analysis.maximumProfit,
      maximumLoss: midpoint.analysis.maximumLoss,
      breakeven: midpoint.analysis.breakeven,
      returnOnRisk: midpoint.analysis.returnOnRisk,
    },
    {
      maximumProfit: 800,
      maximumLoss: 3200,
      breakeven: 26560,
      returnOnRisk: 0.25,
    }
  );
  assert.ok(midpoint.analysis.netDelta !== null);
  assert.ok(Math.abs(midpoint.analysis.netDelta - 0.56) < 1e-12);
  assert.equal(limit.analysis?.maximumProfit, 780);
  assert.equal(limit.analysis.maximumLoss, 3220);
  assert.equal(limit.analysis.breakeven, 26561);
});

void test("all vertical kinds use the correct risk and breakeven formulas", () => {
  const cases: { kind: VerticalSpreadKind; breakeven: number }[] = [
    { kind: "call-debit", breakeven: 105 },
    { kind: "call-credit", breakeven: 105 },
    { kind: "put-debit", breakeven: 105 },
    { kind: "put-credit", breakeven: 105 },
  ];
  for (const { kind, breakeven } of cases) {
    const result = analysis(kind);
    assert.equal(result.price, 5, kind);
    assert.equal(result.maximumProfit, 1000, kind);
    assert.equal(result.maximumLoss, 1000, kind);
    assert.equal(result.breakeven, breakeven, kind);
    assert.equal(result.netDelta, kind.startsWith("call") ? -60 : 60, kind);
    const bullish = kind === "call-debit" || kind === "put-credit";
    assert.deepEqual(
      result.expirationPayoff.map(({ profitLoss }) => profitLoss),
      bullish ? [-1000, -1000, 1000, 1000] : [1000, 1000, -1000, -1000],
      kind
    );
  }
});

void test("spread analytics preserve unknown delta and explain invalid user limits", () => {
  const spread = buildVerticalSpread({
    kind: "call-debit",
    quantity: 1,
    longQuote: quote({ strike: 100, right: "CALL", bid: 5, ask: 6, delta: null }),
    shortQuote: quote({ strike: 110, right: "CALL", bid: 2, ask: 3, delta: 0.2 }),
    limit: 12,
  });
  assert.equal(spread.scenarios[1]?.analysis?.netDelta, null);
  assert.equal(spread.scenarios[2]?.analysis, null);
  assert.match(spread.scenarios[2].error ?? "", /less than spread width 10/);
});

void test("spread analytics reject invalid legs and unusable markets", () => {
  const validLong = quote({ strike: 100, right: "CALL", bid: 5, ask: 6 });
  const validShort = quote({ strike: 110, right: "CALL", bid: 2, ask: 3 });
  assert.throws(
    () =>
      buildVerticalSpread({
        kind: "call-debit",
        quantity: 0,
        longQuote: validLong,
        shortQuote: validShort,
      }),
    /positive integer/
  );
  assert.throws(
    () =>
      buildVerticalSpread({
        kind: "call-credit",
        quantity: 1,
        longQuote: validLong,
        shortQuote: validShort,
      }),
    /Invalid call-credit strikes/
  );
  assert.throws(
    () =>
      buildVerticalSpread({
        kind: "call-debit",
        quantity: 1,
        longQuote: quote({ strike: 100, right: "CALL", bid: 5, ask: null }),
        shortQuote: validShort,
      }),
    /usable bid and ask/
  );
  assert.throws(
    () =>
      buildVerticalSpread({
        kind: "call-debit",
        quantity: 1,
        longQuote: validLong,
        shortQuote: quote({
          strike: 110,
          right: "CALL",
          bid: 2,
          ask: 3,
          tradingClass: "NDX",
        }),
      }),
    /differ on tradingClass/
  );
});
