import { cacheFetch, cacheGet, cacheSet } from "#src/cache.js";
import type {
  BrokerAccountOrders,
  BrokerClient,
  BrokerInstrumentSearchProjection,
  BrokerOrdersOptions,
  Observation,
} from "#src/brokers/brokerClient.js";

interface OrdersCache {
  get(key: string): Promise<Observation<BrokerAccountOrders[]> | null>;
  set(key: string, value: Observation<BrokerAccountOrders[]>, ttl: number): Promise<void>;
}

const redisOrdersCache: OrdersCache = {
  get: (key) => cacheGet<Observation<BrokerAccountOrders[]>>(key),
  set: async (key, value, ttl) => {
    await cacheSet(key, value, ttl);
  },
};

const CACHE_TTL = {
  QUOTES: 60,
  ACCOUNT_BALANCES: 2 * 60,
  POSITIONS: 2 * 60,
  TRANSACTIONS: 30 * 60,
  ORDERS: 5 * 60,
  SEARCH: 60 * 60,
} as const;

/**
 * Redis-backed decorator for the IBKR broker client.
 *
 * @remarks
 * The wrapped client is created lazily so cache hits can avoid the expensive
 * IBKR OAuth/session-token startup path entirely.
 */
export class CachedIbkrClient implements BrokerClient {
  private clientPromise?: Promise<BrokerClient>;

  constructor(
    private readonly createClient: () => Promise<BrokerClient>,
    private readonly ordersCache: OrdersCache = redisOrdersCache
  ) {}

  async getAccountBalances() {
    return cacheFetch(
      "ibkr:account_balances",
      () => this.client().then((client) => client.getAccountBalances()),
      CACHE_TTL.ACCOUNT_BALANCES
    );
  }

  async getPositions(symbol?: string) {
    const normalizedSymbol = symbol?.trim().toUpperCase();
    const symbolKey =
      normalizedSymbol === undefined || normalizedSymbol === "" ? "all" : normalizedSymbol;
    return cacheFetch(
      `ibkr:positions:${symbolKey}`,
      () => this.client().then((client) => client.getPositions(symbol)),
      CACHE_TTL.POSITIONS
    );
  }

  async getQuotes(symbols: string[]) {
    const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
    const quoteKey = `ibkr:quotes:${uniqueSymbols.map((symbol) => symbol.toUpperCase()).sort().join(',')}`;
    return cacheFetch(
      quoteKey,
      () => this.client().then((client) => client.getQuotes(uniqueSymbols)),
      CACHE_TTL.QUOTES
    );
  }

  async searchInstruments(symbol: string, projection: BrokerInstrumentSearchProjection) {
    const symbolKey = symbol.trim().toUpperCase();
    return cacheFetch(
      `ibkr:search:${symbolKey}:${projection}`,
      () => this.client().then((client) => client.searchInstruments(symbol, projection)),
      CACHE_TTL.SEARCH
    );
  }

  async fetchTransactionHistory(startDate: Date, endDate: Date) {
    const startStr = startDate.toISOString().split("T")[0] ?? "";
    const endStr = endDate.toISOString().split("T")[0] ?? "";
    return cacheFetch(
      `ibkr:transactions:${startStr}:${endStr}`,
      () => this.client().then((client) => client.fetchTransactionHistory(startDate, endDate)),
      CACHE_TTL.TRANSACTIONS
    );
  }

  async fetchOrders(options: BrokerOrdersOptions) {
    const fromStr = options.fromEnteredTime.toISOString().split("T")[0] ?? "";
    const toStr = options.toEnteredTime.toISOString().split("T")[0] ?? "";
    const statusKey = options.status ?? "all";
    const maxKey = options.maxResults !== undefined ? String(options.maxResults) : "default";
    const key = `ibkr:orders:${fromStr}:${toStr}:${statusKey}:${maxKey}`;
    const cached = await this.ordersCache.get(key);
    if (cached !== null) return cached;

    const accountOrders = await this.client().then((client) => client.fetchOrders(options));
    if (accountOrders.value.some(({ orders }) => orders.length > 0)) {
      await this.ordersCache.set(key, accountOrders, CACHE_TTL.ORDERS);
    }
    return accountOrders;
  }

  private client(): Promise<BrokerClient> {
    this.clientPromise ??= this.createClient();
    return this.clientPromise;
  }
}
