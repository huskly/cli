import type {
  AcknowledgeOrderWarningIdempotencyKey,
  AcknowledgeOrderWarningResponse,
  CancelOrderOperationIdempotencyKey,
  CancelOrderOperationResponse,
  CreateOrderOperationIdempotencyKey,
  CreateOrderOperationRequest,
  CreateOrderOperationResponse,
  GetDiagnosticsResponse,
  GetOrderOperationResponse,
  LookupOrderOperationRequest,
  LookupOrderOperationResponse,
  PreviewOrdersRequest,
  PreviewOrdersResponse,
  ReconciliationResponse,
  ResolveForexContractRequest,
  ResolveForexContractResponse,
} from "@huskly/ibkr-gateway-client";
import type { GatewayTransport } from "./gatewayTransport.js";
import type {
  CanonicalComboIntent,
  DerivativeComboPreviewResult,
} from "../derivatives/derivativePreview.js";
import type { DerivativeContract } from "../derivatives/derivativeDiscovery.js";
import type { OptionOrderContract } from "../options/optionOrder.js";
interface EquityContractRequest {
  readonly symbol: string;
}
interface EquityContractResponse {
  readonly observedAt: string;
  readonly status: "available";
  readonly contract: {
    readonly conid: number;
    readonly assetClass: "STK";
    readonly symbol: string;
    readonly exchange: "SMART";
    readonly primaryExchange: string;
    readonly currency: "USD";
  };
}
type EquityPriceTermsWire =
  | { readonly orderType: "LMT"; readonly limit: number }
  | { readonly orderType: "STP"; readonly stopPrice: number };
type EquityPreviewRequest = {
  readonly contract: EquityContractResponse["contract"];
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly tif: "DAY" | "GTC";
  readonly session: "REGULAR" | "OVERNIGHT";
} & EquityPriceTermsWire;
type EquitySubmissionRequest = EquityPreviewRequest & {
  readonly kind: "single";
  readonly extOperator: string;
  readonly manualIndicator: boolean;
};
type GatewayPreviewRequest = PreviewOrdersRequest | EquityPreviewRequest;
type GatewayCreateRequest = CreateOrderOperationRequest | EquitySubmissionRequest;
interface EquityGatewayWireClient {
  resolveEquityContract(body: EquityContractRequest): Promise<EquityContractResponse>;
}

import type {
  DerivativeExecutionClient,
  OperationKind,
  OrderOperationView,
  OrderReconciliationView,
} from "../derivatives/derivativeExecution.js";

export interface GatewayMutationApi {
  getDiagnostics(): Promise<GetDiagnosticsResponse>;
  resolveEquityContract(body: EquityContractRequest): Promise<EquityContractResponse>;
  resolveForexContract(body: ResolveForexContractRequest): Promise<ResolveForexContractResponse>;
  previewOrders(body: GatewayPreviewRequest): Promise<PreviewOrdersResponse>;
  createOrderOperation(
    body: GatewayCreateRequest,
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
    getDiagnostics: () => transport.call("getDiagnostics", (client) => client.getDiagnostics()),
    resolveEquityContract: (body) =>
      transport.call("resolveEquityContract", (client) =>
        (client as unknown as EquityGatewayWireClient).resolveEquityContract(body)
      ),
    resolveForexContract: (body) =>
      transport.call("resolveForexContract", (client) => client.resolveForexContract(body)),
    previewOrders: (body) =>
      transport.call("previewOrders", (client) =>
        client.previewOrders(body as PreviewOrdersRequest)
      ),
    createOrderOperation: (body, key) =>
      transport.call("createOrderOperation", (client) =>
        client.createOrderOperation(body as CreateOrderOperationRequest, key)
      ),
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

/**
 * Map a resolved derivative contract to the exact gateway mutation contract.
 *
 * @remarks
 * Every option mutation, single-leg or combo, routes through this one mapping,
 * so a contract that has no exact IBKR identity fails closed in one place.
 */
export function derivativeMutationContract(source: DerivativeContract): OptionOrderContract {
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
    right: identity.right === "CALL" ? "C" : "P",
    ...(identity.settlement === undefined ? {} : { settlement: identity.settlement }),
    ...(identity.exerciseStyle === undefined ? {} : { exerciseStyle: identity.exerciseStyle }),
  };
}

function contract(intent: CanonicalComboIntent, index: 0 | 1): OptionOrderContract {
  return derivativeMutationContract(intent.legs[index].contract);
}

type DerivativePreviewRequest = Extract<PreviewOrdersRequest, { legs: unknown }>;

function previewRequest(intent: CanonicalComboIntent): DerivativePreviewRequest {
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
