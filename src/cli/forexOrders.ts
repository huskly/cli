import { Command } from "commander";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import { formatForexPrice, formatMoney } from "#src/format.js";
import type { ForexPreviewDto, ForexSubmissionDto } from "#src/forex/forexOrderService.js";
import { cliGatewayTransport } from "#src/gateway/gatewayTransport.js";
import { createForexTools, type ForexTools } from "#src/mcp/tools/forexOrders.js";
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
import { renderSafeOperation, safeOperation, type SafeOperationView } from "./operationView.js";
import { requireOperator, type BrokerResolver } from "./shared.js";

export interface ForexCommandDependencies {
  readonly createForexOrders?: (broker: BrokerName) => Promise<ForexTools["orders"]>;
  readonly createExecutionService?: (broker: BrokerName) => Promise<WarningExecutionService>;
  readonly log?: (line: string) => void;
}

interface PreviewOptions {
  broker?: string;
  limit?: string;
  tif: string;
  json?: boolean;
}

interface SubmitOptions {
  broker?: string;
  operator?: string;
  confirm?: boolean;
  json?: boolean;
}

/** The FX order as the terminal and `--json` show it. */
interface SafeForexOrderView {
  readonly pair: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly orderType: "LMT";
  readonly limit: number;
  readonly tif: "DAY" | "GTC";
}

interface SafeForexPreviewView {
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly environment: ForexPreviewDto["environment"];
  readonly account: ForexPreviewDto["account"];
  readonly order: SafeForexOrderView;
  readonly whatIf: ForexPreviewDto["whatIf"];
  readonly submitted: false;
}

interface SafeForexSubmissionView {
  readonly previewId: string;
  readonly environment: ForexSubmissionDto["environment"];
  readonly account: ForexSubmissionDto["account"];
  readonly order: SafeForexOrderView;
  readonly operation: SafeOperationView;
  readonly recovered: boolean;
  readonly acknowledgedWarnings: number;
}

function baseUnits(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Quantity must be a whole number of base-currency units above zero, got '${value}'.`
    );
  }
  return parsed;
}

function limitPrice(value: string | undefined): number {
  if (value === undefined) throw new Error("FX orders require --limit <price>.");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid limit price '${value}'.`);
  return parsed;
}

function orderView(intent: ForexPreviewDto["order"]): SafeForexOrderView {
  return {
    pair: intent.contract.localSymbol,
    baseCurrency: intent.contract.symbol,
    quoteCurrency: intent.contract.currency,
    side: intent.side,
    quantity: intent.quantity,
    orderType: intent.orderType,
    limit: intent.limit,
    tif: intent.tif,
  };
}

function toPreviewView(result: ForexPreviewDto): SafeForexPreviewView {
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
  result: ForexSubmissionDto,
  acknowledgedWarnings = 0
): SafeForexSubmissionView {
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

/** `BUY 25,000 USD.JPY limit ¥147.25`: units in the base currency, price in the quote currency. */
function orderLine(order: SafeForexOrderView): string {
  return `${order.side} ${formatMoney(order.quantity, order.baseCurrency, { minimum: 0, maximum: 0 })} ${order.pair} limit ${formatForexPrice(order.limit, order.quoteCurrency)}`;
}

export function renderForexPreview(result: SafeForexPreviewView): string {
  const money = (value: number | null | undefined): string =>
    formatMoney(value, result.whatIf.currency);
  return [
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId ?? "unknown"}  Environment: ${result.environment}`,
    `Created: ${result.createdAt}`,
    `Expires: ${result.expiresAt}`,
    `${orderLine(result.order)}  ${result.order.tif}`,
    `Accepted: ${String(result.whatIf.accepted)}`,
    `Initial margin change: ${money(result.whatIf.initialMargin?.change)}`,
    `Maintenance margin change: ${money(result.whatIf.maintenanceMargin?.change)}`,
    `Commission/fees: ${money(result.whatIf.commission)}`,
    `Warnings: ${result.whatIf.warnings.join(" | ") || "none"}`,
    `Rejections: ${result.whatIf.rejectionReasons.join(" | ") || "none"}`,
    "NO ORDER WAS SUBMITTED.",
  ].join("\n");
}

export function renderForexSubmission(result: SafeForexSubmissionView): string {
  return [
    `Submission: ${result.recovered ? "recovered" : "new"}`,
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId ?? "unknown"}  Environment: ${result.environment}`,
    orderLine(result.order),
    ...renderSafeOperation(result.operation),
    ...(result.acknowledgedWarnings > 0
      ? [`Broker warnings acknowledged automatically: ${String(result.acknowledgedWarnings)}`]
      : []),
  ].join("\n");
}

