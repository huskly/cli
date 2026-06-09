import { createRequire } from "node:module";
import type { IbkrClient as RawIbkrClient } from "ibkr-client";
import type { IbkrOauth1Config } from "#src/ibkr/oauthConfig.js";
import type {
  AccountBalances,
  BrokerAccountOrders,
  BrokerClient,
  BrokerInstrument,
  BrokerInstrumentSearchProjection,
  BrokerOrder,
  BrokerOrderLeg,
  BrokerOrdersOptions,
  BrokerPosition,
  BrokerQuote,
  BrokerTransaction,
  BrokerTransactionHistory,
} from "#src/brokers/brokerClient.js";
import { ASSET_CLASS_LABELS, toNumber } from "#src/helpers.js";
import type {
  IbkrAuthStatus,
  IbkrBrokerageAccountsResponse,
  IbkrLiveOrder,
  IbkrLiveOrdersResponse,
  IbkrMarketDataHistoryBar,
  IbkrMarketDataHistoryResponse,
  IbkrMarketDataSnapshot,
  IbkrPortfolioAccount,
  IbkrPortfolioSummary,
  IbkrPosition,
  IbkrSwitchAccountResponse,
  IbkrStockContract,
  IbkrStockListing,
  IbkrStocksResponse,
  IbkrTransaction,
  IbkrTransactionsResponse,
} from "#src/ibkr/ibkrApiTypes.js";

// `ibkr-client`'s published ESM build is broken: its `import` condition points
// at files that use extensionless relative imports, which Node's strict ESM
// resolver rejects. Its CJS build is fine, so we deliberately load that via
// createRequire. This is the one intentional createRequire in the codebase —
// everything else imports natively as ESM. Revisit if upstream fixes their ESM.
const require = createRequire(import.meta.url);
const { IbkrClient: RawIbkrClientCtor } = require("ibkr-client") as {
  IbkrClient: new (config: IbkrOauth1Config) => RawIbkrClient;
};

/** IBKR session auth status (not part of the shared BrokerClient contract). */
export interface IbkrSessionStatus {
  authenticated: boolean;
  competing: boolean;
}

interface QuoteContract {
  requestedSymbol: string;
  symbol: string;
  conid: number;
  description?: string;
  exchange?: string;
}

/** Live market-data snapshot field 78 = position's P&L for the current day. */
const DAY_PNL_FIELD = "78";
const QUOTE_FIELDS = [
  "31", // Last
  "55", // Symbol
  "58", // Text
  "70", // High
  "71", // Low
  "82", // Change
  "83", // Change %
  "84", // Bid
  "86", // Ask
  "87", // Formatted volume
  "6004", // Exchange
  "6509", // Market data availability
  "7762", // Unformatted volume
].join(",");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DAY_MS = 24 * 60 * 60 * 1000;
const IBKR_STATUS_FILTERS: Record<string, string> = {
  CANCELED: "cancelled",
  CANCELLED: "cancelled",
  FILLED: "filled",
  PENDING_CANCEL: "pending_cancel",
  PENDING_SUBMIT: "pending_submit",
  PRE_SUBMITTED: "pre_submitted",
  SUBMITTED: "submitted",
  WORKING: "submitted",
};

/**
 * Typed IBKR Web API client implementing the broker-neutral {@link BrokerClient}.
 * Wraps the `ibkr-client` npm package, which performs the OAuth 1.0a
 * live-session-token handshake. Emits Schwab-shaped balances/positions so the
 * shared CLI handlers render IBKR and Schwab identically.
 */
export class IbkrClient implements BrokerClient {
  private readonly raw: RawIbkrClient;
  private initPromise?: Promise<void>;
  private accountIdPromise?: Promise<string>;

  constructor(config: IbkrOauth1Config) {
    this.raw = new RawIbkrClientCtor(config);
  }

