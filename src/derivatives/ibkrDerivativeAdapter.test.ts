import test from "node:test";
import assert from "node:assert/strict";
import { IbkrDerivativeAdapter } from "./ibkrDerivativeAdapter.js";
import type { IbkrDerivativeDiscoveryApi } from "./ibkrDerivativeAdapter.js";

function fakeApi(overrides: Partial<IbkrDerivativeDiscoveryApi> = {}): IbkrDerivativeDiscoveryApi {
  return {
    getDerivativeExpiries: () => Promise.resolve([]),
    getDerivativeContracts: () => Promise.resolve([]),
    resolveDerivativeContract: () =>
      Promise.resolve({
        conid: 892767774,
        assetClass: "FOP",
        underlying: "NQ",
        expiration: "2026-08-21",
        strike: 26600,
        right: "P",
        tradingClass: "QN3",
        exchange: "CME",
        multiplier: 20,
      }),
    getDerivativeChain: () => Promise.resolve([]),
    ...overrides,
  };
}

void test("IBKR adapter separates semantic NQ identity from its broker-local conid", async () => {
  let received: unknown;
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      resolveDerivativeContract: (query) => {
        received = query;
        return Promise.resolve({
          conid: 892767774,
          assetClass: "FOP",
          underlying: "NQ",
          expiration: "2026-08-21",
          strike: 26600,
          right: "P",
          tradingClass: "QN3",
          exchange: "CME",
          multiplier: 20,
        });
      },
    })
  );

  const contract = await adapter.resolveContract({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    strike: 26600,
    right: "PUT",
    tradingClass: "QN3",
  });

  assert.deepEqual(received, {
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    strike: 26600,
    right: "P",
    tradingClass: "QN3",
  });
  assert.deepEqual(contract.identity, {
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    strike: 26600,
    right: "PUT",
    tradingClass: "QN3",
    exchange: "CME",
    multiplier: 20,
  });
  assert.deepEqual(contract.brokerReference, {
    broker: "ibkr",
    contractId: "892767774",
  });
  assert.equal("conid" in contract.identity, false);
});

void test("IBKR adapter keeps NDX and NDXP semantic identities distinct", async () => {
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      getDerivativeContracts: () =>
        Promise.resolve([
          {
            conid: 851296101,
            assetClass: "OPT",
            underlying: "NDX",
            expiration: "2026-08-20",
            strike: 26600,
            right: "P",
            tradingClass: "NDX",
            exchange: "SMART",
            multiplier: 100,
          },
          {
            conid: 903244292,
            assetClass: "OPT",
            underlying: "NDX",
            expiration: "2026-08-20",
            strike: 26600,
            right: "P",
            tradingClass: "NDXP",
            exchange: "SMART",
            multiplier: 100,
          },
        ]),
    })
  );

  const contracts = await adapter.getContracts({
    assetClass: "OPT",
    underlying: "NDX",
    expiration: "2026-08-20",
    strike: 26600,
    right: "PUT",
    exchange: "SMART",
  });
  assert.deepEqual(
    contracts.map(({ identity }) => identity.tradingClass),
    ["NDX", "NDXP"]
  );
  assert.notDeepEqual(contracts[0]?.identity, contracts[1]?.identity);
});

void test("IBKR adapter preserves nullable market data and availability", async () => {
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      getDerivativeChain: () =>
        Promise.resolve([
          {
            contract: {
              conid: 892767774,
              assetClass: "FOP",
              underlying: "NQ",
              expiration: "2026-08-21",
              strike: 26600,
              right: "P",
              tradingClass: "QN3",
              exchange: "CME",
              multiplier: 20,
            },
            availability: "delayed",
            timestamp: null,
            bid: null,
            ask: null,
            last: 383,
            mark: null,
            delta: -0.257,
            impliedVolatility: null,
            volume: 237,
            openInterest: 50,
          },
        ]),
    })
  );

  const [quote] = await adapter.getChain({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
  });
  assert.ok(quote);
  assert.equal(quote.dataAvailability, "delayed");
  assert.equal(quote.bid, null);
  assert.equal(quote.ask, null);
  assert.equal(quote.delta, -0.257);
});

void test("IBKR adapter rejects malformed broker-local contract references", async () => {
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      resolveDerivativeContract: () =>
        Promise.resolve({
          conid: Number.NaN,
          assetClass: "FOP",
          underlying: "NQ",
          expiration: "2026-08-21",
          strike: 26600,
          right: "P",
          tradingClass: "QN3",
          exchange: "CME",
          multiplier: 20,
        }),
    })
  );
  await assert.rejects(
    () =>
      adapter.resolveContract({
        assetClass: "FOP",
        underlying: "NQ",
        expiration: "2026-08-21",
        strike: 26600,
        right: "PUT",
      }),
    /invalid broker-local derivative contract reference/
  );
});
