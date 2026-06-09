import { cacheFetch, cacheGet, cacheSet } from "#src/cache.js";
import type {
  BrokerClient,
  BrokerInstrumentSearchProjection,
  BrokerOrdersOptions,
  BrokerQuote,
} from "#src/brokers/brokerClient.js";

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

  constructor(private readonly createClient: () => Promise<BrokerClient>) {}

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
    const quotes: Record<string, BrokerQuote> = {};
    const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
    const cachedQuotes = await Promise.all(
      uniqueSymbols.map(async (symbol) => ({
        symbol,
        quote: await cacheGet<BrokerQuote>(this.quoteKey(symbol)),
      }))
    );
    const missingSymbols: string[] = [];

    for (const { symbol, quote } of cachedQuotes) {
      if (quote === null) {
        missingSymbols.push(symbol);
        continue;
      }
      this.addQuoteResult(quotes, symbol, quote);
    }

    if (missingSymbols.length > 0) {
      const fetchedQuotes = await this.client().then((client) => client.getQuotes(missingSymbols));
      for (const symbol of missingSymbols) {
        const quote = fetchedQuotes[symbol] ?? fetchedQuotes[symbol.toUpperCase()];
        if (quote === undefined) continue;
        this.addQuoteResult(quotes, symbol, quote);
        await cacheSet(this.quoteKey(symbol), quote, CACHE_TTL.QUOTES);
      }
    }

    return quotes;
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
    return cacheFetch(
      `ibkr:orders:${fromStr}:${toStr}:${statusKey}:${maxKey}`,
      () => this.client().then((client) => client.fetchOrders(options)),
      CACHE_TTL.ORDERS
    );
  }

  private client(): Promise<BrokerClient> {
    this.clientPromise ??= this.createClient();
    return this.clientPromise;
  }

  private addQuoteResult(
    quotes: Record<string, BrokerQuote>,
    requestedSymbol: string,
    quote: BrokerQuote
  ): void {
    quotes[requestedSymbol] = quote;
    quotes[requestedSymbol.toUpperCase()] = quote;
    quotes[quote.symbol] = quote;
  }

  private quoteKey(symbol: string): string {
    return `ibkr:quote:${symbol.trim().toUpperCase()}`;
  }
}
