import type {
  QueryAccountBalancesRequest,
  QueryAccountBalancesResponse,
  QueryInstrumentSearchRequest,
  QueryInstrumentSearchResponse,
  QueryOrderHistoryRequest,
  QueryOrderHistoryResponse,
  QueryPositionsRequest,
  QueryPositionsResponse,
  QueryQuotesRequest,
  QueryQuotesResponse,
  QueryTransactionsRequest,
  QueryTransactionsResponse,
} from "@huskly/ibkr-gateway-client";
import { z } from "zod";
import { parseGatewayResponse } from "#src/gateway/gatewayValidation.js";
import type { GatewayTransport } from "#src/gateway/gatewayTransport.js";
import {
  observe,
  type AccountBalances,
  type BrokerAccountOrders,
  type BrokerClient,
  type BrokerInstrument,
  type BrokerInstrumentSearchProjection,
  type BrokerOrdersOptions,
  type BrokerPosition,
  type BrokerQuote,
  type BrokerTransactionHistory,
  type ObservationCompleteness,
} from "./brokerClient.js";

export type SearchInstrumentsRequest = QueryInstrumentSearchRequest;
export type SearchInstrumentsResponse = QueryInstrumentSearchResponse;

const readStatusSchema = z.enum(["available", "partial", "empty", "unavailable"]);
const accountReadStatusSchema = z.enum(["available", "partial", "degraded", "unavailable"]);
const evidenceStatusSchema = z.enum(["available", "partial", "unavailable"]);

const orderUncertaintySchema = z.enum([
  "UNKNOWN_STATUS",
  "UNKNOWN_SIDE",
  "MISSING_BROKER_ORDER_ID",
  "MISSING_LEG_IDENTITY",
  "MALFORMED_CONIDEX",
  "AGGREGATE_ONLY",
  "MISSING_PARENT",
  "AMBIGUOUS_PARENT",
  "DUPLICATE_MEMBER",
  "INCOMPLETE_QUANTITIES",
  "PARTIAL_GRAPH",
]);

type QueryOrderHistoryWindowRequest = Extract<QueryOrderHistoryRequest, { by: "window" }>;

const marginSnapshotSchema = z
  .object({
    equityWithLoanValue: z.number().nullable(),
    regTEquity: z.number().nullable(),
    regTMargin: z.number().nullable(),
    initialMarginRequirement: z.number().nullable(),
    maintenanceMarginRequirement: z.number().nullable(),
    availableFunds: z.number().nullable(),
    excessLiquidity: z.number().nullable(),
    cushion: z.number().nullable(),
    sma: z.number().nullable(),
    buyingPower: z.number().nullable(),
    fullInitialMarginRequirement: z.number().nullable(),
    fullMaintenanceMarginRequirement: z.number().nullable(),
    fullAvailableFunds: z.number().nullable(),
    fullExcessLiquidity: z.number().nullable(),
    lookAheadInitialMarginRequirement: z.number().nullable(),
    lookAheadMaintenanceMarginRequirement: z.number().nullable(),
    lookAheadAvailableFunds: z.number().nullable(),
    lookAheadExcessLiquidity: z.number().nullable(),
    lookAheadNextChange: z.number().nullable(),
    leverage: z.number().nullable(),
  })
  .strict();

