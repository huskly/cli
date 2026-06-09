import type { CachedSchwabClient } from "#src/cachedSchwabClient.js";
import type { SchwabOrderStatus } from "@huskly/schwab-client";
import type {
  AccountBalances,
  BrokerAccountOrders,
  BrokerClient,
  BrokerInstrument,
  BrokerInstrumentSearchProjection,
  BrokerOrdersOptions,
  BrokerPosition,
  BrokerTransactionHistory,
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

  async getAccountBalances(): Promise<AccountBalances> {
    return this.client.getAccountBalances();
  }

  async getPositions(symbol?: string): Promise<BrokerPosition[]> {
    return this.client.getPositions(symbol);
  }

  async searchInstruments(
    symbol: string,
    projection: BrokerInstrumentSearchProjection
  ): Promise<BrokerInstrument[]> {
    return this.client.searchInstruments(symbol, projection);
  }

  async fetchTransactionHistory(
    startDate: Date,
    endDate: Date
  ): Promise<BrokerTransactionHistory[]> {
    return this.client.fetchTransactionHistory(startDate, endDate);
  }

  async fetchOrders(options: BrokerOrdersOptions): Promise<BrokerAccountOrders[]> {
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
    return orders.map((account) => ({
      accountNumber: account.accountNumber,
      orders: account.orders,
    }));
  }
}
