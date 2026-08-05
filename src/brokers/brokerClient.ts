/**
 * Broker-neutral domain types shared across the CLI.
 *
 * Command handlers for the shared commands (`account`, `positions`,
 * `transactions`, `orders`) render these normalized shapes and never touch raw
 * broker JSON. Both the Schwab path
 * (via {@link SchwabBrokerAdapter}) and the IBKR path (via `IbkrBrokerAdapter`)
 * implement {@link BrokerClient}, so a single set of handlers serves either
 * broker. The field names mirror `@huskly/schwab-client`'s `getAccountBalances`
 * / `SchwabPosition` shapes so the existing handlers needed almost no change.
 */

export type BrokerName = "ibkr" | "schwab";

export type BrokerInstrumentSearchProjection =
  "symbol-search" | "symbol-regex" | "desc-search" | "desc-regex" | "search" | "fundamental";

export interface BrokerFundamentalInstrument {
  peRatio?: number;
  pegRatio?: number;
  pbRatio?: number;
  prRatio?: number;
  pcfRatio?: number;
  marketCap?: number;
  sharesOutstanding?: number;
  marketCapFloat?: number;
  eps?: number;
  epsTTM?: number;
  epsChangePercentTTM?: number;
  dividendYield?: number;
  dividendAmount?: number;
  dividendPayAmount?: number;
  dividendFreq?: number;
  high52?: number;
  low52?: number;
  grossMarginTTM?: number;
  operatingMarginTTM?: number;
  netProfitMarginTTM?: number;
  returnOnEquity?: number;
  returnOnAssets?: number;
  returnOnInvestment?: number;
  beta?: number;
  shortIntToFloat?: number;
  shortIntDayToCover?: number;
}

export interface BrokerInstrument {
  cusip?: string;
  brokerId?: string;
  symbol?: string;
  description?: string;
  exchange?: string;
  assetType?: string;
  fundamental?: BrokerFundamentalInstrument;
}

export interface BrokerQuoteReference {
  description?: string;
  exchange?: string;
  exchangeName?: string;
}

export interface BrokerQuoteData {
  "52WeekHigh"?: number;
  "52WeekLow"?: number;
  askPrice?: number;
  bidPrice?: number;
  closePrice?: number;
  highPrice?: number;
  lowPrice?: number;
  lastPrice?: number;
  mark?: number;
  netChange?: number;
  netPercentChange?: number;
  openPrice?: number;
  totalVolume?: number;
}

export interface BrokerQuoteFundamental {
  divYield?: number;
  eps?: number;
  peRatio?: number;
}

export interface BrokerQuote {
  symbol: string;
  reference: BrokerQuoteReference;
  quote: BrokerQuoteData;
  fundamental?: BrokerQuoteFundamental;
}

export interface AccountBalances {
  liquidationValue: number;
  cashBalance: number;
  marginBalance: number;
  availableFunds: number;
  buyingPower: number;
  equity: number;
}

export interface BrokerPosition {
  instrument: { assetType: string; symbol: string };
  longQuantity: number;
  shortQuantity: number;
  averagePrice: number;
  marketValue: number;
  /** P/L for the current trading day. */
  currentDayProfitLoss: number;
  /** Unrealized open P/L attributed to the long leg. */
  longOpenProfitLoss: number;
  /** Unrealized open P/L attributed to the short leg. */
  shortOpenProfitLoss: number;
}

export interface BrokerTransferItem {
  instrument?: {
    assetType?: string;
    symbol?: string;
    description?: string;
  };
  amount?: number;
  cost?: number;
  transferItemType?: string;
  feeType?: string;
}

export interface BrokerTransaction {
  activityId: string | number;
  time: string;
  type: string;
  status: string;
  subAccount?: string;
  description?: string;
  netAmount: number;
  transferItems?: BrokerTransferItem[];
}

export interface BrokerTransactionHistory {
  accountNumber: string;
  transactions: BrokerTransaction[];
}

export interface BrokerOrderLeg {
  instrument?: {
    symbol?: string;
  };
  instruction?: string;
}

export interface BrokerOrder {
  orderId?: string | number;
  enteredTime?: string;
  status?: string;
  orderType?: string;
  complexOrderStrategyType?: string;
  quantity?: number;
  filledQuantity?: number;
  remainingQuantity?: number;
  price?: number;
  stopPrice?: number;
  orderLegCollection?: BrokerOrderLeg[];
}

export interface BrokerOrdersOptions {
  fromEnteredTime: Date;
  toEnteredTime: Date;
  status?: string;
  maxResults?: number;
}

export interface BrokerAccountOrders {
  accountNumber: string;
  orders: BrokerOrder[];
}

/**
 * The contract every broker client satisfies for the shared commands. Kept
 * intentionally small; broker-specific commands continue to use the full Schwab
 * client directly.
 */
export interface BrokerClient {
  getAccountBalances(): Promise<AccountBalances>;
  getPositions(symbol?: string): Promise<BrokerPosition[]>;
  getQuotes(symbols: string[]): Promise<Record<string, BrokerQuote>>;
  searchInstruments(
    symbol: string,
    projection: BrokerInstrumentSearchProjection
  ): Promise<BrokerInstrument[]>;
  fetchTransactionHistory(startDate: Date, endDate: Date): Promise<BrokerTransactionHistory[]>;
  fetchOrders(options: BrokerOrdersOptions): Promise<BrokerAccountOrders[]>;
}
