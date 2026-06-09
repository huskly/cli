import { createRequire } from "node:module";
import type { IbkrClient as RawIbkrClient } from "ibkr-client";
import type { IbkrOauth1Config } from "#src/ibkr/oauthConfig.js";
import type { AccountBalances, BrokerClient, BrokerPosition } from "#src/brokers/brokerClient.js";
import { ASSET_CLASS_LABELS, toNumber } from "#src/helpers.js";
import type {
  IbkrAuthStatus,
  IbkrMarketDataSnapshot,
  IbkrPortfolioAccount,
  IbkrPortfolioSummary,
  IbkrPosition,
} from "#src/ibkr/ibkrApiTypes.js";

// `ibkr-client`'s published ESM build is broken: its `import` condition points
// at files that use extensionless relative imports, which Node's strict ESM
// resolver rejects. Its CJS build is fine, so we deliberately load that via
// createRequire. This is the one intentional createRequire in the codebase —
// everything else imports natively as ESM. Revisit if upstream fixes their ESM.
const require = createRequire(import.meta.url);
const { IbkrClient: RawIbkrClientCtor } = require("ibkr-client") as {
  IbkrClient: new (config: IbkrOauth1Config) => RawIbkrClient;
};

/** IBKR session auth status (not part of the shared BrokerClient contract). */
export interface IbkrSessionStatus {
  authenticated: boolean;
  competing: boolean;
}

/** Live market-data snapshot field 78 = position's P&L for the current day. */
const DAY_PNL_FIELD = "78";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Typed IBKR Web API client implementing the broker-neutral {@link BrokerClient}.
 * Wraps the `ibkr-client` npm package, which performs the OAuth 1.0a
 * live-session-token handshake. Emits Schwab-shaped balances/positions so the
 * shared CLI handlers render IBKR and Schwab identically.
 */
export class IbkrClient implements BrokerClient {
  private readonly raw: RawIbkrClient;
  private initPromise?: Promise<void>;
  private accountIdPromise?: Promise<string>;

  constructor(config: IbkrOauth1Config) {
    this.raw = new RawIbkrClientCtor(config);
  }

  /** Obtain the live session token (idempotent — safe to await repeatedly). */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      await this.raw.init();
      // IBKR is slow right after init; give the session a moment to settle.
      await sleep(1000);
    })();
    return this.initPromise;
  }

  async getAuthStatus(): Promise<IbkrSessionStatus> {
    const status = await this.req<IbkrAuthStatus>({
      path: "iserver/auth/status",
      method: "POST",
    });
    return {
      authenticated: status.authenticated ?? false,
      competing: status.competing ?? false,
    };
  }

  async getAccountId(): Promise<string> {
    this.accountIdPromise ??= (async () => {
      const override = process.env["IBKR_ACCOUNT_ID"];
      if (override) return override;
      const accounts = await this.req<IbkrPortfolioAccount[]>({ path: "portfolio/accounts" });
      const first = accounts[0];
      if (!first) throw new Error("No portfolio accounts returned by IBKR");
      return first.accountId;
    })();
    return this.accountIdPromise;
  }

  async getAccountBalances(): Promise<AccountBalances> {
    const accountId = await this.getAccountId();
    const summary = await this.req<IbkrPortfolioSummary>({
      path: `portfolio/${accountId}/summary`,
    });
    const amount = (key: string): number => toNumber(summary[key]?.amount);
    const netLiquidation = amount("netliquidation");
    return {
      liquidationValue: netLiquidation,
      // IBKR's summary has no separate "equity" figure; net liquidation is the
      // closest analogue to Schwab's equity for display purposes.
      equity: netLiquidation,
      cashBalance: amount("totalcashvalue"),
      availableFunds: amount("availablefunds"),
      buyingPower: amount("buyingpower"),
    };
  }

  async getPositions(symbol?: string): Promise<BrokerPosition[]> {
    const accountId = await this.getAccountId();
    const rows = await this.fetchAllPositions(accountId);
    const conids = rows
      .map((p) => p.conid)
      .filter((conid): conid is number => conid !== undefined)
      .map(String);
    const dayPnl = await this.fetchDayPnl(conids);
    let positions = rows.map((p) => this.normalizePosition(p, dayPnl));
    if (symbol) {
      const upper = symbol.toUpperCase();
      positions = positions.filter((p) => p.instrument.symbol.toUpperCase().includes(upper));
    }
    return positions;
  }

  /** Page through the positions endpoint until it stops returning rows. */
  private async fetchAllPositions(accountId: string): Promise<IbkrPosition[]> {
    const out: IbkrPosition[] = [];
    let page = 0;
    for (;;) {
      const rows = await this.req<IbkrPosition[]>({
        path: `portfolio/${accountId}/positions/${String(page)}`,
      });
      if (!rows.length) break;
      out.push(...rows);
      page += 1;
    }
    return out;
  }

  /** Return { conid: day P&L }. Snapshots need a warm-up call before data lands. */
  private async fetchDayPnl(conids: string[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (!conids.length) return result;

    const params = { conids: conids.join(","), fields: DAY_PNL_FIELD };
    await this.req<unknown>({ path: "iserver/marketdata/snapshot", params }); // warm up
    await sleep(2000);
    const snapshot = await this.req<IbkrMarketDataSnapshot[]>({
      path: "iserver/marketdata/snapshot",
      params,
    });

    for (const row of snapshot) {
      const raw = row[DAY_PNL_FIELD];
      if (raw !== undefined && row.conid !== undefined) {
        result.set(row.conid, toNumber(raw));
      }
    }
    return result;
  }

  private normalizePosition(p: IbkrPosition, dayPnl: Map<number, number>): BrokerPosition {
    const qty = p.position ?? 0;
    const assetClass = p.assetClass ?? "";
    const openPnl = toNumber(p.unrealizedPnl);
    return {
      instrument: {
        symbol: p.contractDesc ?? String(p.conid ?? "-"),
        assetType: ASSET_CLASS_LABELS[assetClass] ?? (assetClass || "-"),
      },
      longQuantity: qty > 0 ? qty : 0,
      shortQuantity: qty < 0 ? Math.abs(qty) : 0,
      averagePrice: toNumber(p.avgPrice),
      marketValue: toNumber(p.mktValue),
      currentDayProfitLoss: p.conid !== undefined ? (dayPnl.get(p.conid) ?? 0) : 0,
      // IBKR reports a single unrealized P/L; attribute it to the held leg so the
      // shared handler (which reads long/short open P/L separately) renders it.
      longOpenProfitLoss: qty > 0 ? openPnl : 0,
      shortOpenProfitLoss: qty < 0 ? openPnl : 0,
    };
  }

  /** Typed wrapper around the raw client's untyped `request()`. */
  private async req<T>(input: {
    path: string;
    method?: string;
    params?: Record<string, string | number | boolean | null | undefined>;
    data?: object;
  }): Promise<T> {
    return (await this.raw.request(input)) as T;
  }
}
