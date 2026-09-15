import type { BrokerName } from "#src/brokers/brokerClient.js";
import type { DerivativeRight } from "#src/derivatives/derivativeDiscovery.js";
import {
  derivativeDiscoveryClient,
  optionOrderGatewayClient,
} from "#src/derivatives/derivativeClient.js";
import { FileExecutionStateStore } from "#src/derivatives/derivativeExecutionService.js";
import {
  OptionOrderService,
  type OptionSubmissionDto,
  type PlaceSingleOptionOrderInput,
} from "#src/options/optionOrderService.js";
import { renderSafeOperation, safeOperation, type SafeOperationView } from "./operationView.js";

/** Terms the option order command collected and validated for the gateway. */
export interface GatewayOptionOrderRequest {
  readonly underlying: string;
  readonly expiration: string;
  readonly strike: number;
  readonly right: DerivativeRight;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly limit: number;
  readonly tif: "DAY" | "GTC";
  readonly session: "REGULAR" | "OVERNIGHT";
  readonly tradingClass?: string;
  readonly exchange?: string;
  readonly operator: string;
  readonly confirm: boolean;
}

export interface SafeOptionSubmissionView {
  readonly orderRef: string;
  readonly account: OptionSubmissionDto["account"];
  readonly order: {
    readonly underlying: string;
    readonly expiration: string;
    readonly strike: number;
    readonly right: "C" | "P";
    readonly side: "BUY" | "SELL";
    readonly quantity: number;
    readonly limit: number;
    readonly tif: "DAY" | "GTC";
    readonly session: "REGULAR" | "OVERNIGHT";
    readonly tradingClass: string;
    readonly exchange: string;
    readonly multiplier: number;
  };
  readonly operation: SafeOperationView;
  readonly recovered: boolean;
}

/** Project the submission onto facts that are safe to print. */
export function toOptionSubmissionView(result: OptionSubmissionDto): SafeOptionSubmissionView {
  const { contract } = result.order;
  return {
    orderRef: result.orderRef,
    account: result.account,
    order: {
      underlying: contract.underlying,
      expiration: contract.expiration,
      strike: contract.strike,
      right: contract.right,
      side: result.order.side,
      quantity: result.order.quantity,
      limit: result.order.limit,
      tif: result.order.tif,
      session: result.order.session,
      tradingClass: contract.tradingClass,
      exchange: contract.exchange,
      multiplier: contract.multiplier,
    },
    operation: safeOperation(result.operation),
    recovered: result.recovered,
  };
}

export function renderOptionSubmission(result: SafeOptionSubmissionView): string {
  const { order } = result;
  const estimate = order.limit * order.quantity * order.multiplier;
  return [
    `Submission: ${result.recovered ? "recovered" : "new"}`,
    `Order reference: ${result.orderRef}`,
    `Account: ${result.account.maskedId ?? "unknown"}  Environment: ${result.account.environment}`,
    `${order.side} ${String(order.quantity)} ${order.underlying} ${order.expiration} ${String(order.strike)} ${order.right} limit ${String(order.limit)}  ${order.tif} ${order.session}`,
    `Class: ${order.tradingClass}  Exchange: ${order.exchange}  Multiplier: ${String(order.multiplier)}`,
    `${order.side === "SELL" ? "Est. credit" : "Est. debit"}: ${estimate.toFixed(2)}`,
    ...renderSafeOperation(result.operation),
  ].join("\n");
}

async function optionOrderService(broker: BrokerName): Promise<OptionOrderService> {
  const [discovery, gateway] = await Promise.all([
    derivativeDiscoveryClient(broker),
    optionOrderGatewayClient(broker),
  ]);
  return new OptionOrderService(discovery, gateway, new FileExecutionStateStore());
}

export interface GatewayOptionOrderDependencies {
  readonly createService?: (broker: BrokerName) => Promise<OptionOrderService>;
  readonly log?: (line: string) => void;
}

/**
 * Place or recover one guarded single-leg option order on the gateway.
 *
 * @remarks
 * The gateway offers no What-If for a single derivative leg, so this command
 * carries its own guard: an exact `--confirm`, an operator identity, and a
 * durable order reference that recovers a lost response without a second
 * submission.
 */
export async function handleGatewayOptionOrder(
  broker: BrokerName,
  request: GatewayOptionOrderRequest,
  options: { readonly json?: boolean; readonly recover?: string },
  dependencies: GatewayOptionOrderDependencies = {}
): Promise<void> {
  const log = dependencies.log ?? console.log;
  const service = await (dependencies.createService ?? optionOrderService)(broker);
  const input: PlaceSingleOptionOrderInput = { assetClass: "OPT", ...request };
  const result =
    options.recover === undefined
      ? await service.place(input)
      : await service.recover(options.recover);
  const view = toOptionSubmissionView(result);
  log(options.json === true ? JSON.stringify(view, null, 2) : renderOptionSubmission(view));
}
