import { z } from "zod";
import type {
  SingleOrderGateway,
  SingleOrderPreviewResult,
  SingleOrderTradingDiagnostics,
} from "#src/orders/singleOrderWorkflow.js";

export interface EquityContract {
  readonly conid: number;
  readonly assetClass: "STK";
  readonly symbol: string;
  readonly exchange: "SMART";
  readonly primaryExchange: string;
  readonly currency: "USD";
}

export type EquityPriceTerms =
  | { readonly orderType: "LMT"; readonly limit: number }
  | { readonly orderType: "STP"; readonly stopPrice: number };

export type CanonicalEquityIntent = {
  readonly contract: EquityContract;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly tif: "DAY" | "GTC";
  readonly session: "REGULAR" | "OVERNIGHT";
} & EquityPriceTerms;

export type EquityPreviewResult = SingleOrderPreviewResult;
export type EquityTradingDiagnostics = SingleOrderTradingDiagnostics;

export interface EquityGatewayClient extends SingleOrderGateway<CanonicalEquityIntent> {
  resolveContract(symbol: string): Promise<EquityContract>;
}

const contractSchema = z.strictObject({
  conid: z.number().int().positive(),
  assetClass: z.literal("STK"),
  symbol: z.string().regex(/^[A-Z0-9][A-Z0-9 .-]{0,31}$/),
  exchange: z.literal("SMART"),
  primaryExchange: z.string().min(1).max(32),
  currency: z.literal("USD"),
});
const sharedIntentFields = {
  contract: contractSchema,
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive(),
  tif: z.enum(["DAY", "GTC"]),
  session: z.enum(["REGULAR", "OVERNIGHT"]),
};
/** The one schema of a canonical equity intent: a LIMIT or a native STOP order. */
export const canonicalEquityIntentSchema: z.ZodType<CanonicalEquityIntent> = z.discriminatedUnion(
  "orderType",
  [
    z.strictObject({
      ...sharedIntentFields,
      orderType: z.literal("LMT"),
      limit: z.number().positive(),
    }),
    z.strictObject({
      ...sharedIntentFields,
      orderType: z.literal("STP"),
      stopPrice: z.number().positive(),
    }),
  ]
);
