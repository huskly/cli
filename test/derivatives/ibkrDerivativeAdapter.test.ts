import test from "node:test";
import assert from "node:assert/strict";
import { BrokerDataUnavailableError } from "#src/brokers/brokerClient.js";
import {
  IbkrDerivativeAdapter,
  type IbkrGatewayDerivativeReadApi,
} from "#src/derivatives/ibkrDerivativeAdapter.js";

function fakeApi(
  overrides: Partial<IbkrGatewayDerivativeReadApi> = {}
): IbkrGatewayDerivativeReadApi {
  return {
    getDiagnostics: () =>
      Promise.resolve({
        version: "0.5.0",
        state: "ready",
        readReady: true,
        newMutationReady: false,
        recoveryMutationReady: false,
        lockOwned: true,
        accountVerified: true,
        account: "U1234567",
        environment: "paper",
        authenticated: true,
        connected: true,
        competingSession: false,
        lastTickleAt: null,
        nextRenewalAt: null,
        lastBrokerRequestAt: null,
        readQueueDepth: 0,
        pendingWarnings: 0,
        reconciliationRequiredOperations: 0,
      }),
    queryDerivativeExpiries: () =>
      Promise.resolve({
        observedAt: "2026-07-29T12:00:00.000Z",
        status: "available",
        expiries: [
          {
            assetClass: "FOP",
            underlying: "NQ",
            expiration: "2026-08-21",
            tradingClass: "QN3",
            exchange: "CME",
            multiplier: 20,
          },
        ],
      }),
    queryDerivativeContracts: () =>
      Promise.resolve({
        observedAt: "2026-07-29T12:00:00.000Z",
        status: "partial",
        contracts: [
          {
            brokerId: 851296101,
            symbol: "NDX",
            assetClass: "OPT",
            underlying: "NDX",
            expiration: "2026-08-20",
            tradingClass: "NDX",
            exchange: "SMART",
            multiplier: 100,
            strike: 26600,
            right: "P",
            settlement: null,
            exerciseStyle: null,
          },
          {
            brokerId: null,
            symbol: "NDXP",
            assetClass: "OPT",
            underlying: "NDX",
            expiration: "2026-08-20",
            tradingClass: "NDXP",
            exchange: "SMART",
            multiplier: 100,
            strike: 26600,
            right: "P",
            settlement: "PM",
            exerciseStyle: "EUROPEAN",
          },
        ],
      }),
    resolveDerivativeContract: () =>
      Promise.resolve({
        observedAt: "2026-07-29T12:00:00.000Z",
        status: "available",
        contract: {
          brokerId: 892767774,
          symbol: "NQ",
          assetClass: "FOP",
          underlying: "NQ",
          expiration: "2026-08-21",
          tradingClass: "QN3",
          exchange: "CME",
          multiplier: 20,
          strike: 26600,
          right: "P",
          settlement: "PM",
          exerciseStyle: "AMERICAN",
        },
      }),
    queryDerivativeQuotes: () =>
      Promise.resolve({
        observedAt: "2026-07-29T12:00:00.000Z",
        status: "available",
        quotes: [
          {
            brokerId: 892767774,
            symbol: "NQ",
            assetClass: "FOP",
            underlying: "NQ",
            expiration: "2026-08-21",
            tradingClass: "QN3",
            exchange: "CME",
            multiplier: 20,
            strike: 26600,
            right: "P",
            settlement: "PM",
            exerciseStyle: "AMERICAN",
            bid: null,
            ask: null,
            last: 383,
            close: 375,
            mark: null,
            delta: -0.257,
            impliedVolatility: null,
            volume: 237,
            openInterest: 50,
            availability: "delayed",
            timestamp: null,
          },
        ],
      }),
    queryDerivativeReferenceQuote: () =>
      Promise.resolve({
        observedAt: "2026-07-29T12:00:00.000Z",
        status: "available",
        derivativeContract: {
          brokerId: 892767774,
          symbol: null,
          assetClass: "FOP",
          underlying: "NQ",
          expiration: "2026-08-21",
          tradingClass: "QN3",
          exchange: "CME",
          multiplier: 20,
          strike: 26600,
          right: "P",
          settlement: "PM",
          exerciseStyle: "AMERICAN",
        },
        referenceQuote: {
          brokerId: 770561204,
          symbol: "NQ",
          bid: 27865,
          ask: 27866.5,
          last: 27865.5,
          close: 27860,
          mark: 27864.25,
          availability: "live",
          timestamp: "2026-07-29T12:00:00.000Z",
        },
      }),
    ...overrides,
  };
}

