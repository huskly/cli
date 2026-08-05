import type { DerivativeComboPreviewRequest } from "./derivativePreview.js";
import type { DerivativeAssetClass } from "./derivativeDiscovery.js";

export interface DerivativeComboExecutionRequest extends DerivativeComboPreviewRequest {
  clientOrderId: string;
  extOperator: string;
  manualIndicator: boolean;
}

export interface OrderWarning {
  replyId: string;
  messages: string[];
  messageIds: string[];
  known: boolean;
}

export interface DerivativeSubmittedOrder {
  orderId: string;
  status: DerivativeOrderStatus;
  clientOrderId: string | null;
}

export interface BrokerErrorDetail {
  message: string;
  code: string | null;
  statusCode: number | null;
  details: Readonly<Record<string, unknown>>;
}

export type DerivativeOrderStatus =
  | "WARNING_PENDING"
  | "PENDING"
  | "WORKING"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "UNKNOWN";

export type DerivativeOrderSubmissionResult =
  | {
      state: "accepted";
      orderId: string;
      status: DerivativeOrderStatus;
      clientOrderId: string | null;
      warnings: OrderWarning[];
    }
  | { state: "warning"; warnings: OrderWarning[] }
  | {
      state: "rejected";
      reasons: string[];
      errors?: BrokerErrorDetail[];
      orders?: DerivativeSubmittedOrder[];
    }
  | {
      state: "recovery_required";
      reasons: string[];
      orders: DerivativeSubmittedOrder[];
      warnings: OrderWarning[];
      errors: BrokerErrorDetail[];
      unrecognizedResponses: unknown[];
    };

export interface DerivativeOrderLifecycle {
  accountId: string;
  orderId: string;
  clientOrderId: string | null;
  status: DerivativeOrderStatus;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number | null;
  limitPrice: number | null;
  commissionAndFees: number | null;
  legs: { conid: number; ratio: number }[];
  updatedAt: string | null;
}

export interface DerivativeExecutionClient {
  submitDerivativeCombo(
    request: DerivativeComboExecutionRequest
  ): Promise<DerivativeOrderSubmissionResult>;
  acknowledgeOrderWarning(input: {
    replyId: string;
    confirmed: true;
  }): Promise<DerivativeOrderSubmissionResult>;
  getDerivativeOrderStatus(accountId: string, orderId: string): Promise<DerivativeOrderLifecycle>;
  cancelDerivativeOrder(input: {
    accountId: string;
    orderId: string;
    assetClass: DerivativeAssetClass;
    extOperator: string;
    manualIndicator: boolean;
  }): Promise<void>;
}
