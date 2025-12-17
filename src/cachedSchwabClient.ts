import type { SchwabOrderRequest, SchwabClient } from "@huskly/schwab-client";
import { cacheFetch } from "#src/cache.js";

// Cache TTLs in seconds
const CACHE_TTL = {
  QUOTES: 60, // 1 minute - quotes change frequently
  PRICE_HISTORY: 60 * 60, // 1 hour - historical data is stable
  EXPIRIES: 60 * 60, // 1 hour - expiries don't change often
  OPTION_CHAIN: 5 * 60, // 5 minutes - option prices change
  ACCOUNT_BALANCES: 2 * 60, // 2 minutes - balances can change with trades
  POSITIONS: 2 * 60, // 2 minutes - positions change with trades
  TRANSACTIONS: 30 * 60, // 30 minutes - historical data
  ORDERS: 5 * 60, // 5 minutes - order status can change
  MOVERS: 5 * 60, // 5 minutes - movers change throughout the day
  SEARCH: 60 * 60, // 1 hour - instrument data is stable
  USER_PREFERENCE: 24 * 60 * 60, // 1 day - preferences rarely change
  VIX: 60, // 1 minute - VIX changes throughout the day
  ACCOUNT_NUMBERS: 24 * 60 * 60, // 1 day - account numbers don't change
} as const;

/**
 * A wrapper around SchwabClient that adds Redis caching for API calls.
 * All read-only operations are cached with appropriate TTLs.
 * Write operations (like placeOrder) are not cached.
 */
export class CachedSchwabClient {
  constructor(private readonly client: SchwabClient) {}

  /**
   * Get quotes for multiple symbols.
   * Cached for 1 minute.
   */
  async getQuotes(symbols: string[]) {
    return cacheFetch(
      `quotes:${symbols.sort().join(",")}`,
      () => this.client.getQuotes(symbols),
      CACHE_TTL.QUOTES
    );
  }

  /**
   * Get price history for a symbol.
   * Cached for 1 hour.
   */
  async getPriceHistory(params: { symbol: string; days: number }) {
    return cacheFetch(
      `price_history:${params.symbol}:${String(params.days)}`,
      () => this.client.getPriceHistory(params),
      CACHE_TTL.PRICE_HISTORY
    );
  }

  /**
   * Get available expiries for options.
   * Cached for 1 hour.
   */
  async getAvailableExpiries(
    symbol: string,
    contractType: "PUT" | "CALL",
    fromDate: string,
    toDate: string
  ) {
    return cacheFetch(
      `expiries:${symbol}:${contractType}:${fromDate}:${toDate}`,
      () => this.client.getAvailableExpiries(symbol, contractType, fromDate, toDate),
      CACHE_TTL.EXPIRIES
    );
  }

  /**
   * Get option chain for a symbol and expiry.
   * Cached for 5 minutes.
   */
  async getOptionChain(symbol: string, expiry: Date) {
    const expiryStr = expiry.toISOString().split("T")[0] ?? "";
    return cacheFetch(
      `option_chain:${symbol}:${expiryStr}`,
      () => this.client.getOptionChain(symbol, expiry),
      CACHE_TTL.OPTION_CHAIN
    );
  }

  /**
   * Get account balances.
   * Cached for 2 minutes.
   */
  async getAccountBalances() {
    return cacheFetch(
      "account_balances",
      () => this.client.getAccountBalances(),
      CACHE_TTL.ACCOUNT_BALANCES
    );
  }

  /**
   * Get positions, optionally filtered by symbol.
   * Cached for 2 minutes.
   */
  async getPositions(symbol?: string) {
    return cacheFetch(
      symbol ? `positions:${symbol}` : "positions:all",
      () => this.client.getPositions(symbol),
      CACHE_TTL.POSITIONS
    );
  }

  /**
   * Fetch transaction history.
   * Cached for 30 minutes.
   */
  async fetchTransactionHistory(startDate: Date, endDate: Date) {
    const startStr = startDate.toISOString().split("T")[0] ?? "";
    const endStr = endDate.toISOString().split("T")[0] ?? "";
    return cacheFetch(
      `transactions:${startStr}:${endStr}`,
      () => this.client.fetchTransactionHistory(startDate, endDate),
      CACHE_TTL.TRANSACTIONS
    );
  }

  /**
   * Fetch orders.
   * Cached for 5 minutes.
   */
  async fetchOrders(options: Parameters<SchwabClient["fetchOrders"]>[0]) {
    const fromStr = options.fromEnteredTime.toISOString().split("T")[0] ?? "";
    const toStr = options.toEnteredTime.toISOString().split("T")[0] ?? "";
    const statusKey = options.status ?? "all";
    const maxKey = options.maxResults !== undefined ? String(options.maxResults) : "default";
    return cacheFetch(
      `orders:${fromStr}:${toStr}:${statusKey}:${maxKey}`,
      () => this.client.fetchOrders(options),
      CACHE_TTL.ORDERS
    );
  }

  /**
   * Get market movers.
   * Cached for 5 minutes.
   */
  async getMovers(
    ...args: Parameters<SchwabClient["getMovers"]>
  ): ReturnType<SchwabClient["getMovers"]> {
    const [indexSymbol, sort, frequency] = args;
    const sortKey = sort ?? "default";
    const freqKey = frequency !== undefined ? String(frequency) : "default";
    return cacheFetch(
      `movers:${indexSymbol}:${sortKey}:${freqKey}`,
      () => this.client.getMovers(...args),
      CACHE_TTL.MOVERS
    );
  }

  /**
   * Search instruments.
   * Cached for 1 hour.
   */
  async searchInstruments(...args: Parameters<SchwabClient["searchInstruments"]>) {
    const [symbol, projection] = args;
    return cacheFetch(
      `search:${symbol}:${projection}`,
      () => this.client.searchInstruments(...args),
      CACHE_TTL.SEARCH
    );
  }

  /**
   * Get user preferences.
   * Cached for 1 day.
   */
  async getUserPreference() {
    const key = "user_preference";
    return cacheFetch(key, () => this.client.getUserPreference(), CACHE_TTL.USER_PREFERENCE);
  }

  /**
   * Get VIX level.
   * Cached for 1 minute.
   */
  async getVixLevel() {
    return cacheFetch("vix_level", () => this.client.getVixLevel(), CACHE_TTL.VIX);
  }

  /**
   * Fetch account numbers.
   * Cached for 1 day.
   */
  async fetchAccountNumbers() {
    return cacheFetch(
      "account_numbers",
      () => this.client.fetchAccountNumbers(),
      CACHE_TTL.ACCOUNT_NUMBERS
    );
  }

  /**
   * Place an order.
   * NOT CACHED - this is a write operation with side effects.
   */
  async placeOrder(accountHash: string, orderRequest: SchwabOrderRequest) {
    return this.client.placeOrder(accountHash, orderRequest);
  }
}