void test("IBKR adapter maps gateway diagnostics without a caller account", async () => {
  const adapter = new IbkrDerivativeAdapter(fakeApi());
  const diagnostics = await adapter.getTradingDiagnostics();
  assert.equal(diagnostics.accountId, "U1234567");
  assert.equal(diagnostics.environment, "paper");
  assert.equal(diagnostics.newMutationReady, false);
});

void test("IBKR adapter keeps OPT and FOP identities, nullable broker ids, and evidence", async () => {
  let expiryQuery: unknown;
  let contractsQuery: unknown;
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      queryDerivativeExpiries: (query) => {
        expiryQuery = query;
        return fakeApi().queryDerivativeExpiries(query);
      },
      queryDerivativeContracts: (query) => {
        contractsQuery = query;
        return fakeApi().queryDerivativeContracts(query);
      },
    })
  );

  const expiries = await adapter.getExpiries({
    assetClass: "FOP",
    underlying: "NQ",
    from: "2026-08-01",
    to: "2026-08-31",
    tradingClass: "QN3",
    exchange: "CME",
  });
  const contracts = await adapter.getContracts({
    assetClass: "OPT",
    underlying: "NDX",
    expiration: "2026-08-20",
    strike: 26600,
    right: "PUT",
    exchange: "SMART",
  });

  assert.deepEqual(expiryQuery, {
    assetClass: "FOP",
    underlying: "NQ",
    from: "2026-08-01",
    to: "2026-08-31",
    right: null,
    tradingClass: "QN3",
    exchange: "CME",
  });
  assert.equal(expiries.completeness, "available");
  assert.equal(expiries.value[0]?.multiplier, 20);

  assert.deepEqual(contractsQuery, {
    assetClass: "OPT",
    underlying: "NDX",
    expiration: "2026-08-20",
    right: "P",
    strike: 26600,
    tradingClass: null,
    exchange: "SMART",
  });
  assert.equal(contracts.completeness, "partial");
  assert.deepEqual(
    contracts.value.map(({ identity }) => identity.tradingClass),
    ["NDX", "NDXP"]
  );
  assert.equal(contracts.value[0]?.brokerReference?.contractId, "851296101");
  assert.equal(contracts.value[1]?.brokerReference, undefined);
});

void test("IBKR adapter resolves exact contracts and preserves nullable quote markets", async () => {
  const adapter = new IbkrDerivativeAdapter(fakeApi());
  const contract = await adapter.resolveContract({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    strike: 26600,
    right: "PUT",
    tradingClass: "QN3",
  });
  const quotes = await adapter.getChain({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    right: "PUT",
  });

  assert.ok(contract.value);
  const [firstQuote] = quotes.value;
  assert.ok(firstQuote);
  assert.equal(contract.value.identity.settlement, "PM");
  assert.equal(contract.value.identity.exerciseStyle, "AMERICAN");
  assert.equal(firstQuote.dataAvailability, "delayed");
  assert.equal(firstQuote.bid, null);
  assert.equal(firstQuote.timestamp, null);
});

void test("IBKR adapter resolves a complete contract before reference quotes when needed", async () => {
  let resolvedByQuery: unknown;
  let referenceRequest: unknown;
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      resolveDerivativeContract: (query) => {
        resolvedByQuery = query;
        return fakeApi().resolveDerivativeContract(query);
      },
      queryDerivativeReferenceQuote: (request) => {
        referenceRequest = request;
        return fakeApi().queryDerivativeReferenceQuote(request);
      },
    })
  );

  const quote = await adapter.getReferenceQuote({
    identity: {
      assetClass: "FOP",
      underlying: "NQ",
      expiration: "2026-08-21",
      strike: 26600,
      right: "PUT",
      tradingClass: "QN3",
      exchange: "CME",
      multiplier: 20,
    },
  });

  assert.deepEqual(resolvedByQuery, {
    by: "query",
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    right: "P",
    strike: 26600,
    exchange: "CME",
    tradingClass: "QN3",
  });
  assert.deepEqual(referenceRequest, {
    derivativeContract: {
      brokerId: 892767774,
      symbol: null,
      assetClass: "FOP",
      underlying: "NQ",
      expiration: "2026-08-21",
      tradingClass: "QN3",
      exchange: "CME",
      multiplier: 20,
      strike: 26600,
      right: "P",
      settlement: "PM",
      exerciseStyle: "AMERICAN",
    },
  });
  assert.equal(quote.value.brokerReference.contractId, "770561204");
  assert.equal(quote.value.dataAvailability, "live");
});

