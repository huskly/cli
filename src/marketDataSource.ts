import type { OptionQuote, ExistingSpread } from "#src/types.js";

export interface PriceHistoryCandle {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistoryResponse {
  candles: PriceHistoryCandle[];
  empty: boolean;
}
export interface MarketDataSource {
  authorize(): Promise<string>;

  getRiskFreeRate(date: Date): Promise<number>;

  /* Returns a mapping of symbol -> last price */
  getQuotes(symbols: string[]): Promise<Record<string, number>>;

  // Returns an array of daily closes, most recent last
  getPriceHistory(args: {
    symbol: string;
    days?: number;
    startDate?: number;
    endDate?: number;
  }): Promise<PriceHistoryResponse["candles"]>;

  // Returns the last quote for $VIX, or undefined if not available
  getVixLevel(): Promise<number | undefined>;

  getAvailableExpiries(
    symbol: string,
    contractType: string,
    fromDate: string,
    toDate: string
  ): Promise<Date[]>;

  // Returns all option quotes for given symbol and expiry
  getOptionChain(symbol: string, expiry: Date): Promise<OptionQuote[]>;

  getOptionQuote(args: {
    symbol: string;
    expiry: Date;
    strike: number;
    type: "call" | "put";
  }): Promise<OptionQuote | null>;

  // Returns current account equity
  getAccountEquity(): Promise<number>;

  // Returns existing spreads for given symbol in the Schwab account
  getExistingSpreads(symbol: string): Promise<ExistingSpread[]>;

  today(): Date;
}
