import type { CachedSchwabClient } from "#src/cachedSchwabClient.js";
import type {
  AccountBalances,
  BrokerClient,
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

  async fetchTransactionHistory(
    startDate: Date,
    endDate: Date
  ): Promise<BrokerTransactionHistory[]> {
    return this.client.fetchTransactionHistory(startDate, endDate);
  }
}
