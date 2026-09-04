import type { DerivativeContract } from "./derivativeDiscovery.js";

export type BrokerEnvironment = "live" | "paper";

export interface TradingDiagnostics {
  accountId: string;
  maskedAccountDisplay?: string | null;
  environment: BrokerEnvironment;
  authenticated: boolean;
  competingSession: boolean;
  marketDataAvailable: boolean | null;
  advisoryAssetPermissions: string[];
  state: "starting" | "ready" | "degraded" | "draining" | "stopped";
  readReady: boolean;
  newMutationReady: boolean;
  recoveryMutationReady: boolean;
  lockOwned: boolean;
  accountVerified: boolean;
  connected: boolean | null;
  lastTickleAt: string | null;
  nextRenewalAt: string | null;
  lastBrokerRequestAt: string | null;
  readQueueDepth: number;
  pendingWarnings: number;
  reconciliationRequiredOperations: number;
}

export interface DerivativeComboPreviewRequest {
  legs: readonly [
    { contract: DerivativeContract; ratio: 1 | -1 },
    { contract: DerivativeContract; ratio: 1 | -1 },
  ];
  quantity: number;
  priceEffect: "CREDIT" | "DEBIT";
  limit: number;
  tif: "DAY" | "GTC";
  session: "REGULAR" | "OVERNIGHT";
}

export interface CanonicalComboIntent {
  legs: readonly [
    { contract: DerivativeContract; ratio: 1 },
    { contract: DerivativeContract; ratio: -1 },
  ];
  quantity: number;
  tif: "DAY" | "GTC";
  session: "REGULAR" | "OVERNIGHT";
  priceEffect: "CREDIT" | "DEBIT";
  orderType: "LMT";
  limit: number;
}

export interface MarginImpact {
  current: number;
  change: number;
  after: number;
}

export interface DerivativeComboPreviewResult {
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
  getTradingDiagnostics(): Promise<TradingDiagnostics>;
  previewDerivativeCombo(
    request: DerivativeComboPreviewRequest,
  ): Promise<DerivativeComboPreviewResult>;
}
