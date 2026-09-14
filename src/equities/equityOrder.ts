import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import type { BrokerEnvironment, MarginImpact } from "#src/derivatives/derivativePreview.js";

export interface EquityContract {
  readonly conid: number;
  readonly assetClass: "STK";
  readonly symbol: string;
  readonly exchange: "SMART";
  readonly primaryExchange: string;
  readonly currency: "USD";
}

export interface CanonicalEquityIntent {
  readonly contract: EquityContract;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly tif: "DAY" | "GTC";
  readonly session: "REGULAR" | "OVERNIGHT";
  readonly orderType: "LMT";
  readonly limit: number;
}

export interface EquityPreviewResult {
  readonly environment: BrokerEnvironment;
  readonly accepted: boolean;
  readonly submitted: false;
  readonly commission: number | null;
  readonly initialMargin: MarginImpact | null;
  readonly maintenanceMargin: MarginImpact | null;
  readonly warnings: readonly string[];
  readonly rejectionReasons: readonly string[];
  readonly advisoryAssetPermissions: readonly string[];
}

export interface EquityTradingDiagnostics {
  readonly environment: BrokerEnvironment;
  readonly accountVerified: boolean;
  readonly newMutationReady: boolean;
  readonly recoveryMutationReady: boolean;
}

export interface EquityGatewayClient {
  getTradingDiagnostics(): Promise<EquityTradingDiagnostics>;
  resolveContract(symbol: string): Promise<EquityContract>;
  preview(intent: CanonicalEquityIntent): Promise<EquityPreviewResult>;
  create(
    intent: CanonicalEquityIntent,
    idempotencyKey: string,
    operator: string
  ): Promise<OrderOperation>;
  lookup(idempotencyKey: string): Promise<OrderOperation>;
}
