import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  QueryAccountBalancesResponse,
  QueryOrderHistoryResponse,
  QueryPositionsResponse,
  QueryQuotesResponse,
  QueryTransactionsResponse,
} from "@huskly/ibkr-gateway-client";
import {
  IbkrBrokerAdapter,
  type IbkrGatewayReadApi,
  type SearchInstrumentsResponse,
} from "#src/brokers/ibkrBrokerAdapter.js";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";

function marginSnapshot(initialMarginRequirement: number | null) {
  return {
    equityWithLoanValue: null,
    regTEquity: null,
    regTMargin: null,
    initialMarginRequirement,
    maintenanceMarginRequirement: null,
    availableFunds: null,
    excessLiquidity: null,
    cushion: null,
    sma: null,
    buyingPower: null,
    fullInitialMarginRequirement: null,
    fullMaintenanceMarginRequirement: null,
    fullAvailableFunds: null,
    fullExcessLiquidity: null,
    lookAheadInitialMarginRequirement: null,
    lookAheadMaintenanceMarginRequirement: null,
    lookAheadAvailableFunds: null,
    lookAheadExcessLiquidity: null,
    lookAheadNextChange: null,
    leverage: null,
  };
}

function createApi(overrides: Partial<IbkrGatewayReadApi> = {}): {
  api: IbkrGatewayReadApi;
  calls: { method: string; body: unknown }[];
} {
  const calls: { method: string; body: unknown }[] = [];
  const api: IbkrGatewayReadApi = {
    queryAccountBalances: (body) => {
      calls.push({ method: "queryAccountBalances", body });
      return Promise.resolve({
        observedAt: "2026-09-04T00:00:00.000Z",
        status: "degraded",
        balances: {
          netLiquidation: 100_000,
          cashBalance: 10_000,
          availableFunds: 20_000,
          buyingPower: 40_000,
          margin: {
            total: marginSnapshot(null),
            securities: marginSnapshot(1),
            commodities: marginSnapshot(2),
          },
        },
      } satisfies QueryAccountBalancesResponse);
    },
    queryPositions: (body) => {
      calls.push({ method: "queryPositions", body });
      return Promise.resolve({
        observedAt: "2026-09-04T00:00:01.000Z",
        status: "partial",
        positions: [
          {
            brokerId: "265598",
            symbol: "AAPL",
            assetType: "EQUITY",
            longQuantity: 5,
            shortQuantity: 0,
            averagePrice: 200,
            multiplier: null,
            marketPrice: 210,
            marketValue: 1_050,
            currentDayProfitLoss: 25,
            openProfitLoss: 50,
          },
          {
            brokerId: "999",
            symbol: null,
            assetType: "OPTION",
            longQuantity: 0,
            shortQuantity: 1,
            averagePrice: 2,
            multiplier: 100,
            marketPrice: 1.5,
            marketValue: -150,
            currentDayProfitLoss: 10,
            openProfitLoss: null,
          },
        ],
      } satisfies QueryPositionsResponse);
    },
    queryQuotes: (body) => {
      calls.push({ method: "queryQuotes", body });
      return Promise.resolve({
        observedAt: "2026-09-04T00:00:02.000Z",
        status: "partial",
        quotes: {
          AAPL: {
            symbol: "AAPL",
            brokerId: null,
            reference: {
              description: null,
              exchange: "NASDAQ",
              exchangeName: null,
            },
            quote: {
              lastPrice: null,
              bidPrice: 189.5,
              askPrice: 190,
              closePrice: 188,
              highPrice: null,
              lowPrice: null,
              openPrice: 187,
              netChange: 2,
              netPercentChange: 1,
              totalVolume: null,
            },
            availability: "delayed",
            timestamp: null,
          },
        },
      } satisfies QueryQuotesResponse);
    },
    searchInstruments: (body) => {
      calls.push({ method: "searchInstruments", body });
      return Promise.resolve({
        observedAt: "2026-09-04T00:00:03.000Z",
        status: "empty",
        instruments: [
          {
            brokerId: null,
            symbol: "AAPL",
            description: null,
            exchange: "NASDAQ",
            assetClass: null,
          },
        ],
      } satisfies SearchInstrumentsResponse);
    },
    queryTransactions: (body) => {
      calls.push({ method: "queryTransactions", body });
      return Promise.resolve({
        observedAt: "2026-09-04T00:00:04.000Z",
        status: "available",
        transactions: [
          {
            activityId: null,
            time: "2026-01-02T12:00:00.000Z",
            type: null,
            status: "VALID",
            description: null,
            netAmount: null,
            transferItems: [
              {
                instrument: {
                  assetType: "OPTION",
                  symbol: null,
                  description: null,
                },
                amount: null,
                cost: 1.25,
                transferItemType: null,
                feeType: "COMMISSION",
              },
            ],
          },
        ],
        truncated: false,
      } satisfies QueryTransactionsResponse);
    },
    queryOrderContractQuotes: (body) => {
      calls.push({ method: "queryOrderContractQuotes", body });
      return Promise.resolve({
        observedAt: "2026-09-04T00:00:05.000Z",
        status: "available",
        quotes: [],
      });
    },
    queryOrderHistory: (body) => {
      calls.push({ method: "queryOrderHistory", body });
      return Promise.resolve({
        observedAt: "2026-09-04T00:00:05.000Z",
        status: "available",
        outcome: "listed",
        lifecycle: null,
        orders: [
          {
            orderId: null,
            enteredTime: null,
            status: "WORKING",
            orderType: null,
            complexOrderStrategyType: null,
            tif: "GTC",
            session: "OVERNIGHT",
            quantity: null,
            filledQuantity: 0,
            remainingQuantity: null,
            price: null,
            stopPrice: 190,
            legs: [{ symbol: null, instruction: null }],
          },
        ],
        truncated: false,
        uncertainty: [],
      } satisfies QueryOrderHistoryResponse);
    },
  };
  return { api: { ...api, ...overrides }, calls };
}

