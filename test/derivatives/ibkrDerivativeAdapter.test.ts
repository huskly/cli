import test from "node:test";
import assert from "node:assert/strict";
import { IbkrDerivativeAdapter } from "#src/derivatives/ibkrDerivativeAdapter.js";
import type { IbkrDerivativeDiscoveryApi } from "#src/derivatives/ibkrDerivativeAdapter.js";

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
    getDerivativeReferenceQuote: () =>
      Promise.resolve({
        conid: 770561204,
        symbol: "NQ",
        availability: "live",
        timestamp: null,
        bid: 27865,
        ask: 27866.5,
        last: 27865.5,
        mark: 27864.25,
      }),
    getTradingDiagnostics: () =>
      Promise.resolve({
        accountId: "U123",
        selectedAccountId: "U123",
        environment: "paper",
        authenticated: true,
        competingSession: false,
        marketDataAvailable: true,
        advisoryAssetPermissions: ["OPT"],
      }),
    previewDerivativeCombo: () => Promise.reject(new Error("not used")),
    submitDerivativeCombo: () => Promise.reject(new Error("not used")),
    acknowledgeOrderWarning: () => Promise.reject(new Error("not used")),
    getDerivativeOrderStatus: () => Promise.reject(new Error("not used")),
    cancelDerivativeOrder: () => Promise.reject(new Error("not used")),
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

void test("IBKR adapter keeps combo conids behind the explicit preview boundary", async () => {
  let received: unknown;
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      previewDerivativeCombo: (request) => {
        received = request;
        assert.equal(Reflect.get(request, "orderType"), "LMT");
        return Promise.resolve({
          accountId: request.accountId,
          environment: "paper",
          accepted: true,
          submitted: false,
          commission: 2.5,
          initialMargin: { current: 10_000, change: 3220, after: 13_220 },
          maintenanceMargin: { current: 9000, change: 3000, after: 12_000 },
          warnings: [],
          rejectionReasons: [],
          advisoryAssetPermissions: ["STK"],
        });
      },
    })
  );
  const longContract = {
    identity: {
      assetClass: "FOP" as const,
      underlying: "NQ",
      expiration: "2026-08-21",
      strike: 26400,
      right: "PUT" as const,
      tradingClass: "QN3",
      exchange: "CME",
      multiplier: 20,
    },
    brokerReference: { broker: "ibkr" as const, contractId: "892767804" },
  };
  const shortContract = {
    ...longContract,
    identity: { ...longContract.identity, strike: 26600 },
    brokerReference: { broker: "ibkr" as const, contractId: "892767774" },
  };
  await adapter.previewDerivativeCombo({
    accountId: "U123",
    legs: [
      { contract: longContract, ratio: 1 },
      { contract: shortContract, ratio: -1 },
    ],
    quantity: 1,
    priceEffect: "CREDIT",
    limit: 39,
    tif: "DAY",
    session: "REGULAR",
  });
  assert.deepEqual(
    (received as { legs: { contract: { conid: number }; ratio: number }[] }).legs.map(
      ({ contract, ratio }) => [contract.conid, ratio]
    ),
    [
      [892767804, 1],
      [892767774, -1],
    ]
  );
});

void test("IBKR adapter submits combos as limit orders", async () => {
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      submitDerivativeCombo: (request) => {
        assert.equal(Reflect.get(request, "orderType"), "LMT");
        assert.equal(request.limit, 39);
        assert.equal(request.clientOrderId, "combo-1");
        assert.equal(request.legs[0].contract.conid, 892767774);
        return Promise.resolve({ state: "warning", warnings: [] });
      },
    })
  );
  const contract = await adapter.resolveContract({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    right: "PUT",
    strike: 26600,
  });
  await adapter.submitDerivativeCombo({
    accountId: "U123",
    legs: [
      { contract, ratio: 1 },
      {
        contract: { ...contract, brokerReference: { broker: "ibkr", contractId: "892767804" } },
        ratio: -1,
      },
    ],
    quantity: 1,
    priceEffect: "CREDIT",
    limit: 39,
    tif: "DAY",
    session: "REGULAR",
    clientOrderId: "combo-1",
    extOperator: "operator",
    manualIndicator: false,
  });
});