  /** Obtain the live session token (idempotent — safe to await repeatedly). */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      await this.raw.init();
      // IBKR is slow right after init; give the session a moment to settle.
      await sleep(1000);
    })();
    return this.initPromise;
  }

  async getAuthStatus(): Promise<IbkrSessionStatus> {
    const status = await this.req<IbkrAuthStatus>({
      path: "iserver/auth/status",
      method: "POST",
    });
    return {
      authenticated: status.authenticated ?? false,
      competing: status.competing ?? false,
    };
  }

  async getAccountId(): Promise<string> {
    this.accountIdPromise ??= (async () => {
      const override = process.env["IBKR_ACCOUNT_ID"];
      if (override) return override;
      const accounts = await this.req<IbkrPortfolioAccount[]>({ path: "portfolio/accounts" });
      const first = accounts[0];
      if (!first) throw new Error("No portfolio accounts returned by IBKR");
      return first.accountId;
    })();
    return this.accountIdPromise;
  }

  async getAccountBalances(): Promise<AccountBalances> {
    const accountId = await this.getAccountId();
    const summary = await this.req<IbkrPortfolioSummary>({
      path: `portfolio/${accountId}/summary`,
    });
    const amount = (key: string): number => toNumber(summary[key]?.amount);
    const netLiquidation = amount("netliquidation");
    return {
      liquidationValue: netLiquidation,
      // IBKR's summary has no separate "equity" figure; net liquidation is the
      // closest analogue to Schwab's equity for display purposes.
      equity: netLiquidation,
      cashBalance: amount("totalcashvalue"),
      availableFunds: amount("availablefunds"),
      buyingPower: amount("buyingpower"),
    };
  }

  async getPositions(symbol?: string): Promise<BrokerPosition[]> {
    const accountId = await this.getAccountId();
    const rows = await this.fetchAllPositions(accountId);
    const conids = rows
      .map((p) => p.conid)
      .filter((conid): conid is number => conid !== undefined)
      .map(String);
    const dayPnl = await this.fetchDayPnl(conids);
    let positions = rows.map((p) => this.normalizePosition(p, dayPnl));
    if (symbol) {
      const upper = symbol.toUpperCase();
      positions = positions.filter((p) => p.instrument.symbol.toUpperCase().includes(upper));
    }
    return positions;
  }

  async getQuotes(symbols: string[]): Promise<Record<string, BrokerQuote>> {
    const contracts = await Promise.all(symbols.map((symbol) => this.resolveQuoteContract(symbol)));
    const resolvedContracts = contracts.filter(
      (contract): contract is QuoteContract => contract !== undefined
    );
    if (!resolvedContracts.length) return {};

    const conids = resolvedContracts.map((contract) => contract.conid).join(",");
    const params = { conids, fields: QUOTE_FIELDS };
    await this.req<unknown>({ path: "iserver/marketdata/snapshot", params });
    await sleep(2000);
    const snapshots = await this.req<IbkrMarketDataSnapshot[]>({
      path: "iserver/marketdata/snapshot",
      params,
    });

    const snapshotByConid = new Map(
      snapshots
        .filter(
          (snapshot): snapshot is IbkrMarketDataSnapshot & { conid: number } =>
            snapshot.conid !== undefined
        )
        .map((snapshot) => [snapshot.conid, snapshot])
    );
    const quotes: Record<string, BrokerQuote> = {};

    for (const contract of resolvedContracts) {
      const snapshot = snapshotByConid.get(contract.conid);
      if (snapshot === undefined) continue;
      const history = await this.fetchQuoteHistory(contract.conid);
      const quote = this.normalizeQuote(contract, snapshot, history);
      quotes[contract.requestedSymbol] = quote;
      quotes[contract.symbol] = quote;
    }

    return quotes;
  }

  async searchInstruments(
    symbol: string,
    projection: BrokerInstrumentSearchProjection
  ): Promise<BrokerInstrument[]> {
    if (projection !== "symbol-search" && projection !== "search") {
      throw new Error(
        `IBKR search currently supports only symbol-search/search projections (got '${projection}').`
      );
    }

    const query = symbol.trim().toUpperCase();
    if (!query) return [];

    const response = await this.req<IbkrStocksResponse>({
      path: "trsrv/stocks",
      params: { symbols: query },
    });

    return (response[query] ?? []).flatMap((listing) => this.normalizeStockListing(query, listing));
  }

  async fetchTransactionHistory(
    startDate: Date,
    endDate: Date
  ): Promise<BrokerTransactionHistory[]> {
    const accountId = await this.getAccountId();
    const rows = await this.fetchAllPositions(accountId);
    const positionsByConid = new Map(
      rows
        .filter((p): p is IbkrPosition & { conid: number } => p.conid !== undefined)
        .map((p) => [p.conid, p])
    );
    const transactionsByKey = new Map<string, BrokerTransaction>();
    const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1);

    for (const conid of positionsByConid.keys()) {
      const response = await this.req<IbkrTransactionsResponse>({
        path: "pa/transactions",
        method: "POST",
        data: {
          acctIds: [accountId],
          conids: [conid],
          currency: process.env["IBKR_TRANSACTION_CURRENCY"] ?? "USD",
          days,
        },
      });

      for (const transaction of response.transactions ?? []) {
        const normalized = this.normalizeTransaction(transaction, positionsByConid);
        const time = new Date(normalized.time).getTime();
        if (time < startDate.getTime() || time > endDate.getTime()) continue;
        transactionsByKey.set(this.transactionKey(normalized), normalized);
      }
    }

    return [
      {
        accountNumber: accountId,
        transactions: [...transactionsByKey.values()],
      },
    ];
  }

  async fetchOrders(options: BrokerOrdersOptions): Promise<BrokerAccountOrders[]> {
    const accountId = await this.getAccountId();
    await this.prepareBrokerageAccount(accountId);

    const params: Record<string, string | boolean> = {};
    if (options.status) {
      params["filters"] = this.ibkrStatusFilter(options.status);
    }

    const response = await this.req<IbkrLiveOrdersResponse>({
      path: "iserver/account/orders",
      params,
    });

    let orders = (response.orders ?? [])
      .filter((order) => this.orderBelongsToAccount(order, accountId))
      .map((order) => this.normalizeOrder(order))
      .filter((order) =>
        this.orderInDateRange(order, options.fromEnteredTime, options.toEnteredTime)
      )
      .sort((a, b) => this.orderTimeMs(b) - this.orderTimeMs(a));

    if (options.maxResults !== undefined) {
      orders = orders.slice(0, options.maxResults);
    }

    return [
      {
        accountNumber: accountId,
        orders,
      },
    ];
  }

  private async prepareBrokerageAccount(accountId: string): Promise<void> {
    const brokerageAccounts = await this.req<IbkrBrokerageAccountsResponse>({
      path: "iserver/accounts",
    });
    if (brokerageAccounts.selectedAccount === accountId) return;
    if (
      brokerageAccounts.accounts !== undefined &&
      !brokerageAccounts.accounts.includes(accountId)
    ) {
      throw new Error(`IBKR account ${accountId} is not available for trading/order queries.`);
    }

    await this.req<IbkrSwitchAccountResponse>({
      path: "iserver/account",
      method: "POST",
      data: { acctId: accountId },
    });
  }

  /** Page through the positions endpoint until it stops returning rows. */
  private async fetchAllPositions(accountId: string): Promise<IbkrPosition[]> {
    const out: IbkrPosition[] = [];
    let page = 0;
    for (;;) {
      const rows = await this.req<IbkrPosition[]>({
        path: `portfolio/${accountId}/positions/${String(page)}`,
      });
      if (!rows.length) break;
      out.push(...rows);
      page += 1;
    }
    return out;
  }

  /** Return { conid: day P&L }. Snapshots need a warm-up call before data lands. */
  private async fetchDayPnl(conids: string[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (!conids.length) return result;

    const params = { conids: conids.join(","), fields: DAY_PNL_FIELD };
    await this.req<unknown>({ path: "iserver/marketdata/snapshot", params }); // warm up
    await sleep(2000);
    const snapshot = await this.req<IbkrMarketDataSnapshot[]>({
      path: "iserver/marketdata/snapshot",
      params,
    });

    for (const row of snapshot) {
      const raw = row[DAY_PNL_FIELD];
      if (raw !== undefined && row.conid !== undefined) {
        result.set(row.conid, toNumber(raw));
      }
    }
    return result;
  }

  private normalizePosition(p: IbkrPosition, dayPnl: Map<number, number>): BrokerPosition {
    const qty = p.position ?? 0;
    const assetClass = p.assetClass ?? "";
    const openPnl = toNumber(p.unrealizedPnl);
    return {
      instrument: {
        symbol: p.contractDesc ?? String(p.conid ?? "-"),
        assetType: ASSET_CLASS_LABELS[assetClass] ?? (assetClass || "-"),
      },
      longQuantity: qty > 0 ? qty : 0,
      shortQuantity: qty < 0 ? Math.abs(qty) : 0,
      averagePrice: toNumber(p.avgPrice),
      marketValue: toNumber(p.mktValue),
      currentDayProfitLoss: p.conid !== undefined ? (dayPnl.get(p.conid) ?? 0) : 0,
      // IBKR reports a single unrealized P/L; attribute it to the held leg so the
      // shared handler (which reads long/short open P/L separately) renders it.
      longOpenProfitLoss: qty > 0 ? openPnl : 0,
      shortOpenProfitLoss: qty < 0 ? openPnl : 0,
    };
  }

  private normalizeStockListing(symbol: string, listing: IbkrStockListing): BrokerInstrument[] {
    const assetType = listing.assetClass === "STK" ? "EQUITY" : listing.assetClass;
    const contracts = listing.contracts ?? [];
    if (!contracts.length) {
      return [
        {
          symbol,
          ...(listing.name !== undefined ? { description: listing.name } : {}),
          ...(assetType !== undefined ? { assetType } : {}),
        },
      ];
    }

    return contracts.map((contract) => this.normalizeStockContract(symbol, listing, contract));
  }

  private normalizeStockContract(
    symbol: string,
    listing: IbkrStockListing,
    contract: IbkrStockContract
  ): BrokerInstrument {
    const assetType = listing.assetClass === "STK" ? "EQUITY" : listing.assetClass;

    return {
      symbol,
      ...(listing.name !== undefined ? { description: listing.name } : {}),
      ...(contract.exchange !== undefined ? { exchange: contract.exchange } : {}),
      ...(assetType !== undefined ? { assetType } : {}),
      ...(contract.conid !== undefined ? { brokerId: String(contract.conid) } : {}),
    };
  }

  private async resolveQuoteContract(symbol: string): Promise<QuoteContract | undefined> {
    const instruments = await this.searchInstruments(symbol, "symbol-search");
    const instrument = instruments.find((item) => item.brokerId !== undefined);
    if (instrument?.brokerId === undefined) return undefined;
    const conid = parseInt(instrument.brokerId, 10);
    if (Number.isNaN(conid)) return undefined;

    return {
      requestedSymbol: symbol,
      symbol: instrument.symbol ?? symbol.toUpperCase(),
      conid,
      ...(instrument.description !== undefined ? { description: instrument.description } : {}),
      ...(instrument.exchange !== undefined ? { exchange: instrument.exchange } : {}),
    };
  }

  private async fetchQuoteHistory(
    conid: number
  ): Promise<IbkrMarketDataHistoryResponse | undefined> {
    try {
      return await this.req<IbkrMarketDataHistoryResponse>({
        path: "iserver/marketdata/history",
        params: {
          conid: String(conid),
          period: "5d",
          bar: "1d",
          outsideRth: true,
        },
      });
    } catch {
      return undefined;
    }
  }

  private normalizeQuote(
    contract: QuoteContract,
    snapshot: IbkrMarketDataSnapshot,
    history: IbkrMarketDataHistoryResponse | undefined
  ): BrokerQuote {
    const symbol = this.snapshotString(snapshot, "55") ?? contract.symbol;
    const description =
      this.snapshotString(snapshot, "58") ?? history?.text ?? contract.description;
    const exchange = this.snapshotString(snapshot, "6004") ?? contract.exchange;
    const latestBar = this.latestHistoryBar(history);
    const previousBar = this.previousHistoryBar(history);
    const snapshotLastPrice = this.snapshotNumber(snapshot, "31");
    const lastPrice = this.snapshotHasPrefix(snapshot, "31", "C")
      ? (latestBar?.c ?? snapshotLastPrice)
      : (snapshotLastPrice ?? latestBar?.c);
    const bidPrice = this.snapshotNumber(snapshot, "84");
    const askPrice = this.snapshotNumber(snapshot, "86");
    const closePrice = previousBar?.c;
    const highPrice = this.snapshotNumber(snapshot, "70") ?? latestBar?.h;
    const lowPrice = this.snapshotNumber(snapshot, "71") ?? latestBar?.l;
    const openPrice = latestBar?.o;
    const netChange =
      this.snapshotNumber(snapshot, "82") ??
      (lastPrice !== undefined && closePrice !== undefined ? lastPrice - closePrice : undefined);
    const netPercentChange =
      this.snapshotPercent(snapshot, "83") ??
      (netChange !== undefined && closePrice !== undefined && closePrice !== 0
        ? (netChange / closePrice) * 100
        : undefined);
    const totalVolume = this.snapshotVolume(snapshot) ?? this.historyVolume(history, latestBar);

    return {
      symbol,
      reference: {
        ...(description !== undefined ? { description } : {}),
        ...(exchange !== undefined ? { exchange, exchangeName: exchange } : {}),
      },
      quote: {
        ...(lastPrice !== undefined ? { lastPrice } : {}),
        ...(bidPrice !== undefined ? { bidPrice } : {}),
        ...(askPrice !== undefined ? { askPrice } : {}),
        ...(closePrice !== undefined ? { closePrice } : {}),
        ...(highPrice !== undefined ? { highPrice } : {}),
        ...(lowPrice !== undefined ? { lowPrice } : {}),
        ...(openPrice !== undefined ? { openPrice } : {}),
        ...(netChange !== undefined ? { netChange } : {}),
        ...(netPercentChange !== undefined ? { netPercentChange } : {}),
        ...(totalVolume !== undefined ? { totalVolume } : {}),
      },
    };
  }

  private latestHistoryBar(
    history: IbkrMarketDataHistoryResponse | undefined
  ): IbkrMarketDataHistoryBar | undefined {
    return history?.data?.at(-1);
  }

  private previousHistoryBar(
    history: IbkrMarketDataHistoryResponse | undefined
  ): IbkrMarketDataHistoryBar | undefined {
    return history?.data?.at(-2);
  }

  private historyVolume(
    history: IbkrMarketDataHistoryResponse | undefined,
    bar: IbkrMarketDataHistoryBar | undefined
  ): number | undefined {
    if (bar?.v === undefined) return undefined;
    return bar.v * (history?.volumeFactor ?? 1);
  }

  private snapshotString(snapshot: IbkrMarketDataSnapshot, field: string): string | undefined {
    const value = snapshot[field];
    if (value === undefined) return undefined;
    const stringValue = String(value).trim();
    return stringValue ? stringValue : undefined;
  }

  private snapshotNumber(snapshot: IbkrMarketDataSnapshot, field: string): number | undefined {
    const value = this.snapshotString(snapshot, field);
    if (value === undefined) return undefined;
    const cleaned = value.replace(/^[A-Z]\s*/i, "").replace(/,/g, "");
    const parsed = parseFloat(cleaned);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private snapshotHasPrefix(
    snapshot: IbkrMarketDataSnapshot,
    field: string,
    prefix: string
  ): boolean {
    return this.snapshotString(snapshot, field)?.toUpperCase().startsWith(prefix) ?? false;
  }

  private snapshotPercent(snapshot: IbkrMarketDataSnapshot, field: string): number | undefined {
    const value = this.snapshotString(snapshot, field);
    if (value === undefined) return undefined;
    const cleaned = value.replace(/[%+,]/g, "");
    const parsed = parseFloat(cleaned);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private snapshotVolume(snapshot: IbkrMarketDataSnapshot): number | undefined {
    const unformatted = this.snapshotNumber(snapshot, "7762");
    if (unformatted !== undefined) return unformatted;

    const value = this.snapshotString(snapshot, "87");
    if (value === undefined) return undefined;
    const match = /^(?<amount>[\d,.]+)\s*(?<suffix>[KMB])?$/i.exec(value);
    const amount = match?.groups?.["amount"];
    if (amount === undefined) return undefined;
    const parsed = parseFloat(amount.replace(/,/g, ""));
    if (Number.isNaN(parsed)) return undefined;

    const suffix = match?.groups?.["suffix"]?.toUpperCase();
    if (suffix === "B") return parsed * 1_000_000_000;
    if (suffix === "M") return parsed * 1_000_000;
    if (suffix === "K") return parsed * 1_000;
    return parsed;
  }

  private normalizeTransaction(
    transaction: IbkrTransaction,
    positionsByConid: ReadonlyMap<number, IbkrPosition>
  ): BrokerTransaction {
    const conid = transaction.conid;
    const position = conid !== undefined ? positionsByConid.get(conid) : undefined;
    const assetType =
      position?.assetClass !== undefined
        ? (ASSET_CLASS_LABELS[position.assetClass] ?? position.assetClass)
        : undefined;
    const symbol = position?.contractDesc ?? (conid !== undefined ? String(conid) : undefined);
    const description = transaction.desc ?? symbol;
    const time = this.parseTransactionTime(transaction)?.toISOString() ?? "";
    const type = (transaction.type ?? "TRANSACTION").toUpperCase();

    const transferItem = {
      instrument: {
        ...(assetType !== undefined ? { assetType } : {}),
        ...(symbol !== undefined ? { symbol } : {}),
        ...(description !== undefined ? { description } : {}),
      },
      ...(transaction.qty !== undefined ? { amount: transaction.qty } : {}),
      ...(transaction.pr !== undefined ? { cost: transaction.pr } : {}),
      transferItemType: type,
    };

    const activityId = [
      conid !== undefined ? String(conid) : "unknown",
      time,
      transaction.qty !== undefined ? String(transaction.qty) : "",
      transaction.amt !== undefined ? String(transaction.amt) : "",
    ].join(":");

    return {
      activityId,
      time,
      type,
      status: "VALID",
      ...(transaction.acctid !== undefined ? { subAccount: transaction.acctid } : {}),
      ...(description !== undefined ? { description } : {}),
      netAmount: toNumber(transaction.amt),
      transferItems: [transferItem],
    };
  }

  private normalizeOrder(order: IbkrLiveOrder): BrokerOrder {
    const description =
      order.orderDescriptionWithContract ??
      order.order_description_with_contract ??
      order.orderDesc ??
      order.orderDescription ??
      order.order_description;
    const symbol =
      order.description1 ??
      order.contract_description_1 ??
      order.contractDescription1 ??
      order.symbol ??
      order.ticker;
    const quantity =
      this.firstPositiveNumber(order.total_size, order.totalSize, order.size) ??
      this.quantityFromDescription(description);
    const filledQuantity =
      this.firstNumber(order.cum_fill, order.cumFill, order.filledQuantity) ??
      this.filledQuantityFromSizeAndFills(order.size_and_fills ?? order.sizeAndFills);
    const remainingQuantity =
      order.remainingQuantity !== undefined
        ? toNumber(order.remainingQuantity)
        : quantity !== undefined && filledQuantity !== undefined
          ? Math.max(0, quantity - filledQuantity)
          : undefined;
    const status = this.normalizeOrderStatus(
      order.order_status ?? order.orderStatus ?? order.status
    );
    const price = this.firstPositiveNumber(
      order.limitPrice,
      order.price,
      order.avgPrice,
      order.average_price,
      order.averagePrice
    );
    const stopPrice = this.firstPositiveNumber(order.stopPrice);

    const orderId = order.order_id ?? order.orderId;
    const enteredTime = this.parseOrderTime(order)?.toISOString();
    const orderType = this.normalizeOrderType(order.order_type ?? order.orderType);

    return {
      ...(orderId !== undefined ? { orderId } : {}),
      ...(enteredTime !== undefined ? { enteredTime } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(orderType !== undefined ? { orderType } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(filledQuantity !== undefined ? { filledQuantity } : {}),
      ...(remainingQuantity !== undefined ? { remainingQuantity } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(stopPrice !== undefined ? { stopPrice } : {}),
      orderLegCollection: [this.normalizeOrderLeg(order, symbol)],
    };
  }

  private normalizeOrderLeg(order: IbkrLiveOrder, symbol: string | undefined): BrokerOrderLeg {
    const fallbackSymbol = symbol ?? (order.conid !== undefined ? String(order.conid) : undefined);
    const instruction = this.normalizeOrderSide(order.side);
    return {
      ...(instruction !== undefined ? { instruction } : {}),
      instrument: {
        ...(fallbackSymbol !== undefined ? { symbol: fallbackSymbol } : {}),
      },
    };
  }

  private normalizeOrderStatus(status: string | undefined): string | undefined {
    if (!status) return undefined;
    const normalized = status
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/\s+/g, "_")
      .toUpperCase();
    return normalized === "CANCELLED" ? "CANCELED" : normalized;
  }

  private normalizeOrderType(type: string | undefined): string | undefined {
    if (!type) return undefined;
    if (type === "MKT") return "MARKET";
    if (type === "LMT") return "LIMIT";
    if (type === "STP") return "STOP";
    return type.replace(/\s+/g, "_").toUpperCase();
  }

  private normalizeOrderSide(side: string | undefined): string | undefined {
    if (!side) return undefined;
    const upper = side.toUpperCase();
    if (upper === "B" || upper === "BUY") return "BUY";
    if (upper === "S" || upper === "SELL") return "SELL";
    return upper;
  }

  private ibkrStatusFilter(status: string): string {
    const normalized = status.toUpperCase();
    return IBKR_STATUS_FILTERS[normalized] ?? normalized.toLowerCase();
  }

  private orderBelongsToAccount(order: IbkrLiveOrder, accountId: string): boolean {
    const account = order.account ?? order.acct;
    return account === undefined || account === accountId;
  }

  private orderInDateRange(order: BrokerOrder, fromDate: Date, toDate: Date): boolean {
    const timeMs = this.orderTimeMs(order);
    if (!Number.isFinite(timeMs)) return true;
    return timeMs >= fromDate.getTime() && timeMs <= toDate.getTime();
  }

  private orderTimeMs(order: BrokerOrder): number {
    const parsed = order.enteredTime ? new Date(order.enteredTime).getTime() : NaN;
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  }

  private parseOrderTime(order: IbkrLiveOrder): Date | undefined {
    if (order.lastExecutionTime_r !== undefined) {
      const parsed = new Date(order.lastExecutionTime_r);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const value = order.order_time ?? order.orderTime ?? order.lastExecutionTime;
    if (!value) return undefined;
    const compact = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
    if (compact) {
      const [, yy, month, day, hour, minute, second] = compact;
      const year = 2000 + parseInt(yy ?? "0", 10);
      return new Date(
        Date.UTC(
          year,
          parseInt(month ?? "1", 10) - 1,
          parseInt(day ?? "1", 10),
          parseInt(hour ?? "0", 10),
          parseInt(minute ?? "0", 10),
          parseInt(second ?? "0", 10)
        )
      );
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private firstNumber(...values: (string | number | undefined)[]): number | undefined {
    for (const value of values) {
      if (value === undefined) continue;
      const numeric = toNumber(value);
      if (!Number.isNaN(numeric)) return numeric;
    }
    return undefined;
  }

  private firstPositiveNumber(...values: (string | number | undefined)[]): number | undefined {
    for (const value of values) {
      const numeric = this.firstNumber(value);
      if (numeric !== undefined && numeric > 0) return numeric;
    }
    return undefined;
  }

  private quantityFromDescription(description: string | undefined): number | undefined {
    if (!description) return undefined;
    const match = /\b(?:Bought|Sold|Buy|Sell)\s+(?<quantity>[\d.]+)/i.exec(description);
    const quantity = match?.groups?.["quantity"];
    if (!quantity) return undefined;
    const parsed = parseFloat(quantity);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private filledQuantityFromSizeAndFills(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const match = /(?<quantity>[\d.]+)/.exec(value);
    const quantity = match?.groups?.["quantity"];
    if (!quantity) return undefined;
    const parsed = parseFloat(quantity);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private parseTransactionTime(transaction: IbkrTransaction): Date | undefined {
    if (transaction.rawDate && /^\d{8}$/.test(transaction.rawDate)) {
      const year = transaction.rawDate.slice(0, 4);
      const month = transaction.rawDate.slice(4, 6);
      const day = transaction.rawDate.slice(6, 8);
      return new Date(`${year}-${month}-${day}T00:00:00`);
    }

    const value = transaction.date;
    if (!value) return undefined;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const match =
      /^(?:\w{3}) (?<month>\w{3}) (?<day>\d{1,2}) (?<time>\d{2}:\d{2}:\d{2}) (?<zone>\w{3}) (?<year>\d{4})$/.exec(
        value
      );
    if (!match?.groups) return undefined;

    const zoneOffsets: Record<string, string> = {
      EST: "-05:00",
      EDT: "-04:00",
      CST: "-06:00",
      CDT: "-05:00",
      MST: "-07:00",
      MDT: "-06:00",
      PST: "-08:00",
      PDT: "-07:00",
      UTC: "Z",
      GMT: "Z",
    };
    const month = match.groups["month"];
    const day = match.groups["day"];
    const time = match.groups["time"];
    const zone = match.groups["zone"];
    const year = match.groups["year"];
    if (!month || !day || !time || !zone || !year) return undefined;

    const offset = zoneOffsets[zone] ?? "Z";
    const normalized = `${day.padStart(2, "0")} ${month} ${year} ${time} ${offset}`;
    const fallback = new Date(normalized);
    return Number.isNaN(fallback.getTime()) ? undefined : fallback;
  }

  private transactionKey(transaction: BrokerTransaction): string {
    return [
      transaction.activityId,
      transaction.time,
      transaction.type,
      transaction.netAmount,
      transaction.transferItems?.[0]?.amount ?? "",
    ].join(":");
  }

  /** Typed wrapper around the raw client's untyped `request()`. */
  private async req<T>(input: {
    path: string;
    method?: string;
    params?: Record<string, string | number | boolean | null | undefined>;
    data?: object;
  }): Promise<T> {
    return (await this.raw.request(input)) as T;
  }
}
