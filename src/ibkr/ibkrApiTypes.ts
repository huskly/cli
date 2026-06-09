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

/** A row from `iserver/marketdata/snapshot`. Fields are numbered strings. */
export type IbkrMarketDataSnapshot = Record<string, string | number | undefined> & {
  conid?: number;
};