describe("IbkrBrokerAdapter", () => {
  it("maps gateway reads to the CLI contract and sends exact generated requests", async () => {
    const { api, calls } = createApi();
    const adapter = new IbkrBrokerAdapter(api);

    assert.deepEqual(await adapter.getAccountBalances(), {
      observedAt: "2026-09-04T00:00:00.000Z",
      completeness: "partial",
      value: {
        liquidationValue: 100_000,
        equity: 100_000,
        cashBalance: 10_000,
        marginBalance: null,
        availableFunds: 20_000,
        buyingPower: 40_000,
      },
    });

    assert.deepEqual(await adapter.getPositions("AAPL"), {
      observedAt: "2026-09-04T00:00:01.000Z",
      completeness: "partial",
      value: [
        {
          instrument: { symbol: "AAPL", assetType: "EQUITY" },
          longQuantity: 5,
          shortQuantity: 0,
          averagePrice: 200,
          marketValue: 1_050,
          currentDayProfitLoss: 25,
          longOpenProfitLoss: 50,
          shortOpenProfitLoss: 0,
        },
        {
          instrument: { symbol: null, assetType: "OPTION" },
          longQuantity: 0,
          shortQuantity: 1,
          averagePrice: 2,
          marketValue: -150,
          currentDayProfitLoss: 10,
          longOpenProfitLoss: 0,
          shortOpenProfitLoss: null,
        },
      ],
    });

    assert.deepEqual(await adapter.getQuotes([" AAPL ", "aapl", ""]), {
      observedAt: "2026-09-04T00:00:02.000Z",
      completeness: "partial",
      value: {
        AAPL: {
          symbol: "AAPL",
          brokerId: null,
          reference: {
            description: null,
            exchange: "NASDAQ",
            exchangeName: null,
          },
          quote: {
            lastPrice: null,
            bidPrice: 189.5,
            askPrice: 190,
            closePrice: 188,
            highPrice: null,
            lowPrice: null,
            openPrice: 187,
            netChange: 2,
            netPercentChange: 1,
            totalVolume: null,
          },
          availability: "delayed",
          timestamp: null,
        },
      },
    });

    assert.deepEqual(await adapter.searchInstruments("AAP", "symbol-search"), {
      observedAt: "2026-09-04T00:00:03.000Z",
      completeness: "empty",
      value: [
        {
          brokerId: null,
          symbol: "AAPL",
          description: null,
          exchange: "NASDAQ",
          assetType: null,
        },
      ],
    });

    const startDate = new Date("2026-01-01T00:00:00.000Z");
    const endDate = new Date("2026-01-31T00:00:00.000Z");
    assert.deepEqual(await adapter.fetchTransactionHistory(startDate, endDate), {
      observedAt: "2026-09-04T00:00:04.000Z",
      completeness: "available",
      value: [
        {
          transactions: [
            {
              activityId: null,
              time: "2026-01-02T12:00:00.000Z",
              type: null,
              status: "VALID",
              description: null,
              netAmount: null,
              transferItems: [
                {
                  instrument: {
                    assetType: "OPTION",
                    symbol: null,
                    description: null,
                  },
                  amount: null,
                  cost: 1.25,
                  transferItemType: null,
                  feeType: "COMMISSION",
                },
              ],
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      await adapter.fetchOrders({
        fromEnteredTime: startDate,
        toEnteredTime: endDate,
        status: "CANCELED",
        maxResults: 25,
      }),
      {
        observedAt: "2026-09-04T00:00:05.000Z",
        completeness: "available",
        value: [
          {
            orders: [
              {
                orderId: null,
                enteredTime: null,
                status: "WORKING",
                orderType: null,
                complexOrderStrategyType: null,
                tif: "GTC",
                session: "OVERNIGHT",
                quantity: null,
                filledQuantity: 0,
                remainingQuantity: null,
                price: null,
                stopPrice: 190,
                averageFillPrice: null,
                orderLegCollection: [{ instrument: { symbol: null }, instruction: null }],
              },
            ],
          },
        ],
      }
    );

    assert.deepEqual(calls, [
      { method: "queryAccountBalances", body: {} },
      { method: "queryPositions", body: { symbol: "AAPL" } },
      { method: "queryQuotes", body: { requests: [{ symbol: "AAPL" }] } },
      { method: "searchInstruments", body: { query: "AAP", mode: "symbol-prefix" } },
      {
        method: "queryTransactions",
        body: { startDate: "2026-01-01", endDate: "2026-01-31" },
      },
      {
        method: "queryOrderHistory",
        body: {
          by: "window",
          fromEnteredTime: "2026-01-01T00:00:00.000Z",
          toEnteredTime: "2026-01-31T00:00:00.000Z",
          status: "CANCELLED",
          maxResults: 25,
        },
      },
    ]);
  });

  it("rejects unsupported IBKR search projections before a gateway call", async () => {
    const { api, calls } = createApi();
    const adapter = new IbkrBrokerAdapter(api);

    await assert.rejects(
      () => adapter.searchInstruments("AAPL", "desc-search"),
      /IBKR search currently supports only symbol-search\/search projections/
    );
    assert.deepEqual(calls, []);
  });

  it("returns no synthetic account grouping when the gateway returns empty lists", async () => {
    const adapter = new IbkrBrokerAdapter(
      createApi({
        queryTransactions: () =>
          Promise.resolve({
            observedAt: "2026-09-04T00:00:00.000Z",
            status: "empty",
            transactions: [],
            truncated: false,
          } satisfies QueryTransactionsResponse),
        queryOrderHistory: () =>
          Promise.resolve({
            observedAt: "2026-09-04T00:00:00.000Z",
            status: "empty",
            outcome: "listed",
            lifecycle: null,
            orders: [],
            truncated: false,
            uncertainty: [],
          } satisfies QueryOrderHistoryResponse),
      }).api
    );

    assert.deepEqual(
      await adapter.fetchTransactionHistory(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-31T00:00:00.000Z")
      ),
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "empty",
        value: [],
      }
    );
    assert.deepEqual(
      await adapter.fetchOrders({
        fromEnteredTime: new Date("2026-01-01T00:00:00.000Z"),
        toEnteredTime: new Date("2026-01-31T00:00:00.000Z"),
      }),
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "empty",
        value: [],
      }
    );
  });

  it("enriches order prices and average fills from exact lifecycles", async () => {
    const { api, calls } = createApi();
    api.queryOrderHistory = (body) => {
      calls.push({ method: "queryOrderHistory", body });
      if (body.by === "window") {
        return Promise.resolve({
          observedAt: "2026-09-04T00:00:05.000Z",
          status: "available",
          outcome: "listed",
          lifecycle: null,
          orders: [
            {
              orderId: "stop-1",
              enteredTime: "2026-01-02T12:00:00.000Z",
              status: "WORKING",
              orderType: "STOP",
              complexOrderStrategyType: null,
              tif: null,
              session: null,
              quantity: 100,
              filledQuantity: 0,
              remainingQuantity: 100,
              price: null,
              stopPrice: null,
              legs: [{ symbol: "AAPL", instruction: "SELL" }],
            },
            {
              orderId: "limit-1",
              enteredTime: "2026-01-02T11:00:00.000Z",
              status: "FILLED",
              orderType: "LIMIT",
              complexOrderStrategyType: null,
              tif: null,
              session: null,
              quantity: 1,
              filledQuantity: 1,
              remainingQuantity: 0,
              price: 190,
              stopPrice: null,
              legs: [{ symbol: "AAPL", instruction: "SELL" }],
            },
            {
              orderId: "limit-2",
              enteredTime: "2026-01-02T10:30:00.000Z",
              status: "PARTIALLY_FILLED",
              orderType: "LIMIT",
              complexOrderStrategyType: null,
              tif: null,
              session: null,
              quantity: 2,
              filledQuantity: 1,
              remainingQuantity: 1,
              price: null,
              stopPrice: null,
              legs: [{ symbol: "SPX", instruction: "BUY" }],
            },
            {
              orderId: "stop-2",
              enteredTime: "2026-01-02T10:00:00.000Z",
              status: "CANCELLED",
              orderType: "STOP",
              complexOrderStrategyType: null,
              tif: null,
              session: null,
              quantity: 50,
              filledQuantity: 0,
              remainingQuantity: 50,
              price: null,
              stopPrice: null,
              legs: [{ symbol: "MSFT", instruction: "SELL" }],
            },
          ],
          truncated: false,
          uncertainty: [],
        } satisfies QueryOrderHistoryResponse);
      }

      if (body.by !== "orderId") assert.fail("Expected an orderId lookup");
      if (body.orderId === "limit-1") {
        return Promise.resolve({
          observedAt: "2026-09-04T00:00:06.000Z",
          status: "available",
          outcome: "resolved",
          lifecycle: {
            orderId: "limit-1",
            clientOrderId: null,
            status: "FILLED",
            quantity: 1,
            filledQuantity: 1,
            remainingQuantity: 0,
            averagePrice: 189.75,
            orderType: "LIMIT",
            limitPrice: 190,
            stopPrice: null,
            commissionAndFees: null,
            legs: [],
            updatedAt: null,
          },
          orders: [],
          truncated: false,
          uncertainty: [],
        } satisfies QueryOrderHistoryResponse);
      }
      if (body.orderId === "limit-2") {
        return Promise.resolve({
          observedAt: "2026-09-04T00:00:06.000Z",
          status: "available",
          outcome: "resolved",
          lifecycle: {
            orderId: "limit-2",
            clientOrderId: null,
            status: "WORKING",
            quantity: 1,
            filledQuantity: 0,
            remainingQuantity: 1,
            averagePrice: 21.25,
            orderType: "LIMIT",
            limitPrice: 21.4,
            stopPrice: null,
            commissionAndFees: null,
            legs: [{ brokerId: 123, ratio: 1 }],
            updatedAt: "2026-01-02T10:30:00.000Z",
          },
          orders: [],
          truncated: false,
          uncertainty: [],
        } satisfies QueryOrderHistoryResponse);
      }
      if (body.orderId === "stop-2") {
        return Promise.resolve({
          observedAt: "2026-09-04T00:00:06.000Z",
          status: "unavailable",
          outcome: "not_found",
          lifecycle: null,
          orders: [],
          truncated: false,
          uncertainty: ["UNKNOWN_STATUS"],
        } satisfies QueryOrderHistoryResponse);
      }

      return Promise.resolve({
        observedAt: "2026-09-04T00:00:06.000Z",
        status: "available",
        outcome: "resolved",
        lifecycle: {
          orderId: "stop-1",
          clientOrderId: null,
          status: "WORKING",
          quantity: 100,
          filledQuantity: 0,
          remainingQuantity: 100,
          averagePrice: null,
          orderType: "STOP",
          limitPrice: 0,
          stopPrice: 185.5,
          commissionAndFees: null,
          legs: [{ brokerId: 123, ratio: -1 }],
          updatedAt: "2026-01-02T12:00:00.000Z",
        },
        orders: [],
        truncated: false,
        uncertainty: [],
      } satisfies QueryOrderHistoryResponse);
    };
    const adapter = new IbkrBrokerAdapter(api);

    const result = await adapter.fetchOrders({
      fromEnteredTime: new Date("2026-01-01T00:00:00.000Z"),
      toEnteredTime: new Date("2026-01-31T00:00:00.000Z"),
    });

    assert.equal(result.value[0]?.orders[0]?.stopPrice, 185.5);
    assert.equal(result.value[0].orders[1]?.price, 190);
    assert.equal(result.value[0].orders[1].averageFillPrice, 189.75);
    assert.equal(result.value[0].orders[2]?.price, 21.4);
    assert.equal(result.value[0].orders[2].averageFillPrice, 21.25);
    assert.equal(result.value[0].orders[3]?.stopPrice, null);
    assert.deepEqual(calls, [
      {
        method: "queryOrderHistory",
        body: {
          by: "window",
          fromEnteredTime: "2026-01-01T00:00:00.000Z",
          toEnteredTime: "2026-01-31T00:00:00.000Z",
        },
      },
      { method: "queryOrderHistory", body: { by: "orderId", orderId: "stop-1" } },
      { method: "queryOrderHistory", body: { by: "orderId", orderId: "limit-1" } },
      { method: "queryOrderHistory", body: { by: "orderId", orderId: "limit-2" } },
      { method: "queryOrderHistory", body: { by: "orderId", orderId: "stop-2" } },
    ]);
  });

  it("throws a fixed redacted transport failure for malformed success JSON", async () => {
    const adapter = new IbkrBrokerAdapter(
      createApi({
        queryQuotes: (_body) =>
          Promise.resolve({
            observedAt: "2026-09-04T00:00:02.000Z",
            status: "partial",
            quotes: {
              AAPL: {
                symbol: "AAPL",
                brokerId: null,
                reference: {
                  description: null,
                  exchange: "NASDAQ",
                  exchangeName: null,
                },
                quote: {
                  lastPrice: null,
                  bidPrice: 189.5,
                  askPrice: "190",
                  closePrice: 188,
                  highPrice: null,
                  lowPrice: null,
                  openPrice: 187,
                  netChange: 2,
                  netPercentChange: 1,
                  totalVolume: null,
                },
                availability: "delayed",
                timestamp: null,
              },
            },
          } as unknown as QueryQuotesResponse),
      }).api
    );

    await assert.rejects(
      () => adapter.getQuotes(["AAPL"]),
      (error: unknown) => {
        assert.ok(error instanceof ConsumerError);
        assert.equal(error.code, "gateway_transport_failure");
        assert.equal(error.operation, "queryQuotes");
        assert.equal(error.message, "Gateway request failed");
        assert.doesNotMatch(JSON.stringify(error), /190|issues|askPrice|NASDAQ/);
        return true;
      }
    );
  });
});

it("keeps exact option contract identity and reads quotes by contract ID", async () => {
  const { api } = createApi();
  const adapter = new IbkrBrokerAdapter({
    ...api,
    queryOrderHistory: async (body) => {
      const result = await api.queryOrderHistory(body);
      return {
        ...result,
        orders: result.orders.map((order) => ({
          ...order,
          legs: order.legs.map((leg) => ({
            ...leg,
            brokerId: 123,
            ratio: -1,
            assetClass: "OPT" as const,
            uncertainty: [],
            option: {
              symbol: "IBIT  260925C00047000",
              underlying: "IBIT",
              expiration: "2026-09-25",
              strike: 47,
              right: "C" as const,
              tradingClass: "IBIT",
              exchange: "SMART",
              multiplier: 100,
            },
          })),
        })),
      };
    },
    queryOrderContractQuotes: () =>
      Promise.resolve({
        observedAt: "2026-09-04T00:00:05.000Z",
        status: "available",
        quotes: [
          { brokerId: 123, bid: 1, ask: 1.2, mark: 1.1, availability: "delayed", timestamp: null },
        ],
      }),
  });
  const orders = await adapter.fetchOrders({
    fromEnteredTime: new Date("2026-09-01T00:00:00Z"),
    toEnteredTime: new Date("2026-09-05T00:00:00Z"),
  });
  const firstLeg = orders.value.at(0)?.orders.at(0)?.orderLegCollection?.at(0);
  assert.ok(firstLeg);
  assert.equal(firstLeg.option?.symbol, "IBIT  260925C00047000");
  assert.equal(firstLeg.ratio, -1);
  assert.deepEqual(firstLeg.uncertainty, []);
  const quotes = await adapter.getOrderContractQuotes([123]);
  assert.equal(quotes.value.at(0)?.mark, 1.1);
  assert.equal(quotes.value.at(0)?.availability, "delayed");
});
