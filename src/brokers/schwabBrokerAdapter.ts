import type { CachedSchwabClient } from "#src/cachedSchwabClient.js";
import type { SchwabOrderStatus } from "@huskly/schwab-client";
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
  type Observation,
} from "#src/brokers/brokerClient.js";

/**
 * Adapts {@link CachedSchwabClient} to the broker-neutral {@link BrokerClient}.
 *
 * Schwab's `getAccountBalances` / `getPositions` already return the exact shapes
 * the normalized interface adopts, so this is a thin pass-through that simply
 * narrows the wider Schwab types to the shared contract.
 */
export class SchwabBrokerAdapter implements BrokerClient {
  constructor(private readonly client: CachedSchwabClient) {}

  async getAccountBalances(): Promise<Observation<AccountBalances>> {
    return observe(await this.client.getAccountBalances(), "unspecified", null);
  }

  async getPositions(symbol?: string): Promise<Observation<BrokerPosition[]>> {
    return observe(await this.client.getPositions(symbol), "unspecified", null);
  }

  async getQuotes(symbols: string[]): Promise<Observation<Record<string, BrokerQuote>>> {
    const raw = await this.client.getQuotes(symbols);
    const result: Record<string, BrokerQuote> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return observe(result, "unspecified", null);
  }

  async searchInstruments(
    symbol: string,
    projection: BrokerInstrumentSearchProjection
  ): Promise<Observation<BrokerInstrument[]>> {
    return observe(await this.client.searchInstruments(symbol, projection), "unspecified", null);
  }

  async fetchTransactionHistory(
    startDate: Date,
    endDate: Date
  ): Promise<Observation<BrokerTransactionHistory[]>> {
    return observe(
      await this.client.fetchTransactionHistory(startDate, endDate),
      "unspecified",
      null
    );
  }

  async fetchOrders(options: BrokerOrdersOptions): Promise<Observation<BrokerAccountOrders[]>> {
    const fetchOptions: Parameters<CachedSchwabClient["fetchOrders"]>[0] = {
      fromEnteredTime: options.fromEnteredTime,
      toEnteredTime: options.toEnteredTime,
    };
    if (options.maxResults !== undefined) {
      fetchOptions.maxResults = options.maxResults;
    }
    if (options.status !== undefined) {
      fetchOptions.status = options.status as SchwabOrderStatus;
    }

    const orders = await this.client.fetchOrders(fetchOptions);
    return observe(
      orders.map((account) => ({
        accountNumber: account.accountNumber,
        orders: account.orders,
      })),
      "unspecified",
      null
    );
  }
}
