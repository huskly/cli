/**
 * Broker-neutral domain types shared across the CLI.
 *
 * Command handlers for the shared commands (`account`, `positions`) render these
 * normalized shapes and never touch raw broker JSON. Both the Schwab path
 * (via {@link SchwabBrokerAdapter}) and the IBKR path (via `IbkrClient`)
 * implement {@link BrokerClient}, so a single set of handlers serves either
 * broker. The field names mirror `@huskly/schwab-client`'s `getAccountBalances`
 * / `SchwabPosition` shapes so the existing handlers needed almost no change.
 */

export type BrokerName = "ibkr" | "schwab";

export interface AccountBalances {
  liquidationValue: number;
  cashBalance: number;
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

/**
 * The contract every broker client satisfies for the shared commands. Kept
 * intentionally small (account + positions); broker-specific commands continue
 * to use the full Schwab client directly.
 */
export interface BrokerClient {
  getAccountBalances(): Promise<AccountBalances>;
  getPositions(symbol?: string): Promise<BrokerPosition[]>;
}
