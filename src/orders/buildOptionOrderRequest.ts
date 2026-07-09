import type {
  SchwabDuration,
  SchwabInstruction,
  SchwabOrderRequest,
  SchwabOrderType,
  SchwabSession,
} from "@huskly/schwab-client";

export interface BuildOptionOrderRequestParams {
  occSymbol: string;
  instruction: SchwabInstruction;
  quantity: number;
  orderType: SchwabOrderType;
  price?: number | undefined;
  session?: SchwabSession | undefined;
  duration?: SchwabDuration | undefined;
}

/** Builds a single-leg Schwab option order request (e.g. sell-to-open a covered call). */
export function buildOptionOrderRequest(params: BuildOptionOrderRequestParams): SchwabOrderRequest {
  const orderRequest: SchwabOrderRequest = {
    session: params.session ?? "NORMAL",
    duration: params.duration ?? "DAY",
    orderType: params.orderType,
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: params.instruction,
        quantity: params.quantity,
        instrument: { assetType: "OPTION", symbol: params.occSymbol },
      },
    ],
  };

  if (params.orderType === "LIMIT" && params.price !== undefined) {
    orderRequest.price = params.price;
  }
  if (params.orderType === "STOP" && params.price !== undefined) {
    orderRequest.stopPrice = params.price;
  }

  return orderRequest;
}
