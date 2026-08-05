import type { BrokerPosition as IbkrPosition, IbkrClient } from "@huskly/ibkr-client";
import type {
  AccountBalances,
  BrokerAccountOrders,
  BrokerClient,
  BrokerInstrument,
  BrokerInstrumentSearchProjection,
  BrokerOrdersOptions,
  BrokerPosition,
  BrokerQuote,
  BrokerTransactionHistory,
} from "./brokerClient.js";

/**
 * Adapts {@link IbkrClient}'s broker-neutral domain objects to the legacy
 * Schwab-shaped objects rendered by this CLI.
 *
 * @remarks
 * Transport, authentication, response normalization, and broker behavior live
 * in `@huskly/ibkr-client`; this adapter only maps presentation contracts.
 */
export class IbkrBrokerAdapter implements BrokerClient {
  constructor(private readonly client: IbkrClient) {}

  async getAccountBalances(): Promise<AccountBalances> {
    const balances = await this.client.getAccountBalances();
    return {
      liquidationValue: balances.netLiquidation,
      equity: balances.netLiquidation,
      cashBalance: balances.cashBalance,
      marginBalance: balances.marginBalance,
      availableFunds: balances.availableFunds,
      buyingPower: balances.buyingPower,
    };
  }

  async getPositions(symbol?: string): Promise<BrokerPosition[]> {
    return (await this.client.getPositions(symbol)).map((position) => this.mapPosition(position));
  }

  async getQuotes(symbols: string[]): Promise<Record<string, BrokerQuote>> {
    return this.client.getQuotes(symbols);
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
    return this.client.fetchOrders(options);
  }

  private mapPosition(position: IbkrPosition): BrokerPosition {
    const quantity = position.longQuantity - position.shortQuantity;
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
