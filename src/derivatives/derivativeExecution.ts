import type { OrderOperation, ReconciliationResponse } from "@huskly/ibkr-gateway-client";
import type { CanonicalComboIntent, DerivativeComboPreviewResult } from "./derivativePreview.js";

export type OrderOperationView = OrderOperation;
export type OrderReconciliationView = ReconciliationResponse;
export type OperationKind = "combo";

/** The narrow durable mutation boundary. It never accepts an account or client-order ID. */
export interface DerivativeExecutionClient {
  preview(intent: CanonicalComboIntent): Promise<DerivativeComboPreviewResult>;
  create(
    intent: CanonicalComboIntent,
    idempotencyKey: string,
    operator: string
  ): Promise<OrderOperationView>;
  lookup(kind: OperationKind, idempotencyKey: string): Promise<OrderOperationView>;
  get(operationId: string): Promise<OrderOperationView>;
  acknowledge(
    operationId: string,
    replyId: string,
    idempotencyKey: string
  ): Promise<OrderOperationView>;
  reconcile(operationId: string): Promise<OrderReconciliationView>;
  cancel(operationId: string, idempotencyKey: string): Promise<OrderOperationView>;
}
