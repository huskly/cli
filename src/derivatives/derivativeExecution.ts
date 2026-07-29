import type { DerivativeComboPreviewRequest } from "./derivativePreview.js";

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
  | { state: "rejected"; reasons: string[] };

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
    extOperator: string;
    manualIndicator: boolean;
  }): Promise<void>;
}
