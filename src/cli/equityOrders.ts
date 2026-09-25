import { Command } from "commander";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import { createEquityTools, type EquityTools } from "#src/mcp/tools/equityOrders.js";
import {
  normalizeEquityOrderTerms,
  type EquityPreviewDto,
  type EquitySubmissionDto,
} from "#src/equities/equityOrderService.js";
import { cliGatewayTransport } from "#src/gateway/gatewayTransport.js";
import { renderSafeOperation, safeOperation, type SafeOperationView } from "./operationView.js";
import { requireOperator, type BrokerResolver } from "./shared.js";
import { createGatewayExecutionService } from "./gatewayExecutionService.js";
import {
  acknowledgeWarnings,
  confirmed,
  GATEWAY_BROKER_FLAG,
  output,
  parseSide,
  parseTif,
  type WarningExecutionService,
} from "./guardedOrderCommands.js";

export interface EquityCommandDependencies {
  readonly createEquityOrders?: (broker: BrokerName) => Promise<EquityTools["orders"]>;
  readonly createExecutionService?: (broker: BrokerName) => Promise<WarningExecutionService>;
  readonly log?: (line: string) => void;
}

interface PreviewOptions {
  broker?: string;
  orderType?: string;
  limit?: string;
  stopPrice?: string;
  tif: string;
  session: string;
  json?: boolean;
}

interface SubmitOptions {
  broker?: string;
  operator?: string;
  confirm?: boolean;
  json?: boolean;
}

interface SafeEquityPreviewView {
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly environment: EquityPreviewDto["environment"];
  readonly account: EquityPreviewDto["account"];
  readonly order: {
    readonly symbol: string;
    readonly side: "BUY" | "SELL";
    readonly quantity: number;
    readonly tif: "DAY" | "GTC";
    readonly session: "REGULAR" | "OVERNIGHT";
  } & (
    | { readonly orderType: "LMT"; readonly limit: number }
    | { readonly orderType: "STP"; readonly stopPrice: number }
  );
  readonly whatIf: EquityPreviewDto["whatIf"];
  readonly submitted: false;
}

interface SafeEquitySubmissionView {
  readonly previewId: string;
  readonly environment: EquitySubmissionDto["environment"];
  readonly account: EquitySubmissionDto["account"];
  readonly order: SafeEquityPreviewView["order"];
  readonly operation: SafeOperationView;
  readonly recovered: boolean;
  readonly acknowledgedWarnings: number;
}

function session(value: string): "REGULAR" | "OVERNIGHT" {
  const normalized = value.toUpperCase();
  if (normalized !== "REGULAR" && normalized !== "OVERNIGHT") {
    throw new Error(`Invalid session '${value}'. Expected REGULAR or OVERNIGHT.`);
  }
  return normalized;
}

function shares(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Quantity must be a whole number of shares above zero, got '${value}'.`);
  }
  return parsed;
}

function parsePrice(value: string): number {
  return Number(value);
}

function orderView(intent: EquityPreviewDto["order"]): SafeEquityPreviewView["order"] {
  const base = {
    symbol: intent.contract.symbol,
    side: intent.side,
    quantity: intent.quantity,
    tif: intent.tif,
    session: intent.session,
  };
  if (intent.orderType === "STP") return { ...base, orderType: "STP", stopPrice: intent.stopPrice };
  return { ...base, orderType: "LMT", limit: intent.limit };
}

function toPreviewView(result: EquityPreviewDto): SafeEquityPreviewView {
  return {
    previewId: result.previewId,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
    environment: result.environment,
    account: result.account,
    order: orderView(result.order),
    whatIf: result.whatIf,
    submitted: result.submitted,
  };
}

function toSubmissionView(
  result: EquitySubmissionDto,
  acknowledgedWarnings = 0
): SafeEquitySubmissionView {
  return {
    previewId: result.previewId,
    environment: result.environment,
    account: result.account,
    order: orderView(result.order),
    operation: safeOperation(result.operation),
    recovered: result.recovered,
    acknowledgedWarnings,
  };
}

function formatPrice(value: number | null): string {
  return value === null ? "-" : String(value);
}

export function renderEquityPreview(result: SafeEquityPreviewView): string {
  return [
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId ?? "unknown"}  Environment: ${result.environment}`,
    `Created: ${result.createdAt}`,
    `Expires: ${result.expiresAt}`,
    `${result.order.side} ${String(result.order.quantity)} ${result.order.symbol} ${result.order.orderType === "STP" ? `stop ${String(result.order.stopPrice)}` : `limit ${String(result.order.limit)}`}  ${result.order.tif} ${result.order.session}`,
    `Accepted: ${String(result.whatIf.accepted)}`,
    `Initial margin change: ${formatPrice(result.whatIf.initialMargin?.change ?? null)}`,
    `Maintenance margin change: ${formatPrice(result.whatIf.maintenanceMargin?.change ?? null)}`,
    `Commission/fees: ${formatPrice(result.whatIf.commission)}`,
    `Warnings: ${result.whatIf.warnings.join(" | ") || "none"}`,
    `Rejections: ${result.whatIf.rejectionReasons.join(" | ") || "none"}`,
    "NO ORDER WAS SUBMITTED.",
  ].join("\n");
}