const accountBalancesResponseSchema = z
  .object({
    observedAt: z.string(),
    status: accountReadStatusSchema,
    balances: z
      .object({
        netLiquidation: z.number().nullable(),
        availableFunds: z.number().nullable(),
        buyingPower: z.number().nullable(),
        cashBalance: z.number().nullable(),
        margin: z
          .object({
            total: marginSnapshotSchema,
            securities: marginSnapshotSchema,
            commodities: marginSnapshotSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<QueryAccountBalancesResponse>;

const positionResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    positions: z
      .array(
        z
          .object({
            brokerId: z.string().nullable(),
            symbol: z.string().nullable(),
            assetType: z.string().nullable(),
            longQuantity: z.number().nullable(),
            shortQuantity: z.number().nullable(),
            averagePrice: z.number().nullable(),
            multiplier: z.number().nullable(),
            marketPrice: z.number().nullable(),
            marketValue: z.number().nullable(),
            currentDayProfitLoss: z.number().nullable(),
            openProfitLoss: z.number().nullable(),
          })
          .strict()
      ),
  })
  .strict() satisfies z.ZodType<QueryPositionsResponse>;

const quoteResponseSchema = z
  .object({
    observedAt: z.string(),
    status: evidenceStatusSchema,
    quotes: z.record(
      z.string(),
      z
        .object({
          symbol: z.string(),
          brokerId: z.string().nullable(),
          reference: z
            .object({
              description: z.string().nullable(),
              exchange: z.string().nullable(),
              exchangeName: z.string().nullable(),
            })
            .strict(),
          quote: z
            .object({
              lastPrice: z.number().nullable(),
              bidPrice: z.number().nullable(),
              askPrice: z.number().nullable(),
              closePrice: z.number().nullable(),
              highPrice: z.number().nullable(),
              lowPrice: z.number().nullable(),
              openPrice: z.number().nullable(),
              netChange: z.number().nullable(),
              netPercentChange: z.number().nullable(),
              totalVolume: z.number().nullable(),
            })
            .strict(),
          availability: z.enum(["live", "delayed", "frozen", "frozen-delayed", "unavailable"]),
          timestamp: z.string().nullable(),
        })
        .strict()
    ),
  })
  .strict() satisfies z.ZodType<QueryQuotesResponse>;

const instrumentResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    instruments: z
      .array(
        z
          .object({
            brokerId: z.string().nullable(),
            symbol: z.string().nullable(),
            description: z.string().nullable(),
            exchange: z.string().nullable(),
            assetClass: z.string().nullable(),
          })
          .strict()
      ),
  })
  .strict() satisfies z.ZodType<SearchInstrumentsResponse>;

const orderLifecycleSchema = z
  .object({
    orderId: z.string().nullable(),
    clientOrderId: z.string().nullable(),
    status: z.enum([
      "WARNING_PENDING",
      "PENDING",
      "WORKING",
      "PARTIALLY_FILLED",
      "FILLED",
      "CANCELED",
      "REJECTED",
      "UNKNOWN",
    ]).nullable(),
    quantity: z.number().nullable(),
    filledQuantity: z.number().nullable(),
    remainingQuantity: z.number().nullable(),
    averagePrice: z.number().nullable(),
    orderType: z.string().nullable(),
    limitPrice: z.number().nullable(),
    stopPrice: z.number().nullable(),
    commissionAndFees: z.number().nullable(),
    legs: z.array(z.object({ brokerId: z.number().nullable(), ratio: z.number().nullable() }).strict()),
    updatedAt: z.string().nullable(),
  })
  .strict();

const transactionResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    transactions: z
      .array(
        z
          .object({
            activityId: z.string().nullable(),
            time: z.string().nullable(),
            type: z.string().nullable(),
            status: z.string().nullable(),
            description: z.string().nullable(),
            netAmount: z.number().nullable(),
            transferItems: z
              .array(
                z
                  .object({
                    instrument: z
                      .object({
                        assetType: z.string().nullable(),
                        symbol: z.string().nullable(),
                        description: z.string().nullable(),
                      })
                      .strict()
                      .nullable(),
                    amount: z.number().nullable(),
                    cost: z.number().nullable(),
                    transferItemType: z.string().nullable(),
                    feeType: z.string().nullable(),
                  })
                  .strict()
              )
              .nullable(),
          })
          .strict()
      ),
    truncated: z.boolean(),
  })
  .strict() satisfies z.ZodType<QueryTransactionsResponse>;

const orderHistoryResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    outcome: z.enum(["resolved", "listed", "not_found", "ambiguous"]),
    lifecycle: orderLifecycleSchema.nullable(),
    orders: z
      .array(
        z
          .object({
            orderId: z.string().nullable(),
            enteredTime: z.string().nullable(),
            status: z.string().nullable(),
            orderType: z.string().nullable(),
            complexOrderStrategyType: z.string().nullable(),
            quantity: z.number().nullable(),
            filledQuantity: z.number().nullable(),
            remainingQuantity: z.number().nullable(),
            price: z.number().nullable(),
            stopPrice: z.number().nullable(),
            legs: z
              .array(
                z
                  .object({
                    symbol: z.string().nullable(),
                    instruction: z.string().nullable(),
                  })
                  .strict()
              ),
          })
          .strict()
      ),
    truncated: z.boolean(),
    uncertainty: z.array(orderUncertaintySchema),
  })
  .strict() satisfies z.ZodType<QueryOrderHistoryResponse>;

function mapReadStatus(status: z.infer<typeof readStatusSchema>): ObservationCompleteness {
  return status;
}

