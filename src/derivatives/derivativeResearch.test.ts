import test from "node:test";
import assert from "node:assert/strict";
import type {
  DerivativeContract,
  DerivativeDiscoveryClient,
  DerivativeQuote,
} from "./derivativeDiscovery.js";
import { DerivativeResearchService } from "./derivativeResearch.js";

function contract(strike: number): DerivativeContract {
  return {
    identity: {
      assetClass: "FOP",
      underlying: "NQ",
      expiration: "2026-08-21",
      strike,
      right: "PUT",
      tradingClass: "QN3",
      exchange: "CME",
      multiplier: 20,
    },
    brokerReference: { broker: "ibkr", contractId: String(strike) },
  };
}

function quote(strike: number, bid: number, ask: number, delta: number): DerivativeQuote {
  return {
    contract: contract(strike),
    dataAvailability: "live",
    timestamp: null,
    bid,
    ask,
    last: null,
    mark: (bid + ask) / 2,
    delta,
    impliedVolatility: null,
    volume: null,
    openInterest: null,
  };
}

function client(): DerivativeDiscoveryClient {
  const quotes = [
    quote(26200, 250, 255, -0.18),
    quote(26400, 291, 297, -0.229),
    quote(26600, 330.5, 337.5, -0.257),
    quote(26800, 380, 388, -0.31),
  ];
  return {
    getExpiries: () => Promise.resolve([]),
    getContracts: () => Promise.resolve(quotes.map(({ contract: item }) => item)),
    resolveContract: (request) => {
      const resolved = quotes.find(({ contract: item }) => item.identity.strike === request.strike);
      return resolved === undefined
        ? Promise.reject(new Error("not found"))
        : Promise.resolve(resolved.contract);
    },
    getChain: (request) =>
      Promise.resolve(
        request.strike === undefined
          ? quotes
          : quotes.filter(({ contract: item }) => item.identity.strike === request.strike)
      ),
    getReferenceQuote: () =>
      Promise.resolve({
        brokerReference: { broker: "ibkr", contractId: "770561204" },
        symbol: "NQ",
        dataAvailability: "live",
        timestamp: "2026-07-29T12:00:00.000Z",
        bid: 27865,
        ask: 27866.5,
        last: 27865.5,
        mark: 26500,
      }),
  };
}

void test("chain research filters around the true reference quote", async () => {
  const service = new DerivativeResearchService(client());
  const result = await service.chain({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    right: "PUT",
    strikes: 1,
  });
  assert.equal(result.referenceQuote?.brokerReference.contractId, "770561204");
  assert.equal(result.center, 26500);
  assert.deepEqual(
    result.quotes.map(({ contract: item }) => item.identity.strike),
    [26400, 26600, 26800]
  );
});

void test("vertical research resolves exact legs and preserves synthetic-price semantics", async () => {
  const service = new DerivativeResearchService(client());
  const result = await service.quoteVertical({
    kind: "put-credit",
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    longStrike: 26400,
    shortStrike: 26600,
    quantity: 1,
    tradingClass: "QN3",
    exchange: "CME",
    limit: 39,
  });
  assert.equal(result.referenceQuote.symbol, "NQ");
  assert.equal(result.spread.scenarios[0]?.price, 33.5);
  assert.equal(result.spread.scenarios[1]?.analysis?.maximumProfit, 800);
  assert.equal(result.spread.scenarios[2]?.analysis?.maximumLoss, 3220);
  assert.match(result.pricingNotice, /not a broker combo NBBO/);
});

void test("resolve returns exact identity with its true underlying reference quote", async () => {
  const service = new DerivativeResearchService(client());
  const result = await service.resolve({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    strike: 26600,
    right: "PUT",
  });
  assert.equal(result.contract.identity.tradingClass, "QN3");
  assert.equal(result.referenceQuote.brokerReference.contractId, "770561204");
});

void test("series discovery retains exact contract identities", async () => {
  const service = new DerivativeResearchService(client());
  const result = await service.discover({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    tradingClass: "QN3",
    right: "PUT",
  });
  assert.equal(result.contracts.length, 4);
  assert.equal(result.contracts[0]?.identity.multiplier, 20);
  assert.equal(result.referenceQuote?.brokerReference.contractId, "770561204");
});
