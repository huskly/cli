/**
 * Raw IBKR Client Portal Web API response shapes (only the fields we read).
 * The `ibkr-client` `request()` method returns `any`; these types let us cast
 * once at the boundary and stay typed everywhere else.
 *
 * See: https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-ref/
 */

export interface IbkrAuthStatus {
  authenticated?: boolean;
  competing?: boolean;
  connected?: boolean;
}

export interface IbkrPortfolioAccount {
  accountId: string;
  type?: string;
  currency?: string;
}

/** A single field in the `portfolio/{accountId}/summary` response. */
export interface IbkrSummaryField {
  amount?: number;
  currency?: string;
}

export type IbkrPortfolioSummary = Record<string, IbkrSummaryField | undefined>;

/** A row from `portfolio/{accountId}/positions/{page}`. */
export interface IbkrPosition {
  conid?: number;
  contractDesc?: string;
  assetClass?: string;
  position?: number;
  avgPrice?: number;
  mktPrice?: number;
  mktValue?: number;
  multiplier?: number;
  unrealizedPnl?: number;
}

export interface IbkrStockContract {
  conid?: number;
  exchange?: string;
  isUS?: boolean;
}

export interface IbkrStockListing {
  name?: string;
  chineseName?: string | null;
  assetClass?: string;
  contracts?: IbkrStockContract[];
}

export type IbkrStocksResponse = Record<string, IbkrStockListing[] | undefined>;

export interface IbkrMarketDataHistoryBar {
  o?: number;
  c?: number;
  h?: number;
  l?: number;
  v?: number;
  t?: number;
}

export interface IbkrMarketDataHistoryResponse {
  symbol?: string;
  text?: string;
  mdAvailability?: string;
  volumeFactor?: number;
  data?: IbkrMarketDataHistoryBar[];
}

export interface IbkrTransactionsResponse {
  currency?: string;
  from?: number;
  to?: number;
  includesRealTime?: boolean;
  transactions?: IbkrTransaction[];
}

export interface IbkrTransaction {
  date?: string;
  rawDate?: string;
  cur?: string;
  fxRate?: number;
  pr?: number;
  qty?: number;
  acctid?: string;
  amt?: number;
  conid?: number;
  type?: string;
  desc?: string;
}

export interface IbkrLiveOrdersResponse {
  orders?: IbkrLiveOrder[];
  snapshot?: boolean;
}

export interface IbkrBrokerageAccountsResponse {
  accounts?: string[];
  selectedAccount?: string;
}

export interface IbkrSwitchAccountResponse {
  set?: boolean;
  acctId?: string;
}

export interface IbkrLiveOrder {
  account?: string;
  acct?: string;
  orderId?: number | string;
  order_id?: number | string;
  conid?: number;
  ticker?: string;
  symbol?: string;
  description1?: string;
  contractDescription1?: string;
  contract_description_1?: string;
  companyName?: string;
  company_name?: string;
  side?: string;
  orderType?: string;
  order_type?: string;
  orderStatus?: string;
  order_status?: string;
  status?: string;
  orderStatusDescription?: string;
  order_status_description?: string;
  totalSize?: string | number;
  total_size?: string | number;
  size?: string | number;
  cumFill?: string | number;
  cum_fill?: string | number;
  filledQuantity?: string | number;
  remainingQuantity?: string | number;
  sizeAndFills?: string;
  size_and_fills?: string;
  avgPrice?: string | number;
  averagePrice?: string | number;
  average_price?: string | number;
  price?: string | number;
  limitPrice?: string | number;
  stopPrice?: string | number;
  tif?: string;
  orderDescription?: string;
  order_description?: string;
  orderDesc?: string;
  orderDescriptionWithContract?: string;
  order_description_with_contract?: string;
  lastExecutionTime?: string;
  lastExecutionTime_r?: number;
  orderTime?: string;
  order_time?: string;
}

/** A row from `iserver/marketdata/snapshot`. Fields are numbered strings. */
export type IbkrMarketDataSnapshot = Record<string, string | number | undefined> & {
  conid?: number;
};
