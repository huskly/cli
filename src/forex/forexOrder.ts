import { z } from "zod";
import type {
  SingleOrderGateway,
  SingleOrderPreviewResult,
} from "#src/orders/singleOrderWorkflow.js";

/** One exact IDEALPRO spot FX pair. `symbol` is the base and `currency` is the quote currency. */
export interface ForexContract {
  readonly conid: number;
  readonly assetClass: "CASH";
  readonly symbol: string;
  readonly currency: string;
  readonly localSymbol: string;
  readonly exchange: "IDEALPRO";
}

/**
 * One spot FX LIMIT order as the gateway receives it.
 *
 * @remarks
 * `side` buys or sells the base currency. `quantity` is whole base-currency
 * units. `limit` is the quote-currency price of one base unit. FX trades
 * 24/5, so there is no session.
 */
export interface CanonicalForexIntent {
  readonly contract: ForexContract;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly tif: "DAY" | "GTC";
  readonly orderType: "LMT";
  readonly limit: number;
}

export type ForexPreviewResult = SingleOrderPreviewResult;

export interface ForexGatewayClient extends SingleOrderGateway<CanonicalForexIntent> {
  resolveContract(pair: string): Promise<ForexContract>;
}

const currencyCode = z.string().regex(/^[A-Z]{3}$/u);

export const canonicalForexIntentSchema: z.ZodType<CanonicalForexIntent> = z.strictObject({
  contract: z.strictObject({
    conid: z.number().int().positive(),
    assetClass: z.literal("CASH"),
    symbol: currencyCode,
    currency: currencyCode,
    localSymbol: z.string().regex(/^[A-Z]{3}\.[A-Z]{3}$/u),
    exchange: z.literal("IDEALPRO"),
  }),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive(),
  tif: z.enum(["DAY", "GTC"]),
  orderType: z.literal("LMT"),
  limit: z.number().positive(),
});
