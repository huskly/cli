import type { BrokerPosition as IbkrPosition, IbkrClient } from "@huskly/ibkr-client";
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

function listCompleteness(value: readonly unknown[]): ObservationCompleteness {
  return value.length === 0 ? "empty" : "available";
}

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

  async getAccountBalances() {
    const balances = await this.client.getAccountBalances();
    const value: AccountBalances = {
      liquidationValue: balances.netLiquidation,
      equity: balances.netLiquidation,
      cashBalance: balances.cashBalance,
      ...(balances.margin.total.initialMarginRequirement !== null
        ? { marginBalance: balances.margin.total.initialMarginRequirement }
        : {}),
      availableFunds: balances.availableFunds,
      buyingPower: balances.buyingPower,
    };
    return observe(value, "available", null);
  }

  async getPositions(symbol?: string) {
    const positions = (await this.client.getPositions(symbol)).map((position) => this.mapPosition(position));
    return observe(positions, listCompleteness(positions), null);
  }

  async getQuotes(symbols: string[]) {
    const quotes = await this.client.getQuotes(symbols.map((symbol) => ({ symbol })));
    return observe(
      quotes as Record<string, BrokerQuote>,
      Object.keys(quotes).length === 0 ? "empty" : "available",
      null,
    );
  }

  async searchInstruments(symbol: string, projection: BrokerInstrumentSearchProjection) {
    const instruments = await this.client.searchInstruments(symbol, projection);
    return observe(instruments as BrokerInstrument[], listCompleteness(instruments as BrokerInstrument[]), null);
  }

  async fetchTransactionHistory(startDate: Date, endDate: Date) {
    const history = await this.client.fetchTransactionHistory(startDate, endDate);
    return observe(history as BrokerTransactionHistory[], listCompleteness(history as BrokerTransactionHistory[]), null);
  }

  async fetchOrders(options: BrokerOrdersOptions) {
    const orders = await this.client.fetchOrders(options);
    return observe(orders as BrokerAccountOrders[], listCompleteness(orders as BrokerAccountOrders[]), null);
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
