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

export type ObservationCompleteness =
  | "available"
  | "partial"
  | "empty"
  | "unavailable"
  | "unspecified";

export interface Observation<T> {
  readonly observedAt: string | null;
  readonly completeness: ObservationCompleteness;
  readonly value: T;
}

export class BrokerDataUnavailableError extends Error {
  public readonly code = "broker_data_unavailable" as const;
  public readonly operation: string;

  public constructor(operation: string) {
    super("Broker data is unavailable");
    this.name = "BrokerDataUnavailableError";
    this.operation = operation;
  }
}

export function observe<T>(value: T, completeness: ObservationCompleteness, observedAt: string | null): Observation<T> {
  return { observedAt, completeness, value };
}

export function requireObservation<T>(
  operation: string,
  observation: Observation<T>
): Observation<T> {
  if (observation.completeness === "unavailable") {
    throw new BrokerDataUnavailableError(operation);
  }
  return observation;
}

export function isPartialObservation<T>(observation: Observation<T>): boolean {
  return observation.completeness === "partial";
}

export type BrokerInstrumentSearchProjection =
  "symbol-search" | "symbol-regex" | "desc-search" | "desc-regex" | "search" | "fundamental";

export interface BrokerFundamentalInstrument {
  peRatio?: number | null;
  pegRatio?: number | null;
  pbRatio?: number | null;
  prRatio?: number | null;
  pcfRatio?: number | null;
  marketCap?: number | null;
  sharesOutstanding?: number | null;
  marketCapFloat?: number | null;
  eps?: number | null;
  epsTTM?: number | null;
  epsChangePercentTTM?: number | null;
  dividendYield?: number | null;
  dividendAmount?: number | null;
  dividendPayAmount?: number | null;
  dividendFreq?: number | null;
  high52?: number | null;
  low52?: number | null;
  grossMarginTTM?: number | null;
  operatingMarginTTM?: number | null;
  netProfitMarginTTM?: number | null;
  returnOnEquity?: number | null;
  returnOnAssets?: number | null;
  returnOnInvestment?: number | null;
  beta?: number | null;
  shortIntToFloat?: number | null;
  shortIntDayToCover?: number | null;
}

export interface BrokerInstrument {
  cusip?: string | null;
  brokerId?: string | null;
  symbol?: string | null;
  description?: string | null;
  exchange?: string | null;
  assetType?: string | null;
  fundamental?: BrokerFundamentalInstrument;
}

export interface BrokerQuoteReference {
  description?: string | null;
  exchange?: string | null;
  exchangeName?: string | null;
}

export interface BrokerQuoteData {
  "52WeekHigh"?: number | null;
  "52WeekLow"?: number | null;
  askPrice?: number | null;
  bidPrice?: number | null;
  closePrice?: number | null;
  highPrice?: number | null;
  lowPrice?: number | null;
  lastPrice?: number | null;
  mark?: number | null;
  netChange?: number | null;
  netPercentChange?: number | null;
  openPrice?: number | null;
  totalVolume?: number | null;
}

export interface BrokerQuoteFundamental {
  divYield?: number | null;
  eps?: number | null;
  peRatio?: number | null;
}

export interface BrokerQuote {
  symbol: string;
  reference: BrokerQuoteReference;
  quote: BrokerQuoteData;
  fundamental?: BrokerQuoteFundamental;
}

export interface AccountBalances {
  liquidationValue: number | null;
  cashBalance: number | null;
  /** Schwab exposes this debt metric; IBKR has no direct equivalent. */
  marginBalance?: number | null;
  availableFunds: number | null;
  buyingPower: number | null;
  equity: number | null;
}

export interface BrokerPosition {
  instrument: { assetType: string | null; symbol: string | null };
  longQuantity: number | null;
  shortQuantity: number | null;
  averagePrice: number | null;
  marketValue: number | null;
  /** P/L for the current trading day. */
  currentDayProfitLoss: number | null;
  /** Unrealized open P/L attributed to the long leg. */
  longOpenProfitLoss: number | null;
  /** Unrealized open P/L attributed to the short leg. */
  shortOpenProfitLoss: number | null;
}

export interface BrokerTransferItem {
  instrument?: {
    assetType?: string | null;
    symbol?: string | null;
    description?: string | null;
  } | null;
  amount?: number | null;
  cost?: number | null;
  transferItemType?: string | null;
  feeType?: string | null;
}

export interface BrokerTransaction {
  activityId: string | number | null;
  time: string | null;
  type: string | null;
  status: string | null;
  subAccount?: string | null;
  description?: string | null;
  netAmount: number | null;
  transferItems?: BrokerTransferItem[];
}

export interface BrokerTransactionHistory {
  accountNumber?: string;
  transactions: BrokerTransaction[];
}

export interface BrokerOrderLeg {
  instrument?: {
    symbol?: string | null;
  } | null;
  instruction?: string | null;
}

export interface BrokerOrder {
  orderId?: string | number | null;
  enteredTime?: string | null;
  status?: string | null;
  orderType?: string | null;
  complexOrderStrategyType?: string | null;
  quantity?: number | null;
  filledQuantity?: number | null;
  remainingQuantity?: number | null;
  price?: number | null;
  stopPrice?: number | null;
  orderLegCollection?: BrokerOrderLeg[];
}

export interface BrokerOrdersOptions {
  fromEnteredTime: Date;
  toEnteredTime: Date;
  status?: string;
  maxResults?: number;
}

export interface BrokerAccountOrders {
  accountNumber?: string;
  orders: BrokerOrder[];
}

/**
 * The contract every broker client satisfies for the shared commands. Kept
 * intentionally small; broker-specific commands continue to use the full Schwab
 * client directly.
 */
export interface BrokerClient {
  getAccountBalances(): Promise<Observation<AccountBalances>>;
  getPositions(symbol?: string): Promise<Observation<BrokerPosition[]>>;
  getQuotes(symbols: string[]): Promise<Observation<Record<string, BrokerQuote>>>;
  searchInstruments(
    symbol: string,
    projection: BrokerInstrumentSearchProjection
  ): Promise<Observation<BrokerInstrument[]>>;
  fetchTransactionHistory(
    startDate: Date,
    endDate: Date
  ): Promise<Observation<BrokerTransactionHistory[]>>;
  fetchOrders(options: BrokerOrdersOptions): Promise<Observation<BrokerAccountOrders[]>>;
}