export function renderEquitySubmission(result: SafeEquitySubmissionView): string {
  return [
    `Submission: ${result.recovered ? "recovered" : "new"}`,
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId ?? "unknown"}  Environment: ${result.environment}`,
    `${result.order.side} ${String(result.order.quantity)} ${result.order.symbol} ${result.order.orderType === "STP" ? `stop ${String(result.order.stopPrice)}` : `limit ${String(result.order.limit)}`}`,
    ...renderSafeOperation(result.operation),
    ...(result.acknowledgedWarnings > 0
      ? [`Broker warnings acknowledged automatically: ${String(result.acknowledgedWarnings)}`]
      : []),
  ].join("\n");
}

let ordersPromise: Promise<EquityTools["orders"]> | undefined;

async function equityOrders(broker: BrokerName): Promise<EquityTools["orders"]> {
  if (broker !== "ibkr") {
    throw new Error(`Equity order previews are not implemented for broker '${broker}' yet.`);
  }
  ordersPromise ??= createEquityTools({ resolveGatewayTransport: cliGatewayTransport })
    .then((tools) => tools.orders)
    .catch((error: unknown) => {
      ordersPromise = undefined;
      throw error;
    });
  return ordersPromise;
}

/**
 * Register the guarded IBKR equity order commands.
 *
 * @remarks
 * These mirror the `preview_equity_order` and `submit_equity_order` MCP tools,
 * so the terminal and the agent surface drive the same service and the same
 * preview store. The preview/submit split is what keeps a submission bound to
 * reviewed, unexpired terms.
 */
export function addEquityCommands(
  program: Command,
  resolveBrokerFor: BrokerResolver,
  dependencies: EquityCommandDependencies = {}
): void {
  const createEquityOrders = dependencies.createEquityOrders ?? equityOrders;
  const createExecutionService =
    dependencies.createExecutionService ?? createGatewayExecutionService;
  const log = dependencies.log ?? console.log;
  const broker = (override: string | undefined): BrokerName => resolveBrokerFor(override, "ibkr");

  const equity = new Command("equity").description("Preview and submit guarded equity orders");

  equity
    .command("preview")
    .description("Run a non-submitting What-If for one US stock or ETF order")
    .argument("<symbol>", "US stock or ETF symbol")
    .argument("<side>", "BUY or SELL")
    .argument("<quantity>", "Whole shares")
    .option("--order-type <type>", "LIMIT or STOP (default: LIMIT)")
    .option("--limit <price>", "Limit price per share (LIMIT orders)")
    .option("--stop-price <price>", "Stop price per share (STOP orders, native stop-market)")
    .option("--tif <value>", "DAY or GTC", "DAY")
    .option("--session <value>", "REGULAR or OVERNIGHT", "REGULAR")
    .option(...GATEWAY_BROKER_FLAG)
    .option("--json", "Emit a stable JSON DTO")
    .addHelpText(
      "after",
      `
This never submits an order. The preview ID expires after a short time.
STOP is a native stop-market order, not stop-limit.

Examples:
  $ huskly-cli equity preview AAPL BUY 10 --limit 250.00
  $ huskly-cli equity preview AAPL BUY 10 --order-type LIMIT --limit 250.00
  $ huskly-cli equity preview AAPL SELL 10 --order-type STOP --stop-price 240.00
  $ huskly-cli equity preview AAPL SELL 10 --limit 260.00 --tif GTC --json`
    )
    .action(
      async (symbolValue: string, sideValue: string, quantity: string, options: PreviewOptions) => {
        const raw: Record<string, string | number> = {};
        if (options.orderType !== undefined) raw["orderType"] = options.orderType;
        if (options.limit !== undefined) raw["limit"] = parsePrice(options.limit);
        if (options.stopPrice !== undefined) raw["stopPrice"] = parsePrice(options.stopPrice);
        const terms = normalizeEquityOrderTerms(raw);
        const result = await (
          await createEquityOrders(broker(options.broker))
        ).preview({
          symbol: symbolValue.toUpperCase(),
          side: parseSide(sideValue),
          quantity: shares(quantity),
          ...terms,
          tif: parseTif(options.tif),
          session: session(options.session),
        });
        output(toPreviewView(result), options.json, renderEquityPreview, log);
      }
    );

  equity
    .command("submit")
    .description("Submit the exact, unexpired reviewed equity preview")
    .argument("<preview-id>", "Exact preview ID")
    .option("--operator <name>", "CME operator identity; defaults to HUSKLY_EXT_OPERATOR")
    .option("--confirm", "Confirm this order submission")
    .option(...GATEWAY_BROKER_FLAG)
    .option("--json", "Emit a stable JSON DTO")
    .addHelpText(
      "after",
      `
This places a real order in the preview-bound IBKR environment. --confirm
also acknowledges broker warnings for this submission. Use the "order"
commands for status, recovery, reconciliation, and cancellation.

Examples:
  $ huskly-cli equity submit <preview-id> --confirm
  $ huskly-cli equity submit <preview-id> --operator alice --confirm --json`
    )
    .action(async (previewId: string, options: SubmitOptions) => {
      const confirm = confirmed(options.confirm);
      const extOperator = requireOperator(options.operator);
      const selectedBroker = broker(options.broker);
      const submitted = await (
        await createEquityOrders(selectedBroker)
      ).submit({ previewId, operator: extOperator, confirm });
      const { result, count } = await acknowledgeWarnings(submitted, () =>
        createExecutionService(selectedBroker)
      );
      output(toSubmissionView(result, count), options.json, renderEquitySubmission, log);
    });

  program.addCommand(equity);
}