void test("IBKR adapter preserves empty evidence and refuses unavailable evidence", async () => {
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      getDiagnostics: () => fakeApi().getDiagnostics(),
      queryDerivativeExpiries: () =>
        Promise.resolve({
          observedAt: "2026-07-29T12:00:00.000Z",
          status: "empty",
          expiries: [],
        }),
      resolveDerivativeContract: () =>
        Promise.resolve({
          observedAt: "2026-07-29T12:00:00.000Z",
          status: "unavailable",
          contract: null,
        }),
    })
  );

  const expiries = await adapter.getExpiries({
    assetClass: "OPT",
    underlying: "SPX",
    from: "2026-08-01",
    to: "2026-08-31",
  });
  assert.equal(expiries.completeness, "empty");
  assert.deepEqual(expiries.value, []);

  await assert.rejects(
    () =>
      adapter.getReferenceQuote({
        identity: {
          assetClass: "FOP",
          underlying: "NQ",
          expiration: "2026-08-21",
          strike: 26600,
          right: "PUT",
          tradingClass: "QN3",
          exchange: "CME",
          multiplier: 20,
        },
      }),
    (error) => error instanceof BrokerDataUnavailableError
  );
});

void test("contract-real partial nullable items are omitted with safe count evidence", async () => {
  const validContract = (
    await fakeApi().queryDerivativeContracts({
      assetClass: "OPT",
      underlying: "NDX",
      expiration: "2026-08-20",
      right: null,
      strike: null,
      tradingClass: null,
      exchange: null,
    })
  ).contracts[0];
  const validQuote = (
    await fakeApi().queryDerivativeQuotes({
      assetClass: "FOP",
      underlying: "NQ",
      expiration: "2026-08-21",
      right: null,
      tradingClass: null,
      exchange: null,
    })
  ).quotes[0];
  assert.ok(validContract);
  assert.ok(validQuote);
  const adapter = new IbkrDerivativeAdapter(
    fakeApi({
      queryDerivativeContracts: () =>
        Promise.resolve({
          observedAt: "2026-07-29T12:00:00.000Z",
          status: "partial",
          contracts: [validContract, { ...validContract, brokerId: null, expiration: null }],
        }),
      queryDerivativeQuotes: () =>
        Promise.resolve({
          observedAt: "2026-07-29T12:01:00.000Z",
          status: "partial",
          quotes: [validQuote, { ...validQuote, brokerId: null, right: null }],
        }),
      resolveDerivativeContract: () =>
        Promise.resolve({
          observedAt: "2026-07-29T12:02:00.000Z",
          status: "partial",
          contract: { ...validContract, brokerId: null, strike: null },
        }),
    })
  );
  const contracts = await adapter.getContracts({
    assetClass: "OPT",
    underlying: "NDX",
    expiration: "2026-08-20",
  });
  const quotes = await adapter.getChain({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
  });
  const resolved = await adapter.resolveContract({
    assetClass: "OPT",
    underlying: "NDX",
    expiration: "2026-08-20",
    right: "PUT",
    strike: 26600,
  });
  assert.equal(contracts.completeness, "partial");
  assert.equal(contracts.value.length, 1);
  assert.equal(contracts.sourceCount, 2);
  assert.equal(contracts.omittedCount, 1);
  assert.match(contracts.warnings?.[0] ?? "", /Omitted 1 incomplete derivative contract/);
  assert.equal(quotes.completeness, "partial");
  assert.equal(quotes.value.length, 1);
  assert.equal(quotes.omittedCount, 1);
  assert.equal(resolved.completeness, "partial");
  assert.equal(resolved.value, null);
  assert.equal(resolved.omittedCount, 1);
});
