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
