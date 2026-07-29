import type { DerivativeContract } from "./derivativeDiscovery.js";

export type BrokerEnvironment = "live" | "paper";

export interface TradingDiagnostics {
  accountId: string;
  selectedAccountId: string | null;
  environment: BrokerEnvironment;
  authenticated: boolean;
  competingSession: boolean;
  marketDataAvailable: boolean | null;
  advisoryAssetPermissions: string[];
}

export interface DerivativeComboPreviewRequest {
  accountId: string;
  legs: [
    { contract: DerivativeContract; ratio: 1 | -1 },
    { contract: DerivativeContract; ratio: 1 | -1 },
  ];
  quantity: number;
  priceEffect: "CREDIT" | "DEBIT";
  limit: number;
  tif: "DAY" | "GTC";
  session: "REGULAR" | "OVERNIGHT";
}

export interface MarginImpact {
  current: number;
  change: number;
  after: number;
}

export interface DerivativeComboPreviewResult {
  accountId: string;
  environment: BrokerEnvironment;
  accepted: boolean;
  submitted: false;
  commission: number | null;
  initialMargin: MarginImpact | null;
  maintenanceMargin: MarginImpact | null;
  warnings: string[];
  rejectionReasons: string[];
  advisoryAssetPermissions: string[];
}

export interface DerivativePreviewClient {
  getTradingDiagnostics(accountId: string): Promise<TradingDiagnostics>;
  previewDerivativeCombo(
    request: DerivativeComboPreviewRequest
  ): Promise<DerivativeComboPreviewResult>;
}
