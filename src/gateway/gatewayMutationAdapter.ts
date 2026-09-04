import type {
  AcknowledgeOrderWarningIdempotencyKey,
  AcknowledgeOrderWarningResponse,
  CancelOrderOperationIdempotencyKey,
  CancelOrderOperationResponse,
  CreateOrderOperationIdempotencyKey,
  CreateOrderOperationRequest,
  CreateOrderOperationResponse,
  GetOrderOperationResponse,
  LookupOrderOperationRequest,
  LookupOrderOperationResponse,
  PreviewOrdersRequest,
  PreviewOrdersResponse,
  ReconciliationResponse,
} from "@huskly/ibkr-gateway-client";
import type { GatewayTransport } from "./gatewayTransport.js";
import type {
  CanonicalComboIntent,
  DerivativeComboPreviewResult,
} from "../derivatives/derivativePreview.js";
import type {
  DerivativeExecutionClient,
  OperationKind,
  OrderOperationView,
  OrderReconciliationView,
} from "../derivatives/derivativeExecution.js";

export interface GatewayMutationApi {
  previewOrders(body: PreviewOrdersRequest): Promise<PreviewOrdersResponse>;
  createOrderOperation(
    body: CreateOrderOperationRequest,
    idempotencyKey: CreateOrderOperationIdempotencyKey
  ): Promise<CreateOrderOperationResponse>;
  lookupOrderOperation(body: LookupOrderOperationRequest): Promise<LookupOrderOperationResponse>;
  getOrderOperation(operationId: string): Promise<GetOrderOperationResponse>;
  acknowledgeOrderWarning(
    operationId: string,
    replyId: string,
    idempotencyKey: AcknowledgeOrderWarningIdempotencyKey
  ): Promise<AcknowledgeOrderWarningResponse>;
  reconcileOrderOperation(operationId: string): Promise<ReconciliationResponse>;
  cancelOrderOperation(
    operationId: string,
    idempotencyKey: CancelOrderOperationIdempotencyKey
  ): Promise<CancelOrderOperationResponse>;
}

/** One transport call per generated gateway operation. The transport performs no retry. */
export function createGatewayMutationApi(transport: GatewayTransport): GatewayMutationApi {
  return {
    previewOrders: (body) =>
      transport.call("previewOrders", (client) => client.previewOrders(body)),
    createOrderOperation: (body, key) =>
      transport.call("createOrderOperation", (client) => client.createOrderOperation(body, key)),
    lookupOrderOperation: (body) =>
      transport.call("lookupOrderOperation", (client) => client.lookupOrderOperation(body)),
    getOrderOperation: (operationId) =>
      transport.call("getOrderOperation", (client) => client.getOrderOperation(operationId)),
    acknowledgeOrderWarning: (operationId, replyId, key) =>
      transport.call("acknowledgeOrderWarning", (client) =>
        client.acknowledgeOrderWarning(operationId, replyId, key)
      ),
    reconcileOrderOperation: (operationId) =>
      transport.call("reconcileOrderOperation", (client) =>
        client.reconcileOrderOperation(operationId)
      ),
    cancelOrderOperation: (operationId, key) =>
      transport.call("cancelOrderOperation", (client) =>
        client.cancelOrderOperation(operationId, key)
      ),
  };
}

function contract(intent: CanonicalComboIntent, index: 0 | 1) {
  const source = intent.legs[index].contract;
  if (source.brokerReference?.broker !== "ibkr") {
    throw new Error("Gateway mutation requires an exact IBKR contract identity");
  }
  const conid = Number(source.brokerReference.contractId);
  if (!Number.isSafeInteger(conid) || conid <= 0) {
    throw new Error("Gateway mutation requires a valid IBKR contract ID");
  }
  const identity = source.identity;
  return {
    conid,
    assetClass: identity.assetClass,
    underlying: identity.underlying,
    expiration: identity.expiration,
    tradingClass: identity.tradingClass,
    exchange: identity.exchange,
    multiplier: identity.multiplier,
    strike: identity.strike,
    right: identity.right === "CALL" ? ("C" as const) : ("P" as const),
    ...(identity.settlement === undefined ? {} : { settlement: identity.settlement }),
    ...(identity.exerciseStyle === undefined ? {} : { exerciseStyle: identity.exerciseStyle }),
  };
}

function previewRequest(intent: CanonicalComboIntent): PreviewOrdersRequest {
  return {
    legs: [
      { contract: contract(intent, 0), ratio: 1 },
      { contract: contract(intent, 1), ratio: -1 },
    ],
    quantity: intent.quantity,
    tif: intent.tif,
    session: intent.session,
    priceEffect: intent.priceEffect,
    orderType: "LMT",
    limit: intent.limit,
  };
}

export class GatewayMutationAdapter implements DerivativeExecutionClient {
  public constructor(private readonly api: GatewayMutationApi) {}

  preview(intent: CanonicalComboIntent): Promise<DerivativeComboPreviewResult> {
    return this.api.previewOrders(previewRequest(intent));
  }

  create(
    intent: CanonicalComboIntent,
    idempotencyKey: string,
    operator: string
  ): Promise<OrderOperationView> {
    return this.api.createOrderOperation(
      {
        ...previewRequest(intent),
        kind: "combo",
        extOperator: operator,
        manualIndicator: true,
      },
      idempotencyKey
    );
  }

  lookup(kind: OperationKind, idempotencyKey: string): Promise<OrderOperationView> {
    return this.api.lookupOrderOperation({ kind, idempotencyKey });
  }

  get(operationId: string): Promise<OrderOperationView> {
    return this.api.getOrderOperation(operationId);
  }

  acknowledge(
    operationId: string,
    replyId: string,
    idempotencyKey: string
  ): Promise<OrderOperationView> {
    return this.api.acknowledgeOrderWarning(operationId, replyId, idempotencyKey);
  }

  reconcile(operationId: string): Promise<OrderReconciliationView> {
    return this.api.reconcileOrderOperation(operationId);
  }

  cancel(operationId: string, idempotencyKey: string): Promise<OrderOperationView> {
    return this.api.cancelOrderOperation(operationId, idempotencyKey);
  }
}