let ordersPromise: Promise<ForexTools["orders"]> | undefined;

async function forexOrders(broker: BrokerName): Promise<ForexTools["orders"]> {
  if (broker !== "ibkr") throw new Error("FX orders are available for IBKR only.");
  ordersPromise ??= createForexTools({ resolveGatewayTransport: cliGatewayTransport })
    .then((tools) => tools.orders)
    .catch((error: unknown) => {
      ordersPromise = undefined;
      throw error;
    });
  return ordersPromise;
}

/**
 * Register the guarded IBKR spot FX order commands.
 *
 * @remarks
 * These mirror the `fx_order_preview` and `fx_order_submit` MCP tools. Use the
 * `order` commands for status, recovery, reconciliation, and cancellation.
 */
export function addForexCommands(
  program: Command,
  resolveBrokerFor: BrokerResolver,
  dependencies: ForexCommandDependencies = {}
): void {
  const createForexOrders = dependencies.createForexOrders ?? forexOrders;
  const createExecutionService =
    dependencies.createExecutionService ?? createGatewayExecutionService;
  const log = dependencies.log ?? console.log;
  const broker = (override: string | undefined): BrokerName => {
    const selected = resolveBrokerFor(override, "ibkr");
    if (selected !== "ibkr") throw new Error("FX orders are available for IBKR only.");
    return selected;
  };

  const fx = new Command("fx").description("Preview and submit guarded IBKR spot FX orders");

  fx.command("preview")
    .description("Run a non-submitting What-If for one IDEALPRO spot FX LIMIT order")
    .argument("<pair>", "Currency pair: USD.JPY, USD/JPY, or USDJPY")
    .argument("<side>", "BUY or SELL the base currency")
    .argument("<quantity>", "Whole base-currency units, for example 25000")
    .option("--limit <price>", "Quote-currency price of one base unit")
    .option("--tif <value>", "DAY or GTC", "DAY")
    .option(...GATEWAY_BROKER_FLAG)
    .option("--json", "Emit a stable JSON DTO")
    .addHelpText(
      "after",
      `
This never submits an order. The preview ID expires after a short time.
IBKR checks the price increment and the minimum size. A small order can
route to IDEALPRO as an odd lot at a worse price; the preview then shows
the IBKR warning.

Examples:
  $ huskly-cli fx preview USD.JPY BUY 25000 --limit 147.25
  $ huskly-cli fx preview EUR/USD SELL 30000 --limit 1.0850 --tif GTC --json`
    )
    .action(async (pair: string, sideValue: string, quantity: string, options: PreviewOptions) => {
      const selectedBroker = broker(options.broker);
      const input = {
        pair,
        side: parseSide(sideValue),
        quantity: baseUnits(quantity),
        limit: limitPrice(options.limit),
        tif: parseTif(options.tif),
      };
      const result = await (await createForexOrders(selectedBroker)).preview(input);
      output(toPreviewView(result), options.json, renderForexPreview, log);
    });

  fx.command("submit")
    .description("Submit the exact, unexpired reviewed FX preview")
    .argument("<preview-id>", "Exact preview ID")
    .option("--operator <name>", "Operator identity; defaults to HUSKLY_EXT_OPERATOR")
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
  $ huskly-cli fx submit <preview-id> --confirm
  $ huskly-cli fx submit <preview-id> --operator alice --confirm --json`
    )
    .action(async (previewId: string, options: SubmitOptions) => {
      const selectedBroker = broker(options.broker);
      const confirm = confirmed(options.confirm);
      const operator = requireOperator(options.operator);
      const submitted = await (
        await createForexOrders(selectedBroker)
      ).submit({ previewId, operator, confirm });
      const { result, count } = await acknowledgeWarnings(submitted, () =>
        createExecutionService(selectedBroker)
      );
      output(toSubmissionView(result, count), options.json, renderForexSubmission, log);
    });

  program.addCommand(fx);
}