function mapAccountReadStatus(
  status: z.infer<typeof accountReadStatusSchema>
): ObservationCompleteness {
  switch (status) {
    case "degraded":
      return "partial";
    default:
      return status;
  }
}

function mapEvidenceStatus(
  status: z.infer<typeof evidenceStatusSchema>
): ObservationCompleteness {
  return status;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeOrderStatus(status: string | undefined): QueryOrderHistoryWindowRequest["status"] | undefined {
  if (status === undefined) {
    return undefined;
  }
  if (status === "CANCELED") {
    return "CANCELLED";
  }
  return status as QueryOrderHistoryWindowRequest["status"];
}

function groupTransactions(transactions: BrokerTransactionHistory["transactions"]): BrokerTransactionHistory[] {
  return transactions.length === 0 ? [] : [{ transactions }];
}

function groupOrders(orders: BrokerAccountOrders["orders"]): BrokerAccountOrders[] {
  return orders.length === 0 ? [] : [{ orders }];
}

export interface IbkrGatewayReadApi {
  queryAccountBalances(
    body: QueryAccountBalancesRequest
  ): Promise<QueryAccountBalancesResponse>;
  queryPositions(body: QueryPositionsRequest): Promise<QueryPositionsResponse>;
  queryQuotes(body: QueryQuotesRequest): Promise<QueryQuotesResponse>;
  searchInstruments(body: SearchInstrumentsRequest): Promise<SearchInstrumentsResponse>;
  queryTransactions(body: QueryTransactionsRequest): Promise<QueryTransactionsResponse>;
  queryOrderHistory(body: QueryOrderHistoryRequest): Promise<QueryOrderHistoryResponse>;
}

export function createIbkrGatewayReadApi(transport: GatewayTransport): IbkrGatewayReadApi {
  return {
    queryAccountBalances: (body) =>
      transport.call("queryAccountBalances", (client) => client.queryAccountBalances(body)),
    queryPositions: (body) =>
      transport.call("queryPositions", (client) => client.queryPositions(body)),
    queryQuotes: (body) => transport.call("queryQuotes", (client) => client.queryQuotes(body)),
    searchInstruments: (body) =>
      transport.call("searchInstruments", (client) => client.searchInstruments(body)),
    queryTransactions: (body) =>
      transport.call("queryTransactions", (client) => client.queryTransactions(body)),
    queryOrderHistory: (body) =>
      transport.call("queryOrderHistory", (client) => client.queryOrderHistory(body)),
  };
}

/**
 * Adapts typed gateway account and market reads to the broker-neutral CLI
 * presentation contract.
 */
export class IbkrBrokerAdapter implements BrokerClient {
  constructor(private readonly api: IbkrGatewayReadApi) {}

  async getAccountBalances() {
    const response = parseGatewayResponse(
      "queryAccountBalances",
      accountBalancesResponseSchema,
      await this.api.queryAccountBalances({})
    );
    const value: AccountBalances = {
      liquidationValue: response.balances.netLiquidation,
      equity: response.balances.netLiquidation,
      cashBalance: response.balances.cashBalance,
      marginBalance: response.balances.margin.total.initialMarginRequirement,
      availableFunds: response.balances.availableFunds,
      buyingPower: response.balances.buyingPower,
    };
    return observe(value, mapAccountReadStatus(response.status), response.observedAt);
  }

  async getPositions(symbol?: string) {
    const request: QueryPositionsRequest = symbol === undefined ? {} : { symbol };
    const response = parseGatewayResponse(
      "queryPositions",
      positionResponseSchema,
      await this.api.queryPositions(request)
    );
    return observe(
      response.positions.map((position) => this.mapPosition(position)),
      mapReadStatus(response.status),
      response.observedAt
    );
  }

  async getQuotes(symbols: string[]) {
    const response = parseGatewayResponse(
      "queryQuotes",
      quoteResponseSchema,
      await this.api.queryQuotes({ requests: uniqueQuoteRequests(symbols) })
    );
    const quotes = Object.fromEntries(
      Object.entries(response.quotes).map(([symbol, quote]) => [symbol, quote as BrokerQuote])
    ) as Record<string, BrokerQuote>;
    return observe(quotes, mapEvidenceStatus(response.status), response.observedAt);
  }

  async searchInstruments(symbol: string, projection: BrokerInstrumentSearchProjection) {
    const mode = toInstrumentSearchMode(projection);
    const response = parseGatewayResponse(
      "searchInstruments",
      instrumentResponseSchema,
      await this.api.searchInstruments({ query: symbol, mode })
    );
    const instruments = response.instruments.map((instrument) => ({
      brokerId: instrument.brokerId,
      symbol: instrument.symbol,
      description: instrument.description,
      exchange: instrument.exchange,
      assetType: instrument.assetClass,
    })) satisfies BrokerInstrument[];
    return observe(instruments, mapReadStatus(response.status), response.observedAt);
  }

  async fetchTransactionHistory(startDate: Date, endDate: Date) {
    const response = parseGatewayResponse(
      "queryTransactions",
      transactionResponseSchema,
      await this.api.queryTransactions({
        startDate: toDateOnly(startDate),
        endDate: toDateOnly(endDate),
      })
    );
    const transactions = response.transactions.map((transaction) => ({
      activityId: transaction.activityId,
      time: transaction.time,
      type: transaction.type,
      status: transaction.status,
      description: transaction.description,
      netAmount: transaction.netAmount,
      ...(transaction.transferItems === null
        ? {}
        : {
            transferItems: transaction.transferItems.map((item) => ({
              instrument:
                item.instrument === null
                  ? null
                  : {
                      assetType: item.instrument.assetType,
                      symbol: item.instrument.symbol,
                      description: item.instrument.description,
                    },
              amount: item.amount,
              cost: item.cost,
              transferItemType: item.transferItemType,
              feeType: item.feeType,
            })),
          }),
    }));
    return observe(groupTransactions(transactions), mapReadStatus(response.status), response.observedAt);
  }

  async fetchOrders(options: BrokerOrdersOptions) {
    const request: QueryOrderHistoryWindowRequest = {
      by: "window",
      fromEnteredTime: options.fromEnteredTime.toISOString(),
      toEnteredTime: options.toEnteredTime.toISOString(),
    };
    const status = normalizeOrderStatus(options.status);
    if (status !== undefined) {
      request.status = status;
    }
    if (options.maxResults !== undefined) {
      request.maxResults = options.maxResults;
    }

    const response = parseGatewayResponse(
      "queryOrderHistory",
      orderHistoryResponseSchema,
      await this.api.queryOrderHistory(request)
    );
    const orders = response.orders.map((order) => ({
      orderId: order.orderId,
      enteredTime: order.enteredTime,
      status: order.status,
      orderType: order.orderType,
      complexOrderStrategyType: order.complexOrderStrategyType,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.remainingQuantity,
      price: order.price,
      stopPrice: order.stopPrice,
      orderLegCollection: order.legs.map((leg) => ({
        instrument: { symbol: leg.symbol },
        instruction: leg.instruction,
      })),
    }));
    return observe(groupOrders(orders), mapReadStatus(response.status), response.observedAt);
  }

  private mapPosition(position: z.infer<typeof positionResponseSchema>["positions"][number]): BrokerPosition {
    const quantity = (position.longQuantity ?? 0) - (position.shortQuantity ?? 0);
    return {
      instrument: { symbol: position.symbol, assetType: position.assetType },
      longQuantity: position.longQuantity,
      shortQuantity: position.shortQuantity,
      averagePrice: position.averagePrice,
      marketValue: position.marketValue,
      currentDayProfitLoss: position.currentDayProfitLoss,
      longOpenProfitLoss: quantity > 0 ? position.openProfitLoss : 0,
      shortOpenProfitLoss: quantity < 0 ? position.openProfitLoss : 0,
    };
  }
}

function uniqueQuoteRequests(symbols: string[]): QueryQuotesRequest["requests"] {
  const seen = new Set<string>();
  const requests: QueryQuotesRequest["requests"] = [];
  for (const symbol of symbols) {
    const trimmed = symbol.trim();
    if (trimmed === "") {
      continue;
    }
    const key = trimmed.toUpperCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    requests.push({ symbol: trimmed });
  }
  return requests;
}

function toInstrumentSearchMode(
  projection: BrokerInstrumentSearchProjection
): SearchInstrumentsRequest["mode"] {
  switch (projection) {
    case "symbol-search":
      return "symbol-prefix";
    case "search":
      return "search";
    case "symbol-regex":
    case "desc-search":
    case "desc-regex":
    case "fundamental":
      throw new Error(
        `IBKR search currently supports only symbol-search/search projections (got '${projection}').`
      );
  }
}
