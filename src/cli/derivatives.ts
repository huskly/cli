import { Command } from "commander";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import {
  derivativeDiscoveryClient,
  derivativeExecutionClient,
  derivativePreviewClient,
} from "#src/derivatives/derivativeClient.js";
import type {
  DerivativeAssetClass,
  DerivativeRight,
} from "#src/derivatives/derivativeDiscovery.js";
import {
  DerivativeResearchService,
  type OptionDiscoveryResearch,
  type OptionChainResearch,
  type VerticalSpreadResearch,
} from "#src/derivatives/derivativeResearch.js";
import type { VerticalSpreadKind } from "#src/derivatives/verticalSpread.js";
import type { TradingDiagnostics } from "#src/derivatives/derivativePreview.js";
import {
  DerivativePreviewService,
  FilePreviewStore,
  maskAccountId,
  type SpreadPreviewDto,
} from "#src/derivatives/derivativePreviewService.js";
import {
  DerivativeExecutionService,
  FileExecutionStateStore,
  type OrderLifecycleDto,
  type SubmissionDto,
} from "#src/derivatives/derivativeExecutionService.js";

interface SeriesOptions {
  asset: string;
  broker?: string;
  class?: string;
  exchange?: string;
  expiry: string;
  json?: boolean;
}

interface ChainOptions extends SeriesOptions {
  right?: string;
  around?: string;
  strikes: string;
}

interface SpreadOptions extends SeriesOptions {
  long: string;
  short: string;
  quantity: string;
  limit?: string;
}

interface PreviewOptions extends SpreadOptions {
  account?: string;
  credit?: string;
  debit?: string;
  session: string;
  tif: string;
}

interface ResolveOptions extends SeriesOptions {
  right?: string;
  strike?: string;
}

interface ExecutionOptions {
  account?: string;
  broker?: string;
  confirm?: boolean;
  json?: boolean;
  operator?: string;
}

interface WatchOptions extends ExecutionOptions {
  poll: string;
  timeout: string;
}

function assetClass(value: string): DerivativeAssetClass {
  const normalized = value.toUpperCase();
  if (normalized !== "OPT" && normalized !== "FOP") {
    throw new Error(`Invalid derivative asset class '${value}'. Expected OPT or FOP.`);
  }
  return normalized;
}

function right(value: string): DerivativeRight {
  const normalized = value.toUpperCase();
  if (normalized !== "CALL" && normalized !== "PUT") {
    throw new Error(`Invalid option right '${value}'. Expected CALL or PUT.`);
  }
  return normalized;
}

function spreadKind(value: string): VerticalSpreadKind {
  const normalized = value.toLowerCase();
  const kinds: VerticalSpreadKind[] = ["call-debit", "call-credit", "put-debit", "put-credit"];
  if (!kinds.includes(normalized as VerticalSpreadKind)) {
    throw new Error(`Invalid vertical kind '${value}'. Expected one of: ${kinds.join(", ")}.`);
  }
  return normalized as VerticalSpreadKind;
}

function accountId(value: string | undefined): string {
  const account = value ?? process.env["IBKR_ACCOUNT_ID"];
  if (!account?.trim()) throw new Error("An exact --account or IBKR_ACCOUNT_ID is required.");
  return account;
}

function operator(value: string | undefined): string {
  const result = value ?? process.env["HUSKLY_EXT_OPERATOR"];
  if (!result?.trim()) {
    throw new Error("An exact --operator or HUSKLY_EXT_OPERATOR is required.");
  }
  return result;
}

function confirmed(value: boolean | undefined): true {
  if (value !== true) throw new Error("This operation requires --confirm.");
  return true;
}

function tif(value: string): "DAY" | "GTC" {
  const normalized = value.toUpperCase();
  if (normalized !== "DAY" && normalized !== "GTC") {
    throw new Error(`Invalid TIF '${value}'. Expected DAY or GTC.`);
  }
  return normalized;
}

function session(value: string): "REGULAR" | "OVERNIGHT" {
  const normalized = value.toUpperCase();
  if (normalized !== "REGULAR" && normalized !== "OVERNIGHT") {
    throw new Error(`Invalid session '${value}'. Expected REGULAR or OVERNIGHT.`);
  }
  return normalized;
}

function number(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${name} '${value}'.`);
  return parsed;
}

function integer(value: string, name: string): number {
  const parsed = number(value, name);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function seriesOptions(command: Command): Command {
  return command
    .option("--broker <name>", "Broker to use: schwab or ibkr")
    .option("--asset <class>", "Derivative asset class: OPT or FOP", "OPT")
    .requiredOption("--expiry <date>", "Expiration date (YYYY-MM-DD)")
    .option("--class <trading-class>", "Exact broker trading class")
    .option("--exchange <exchange>", "Exact listing/routing exchange")
    .option("--json", "Emit a stable JSON DTO");
}

function seriesRequest(underlying: string, options: SeriesOptions) {
  return {
    assetClass: assetClass(options.asset),
    underlying: underlying.toUpperCase(),
    expiration: options.expiry,
    ...(options.class !== undefined ? { tradingClass: options.class.toUpperCase() } : {}),
    ...(options.exchange !== undefined ? { exchange: options.exchange.toUpperCase() } : {}),
  };
}

function formatPrice(value: number | null): string {
  return value === null ? "-" : String(value);
}


function observationDetails(observedAt: string | null, completeness: string): string {
  const detail = observedAt === null ? completeness : `${completeness} @ ${observedAt}`;
  return `[${detail}]`;
}


export function renderOptionDiscovery(result: OptionDiscoveryResearch): string {
  const reference = result.referenceQuote;
  const lines = [
    reference === null
      ? "Reference: not requested"
      : `Reference ${reference.value.symbol}: bid ${formatPrice(reference.value.bid)}  ask ${formatPrice(reference.value.ask)}  last ${formatPrice(reference.value.last)}  mark ${formatPrice(reference.value.mark)}  data ${reference.value.dataAvailability} ${observationDetails(reference.observedAt, reference.completeness)}`,
    `Contracts: ${String(result.contracts.value.length)} ${observationDetails(result.contracts.observedAt, result.contracts.completeness)}`,
    "EXPIRY  STRIKE  RIGHT  ASSET  CLASS  EXCHANGE  MULTIPLIER  BROKER-REFERENCE",
  ];
  for (const contract of result.contracts.value) {
    const identity = contract.identity;
    lines.push(
      [
        identity.expiration,
        identity.strike,
        identity.right,
        identity.assetClass,
        identity.tradingClass,
        identity.exchange,
        identity.multiplier,
        `${contract.brokerReference?.broker ?? "-"}:${contract.brokerReference?.contractId ?? "-"}`,
      ].join("  ")
    );
  }
  lines.push("Broker references are opaque and non-durable.");
  return lines.join("\n");
}

export function renderOptionChain(result: OptionChainResearch): string {
  const reference = result.referenceQuote;
  const lines = [
    reference === null
      ? "Reference: not requested"
      : `Reference ${reference.value.symbol}: ${formatPrice(reference.value.mark ?? reference.value.last)} (${reference.value.dataAvailability}) ${observationDetails(reference.observedAt, reference.completeness)}`,
    `Center: ${formatPrice(result.center)}  Contracts: ${String(result.quotes.value.length)} ${observationDetails(result.quotes.observedAt, result.quotes.completeness)}`,
    "STRIKE  RIGHT  BID  ASK  MARK  DELTA  CLASS  EXCHANGE  MULTIPLIER  DATA",
  ];
  for (const quote of result.quotes.value) {
    const identity = quote.contract.identity;
    lines.push(
      [
        identity.strike,
        identity.right,
        formatPrice(quote.bid),
        formatPrice(quote.ask),
        formatPrice(quote.mark),
        formatPrice(quote.delta),
        identity.tradingClass,
        identity.exchange,
        identity.multiplier,
        quote.dataAvailability,
      ].join("  ")
    );
  }
  return lines.join("\n");
}

export function renderVerticalSpread(result: VerticalSpreadResearch): string {
  const { spread } = result;
  const lines = [
    `${spread.kind} x${String(spread.quantity)}  width ${String(spread.width)}  multiplier ${String(spread.multiplier)}`,
    `Reference ${result.referenceQuote.value.symbol}: ${formatPrice(result.referenceQuote.value.mark ?? result.referenceQuote.value.last)} (${result.referenceQuote.value.dataAvailability}) ${observationDetails(result.referenceQuote.observedAt, result.referenceQuote.completeness)}`,
    `Long ${String(spread.longLeg.quote.contract.identity.strike)} @ ${formatPrice(spread.longLeg.quote.bid)} x ${formatPrice(spread.longLeg.quote.ask)}`,
    `Short ${String(spread.shortLeg.quote.contract.identity.strike)} @ ${formatPrice(spread.shortLeg.quote.bid)} x ${formatPrice(spread.shortLeg.quote.ask)}`,
  ];
  for (const scenario of spread.scenarios) {
    if (scenario.analysis === null) {
      lines.push(
        `${scenario.source}: ${String(scenario.price)} unavailable (${scenario.error ?? "invalid"})`
      );
      continue;
    }
    lines.push(
      `${scenario.source}: ${scenario.analysis.priceEffect.toLowerCase()} ${String(scenario.price)}  max profit ${String(scenario.analysis.maximumProfit)}  max loss ${String(scenario.analysis.maximumLoss)}  breakeven ${String(scenario.analysis.breakeven)}  return/risk ${String(scenario.analysis.returnOnRisk)}  net delta ${formatPrice(scenario.analysis.netDelta)}`
    );
  }
  lines.push(result.pricingNotice, spread.settlementWarning);
  return lines.join("\n");
}

function renderTradingDiagnostics(result: TradingDiagnostics): string {
  return [
    `Account: ${result.accountId}  Environment: ${result.environment}  State: ${result.state}`,
    `Authenticated: ${String(result.authenticated)}  Connected: ${String(result.connected)}  Competing session: ${String(result.competingSession)}`,
    `Read ready: ${String(result.readReady)}  New mutations ready: ${String(result.newMutationReady)}  Recovery ready: ${String(result.recoveryMutationReady)}`,
    `Account verified: ${String(result.accountVerified)}  Lock owned: ${String(result.lockOwned)}  Selected account matches: ${String(result.selectedAccountId === result.accountId)}`,
    `Market data: ${result.marketDataAvailable === null ? "unknown" : String(result.marketDataAvailable)}  Queue depth: ${String(result.readQueueDepth)}`,
    `Last tickle: ${result.lastTickleAt ?? "unknown"}  Next renewal: ${result.nextRenewalAt ?? "unknown"}  Last broker request: ${result.lastBrokerRequestAt ?? "unknown"}`,
    `Pending warnings: ${String(result.pendingWarnings)}  Reconciliation required: ${String(result.reconciliationRequiredOperations)}`,
  ].join("\n");
}

function renderSpreadPreview(result: SpreadPreviewDto): string {
  return [
    `Preview ${result.previewId}`,
    `Account: ${result.account.maskedId}  Environment: ${result.account.environment}`,
    `Expires: ${result.expiresAt}`,
    `${result.order.kind} x${String(result.order.quantity)} ${result.order.priceEffect.toLowerCase()} ${String(result.order.limit)}`,
    `Initial margin change: ${formatPrice(result.whatIf.initialMargin?.change ?? null)}`,
    `Maintenance margin change: ${formatPrice(result.whatIf.maintenanceMargin?.change ?? null)}`,
    `Commission/fees: ${formatPrice(result.whatIf.commission)}`,
    `Warnings: ${result.whatIf.warnings.join(" | ") || "none"}`,
    `Rejections: ${result.whatIf.rejectionReasons.join(" | ") || "none"}`,
    "NO ORDER WAS SUBMITTED.",
  ].join("\n");
}

function renderSubmission(result: SubmissionDto): string {
  const lines = [
    `Submission: ${result.state}`,
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId}  Environment: ${result.account.environment}`,
  ];
  if (result.orderId !== undefined) lines.push(`Order: ${result.orderId}`);
  if (result.clientOrderId !== undefined) lines.push(`Client order: ${result.clientOrderId}`);
  if (result.status !== undefined) lines.push(`Verified status: ${result.status}`);
  if (result.updatedAt !== undefined) lines.push(`Updated: ${result.updatedAt ?? "unknown"}`);
  for (const warning of result.warnings) {
    lines.push(
      `Warning ${warning.replyId} (${warning.known ? "known" : "UNKNOWN"}): ${warning.messages.join(" | ")}`
    );
  }
  if (result.rejectionReasons.length > 0) {
    lines.push(`Rejected: ${result.rejectionReasons.join(" | ")}`);
  }
  if (result.recovery !== undefined) {
    lines.push(`Recovery required: ${result.recovery.reasons.join(" | ")}`);
  }
  return lines.join("\n");
}

function renderOrderLifecycle(result: OrderLifecycleDto): string {
  return [
    `Order ${result.orderId}: ${result.status}`,
    `Account: ${result.account.maskedId}  Environment: ${result.account.environment}`,
    `Quantity: ${String(result.filledQuantity)}/${String(result.quantity)}  Remaining: ${String(result.remainingQuantity)}`,
    `Limit: ${formatPrice(result.limitPrice)}  Average fill: ${formatPrice(result.averagePrice)}`,
    `Commission/fees: ${formatPrice(result.commissionAndFees)}`,
    `Verified against preview: ${String(result.verifiedAgainstPreview)}`,
  ].join("\n");
}

function output<T>(value: T, json: boolean | undefined, render: (result: T) => string): void {
  console.log(json === true ? JSON.stringify(value, null, 2) : render(value));
}

async function service(broker: BrokerName): Promise<DerivativeResearchService> {
  return new DerivativeResearchService(await derivativeDiscoveryClient(broker));
}

async function previewService(broker: BrokerName): Promise<DerivativePreviewService> {
  const [discovery, preview] = await Promise.all([
    derivativeDiscoveryClient(broker),
    derivativePreviewClient(broker),
  ]);
  return new DerivativePreviewService(
    discovery,
    preview,
    () => new Date(),
    5 * 60 * 1000,
    new FilePreviewStore()
  );
}

async function executionService(broker: BrokerName): Promise<DerivativeExecutionService> {
  const [discovery, preview, execution] = await Promise.all([
    derivativeDiscoveryClient(broker),
    derivativePreviewClient(broker),
    derivativeExecutionClient(broker),
  ]);
  const previews = new DerivativePreviewService(
    discovery,
    preview,
    () => new Date(),
    5 * 60 * 1000,
    new FilePreviewStore()
  );
  return new DerivativeExecutionService(
    discovery,
    preview,
    execution,
    previews,
    new FileExecutionStateStore()
  );
}

/** Register broker-neutral derivative research commands without changing legacy chain commands. */
export function addDerivativeCommands(
  program: Command,
  broker: (override?: string) => BrokerName
): void {
  const option = new Command("option").description("Resolve and research exact derivative series");

  seriesOptions(
    option
      .command("resolve")
      .description("Resolve exact contracts in a derivative series")
      .argument("<underlying>", "Underlying symbol")
      .option("--right <right>", "Filter to CALL or PUT")
      .option("--strike <strike>", "Filter to one exact strike")
  ).action(async (underlying: string, options: ResolveOptions) => {
    const result = await (
      await service(broker(options.broker))
    ).discover({
      ...seriesRequest(underlying, options),
      ...(options.strike !== undefined ? { strike: number(options.strike, "strike") } : {}),
      ...(options.right !== undefined ? { right: right(options.right) } : {}),
    });
    output(result, options.json, renderOptionDiscovery);
  });

  seriesOptions(
    option
      .command("chain")
      .description("Quote an exact derivative series")
      .argument("<underlying>", "Underlying symbol")
      .option("--right <right>", "Filter to CALL or PUT")
      .option("--around <strike>", "Center strike; defaults to the reference market")
      .option("--strikes <count>", "Strikes on each side of center", "10")
  ).action(async (underlying: string, options: ChainOptions) => {
    const result = await (
      await service(broker(options.broker))
    ).chain({
      ...seriesRequest(underlying, options),
      ...(options.right !== undefined ? { right: right(options.right) } : {}),
      ...(options.around !== undefined ? { around: number(options.around, "around strike") } : {}),
      strikes: integer(options.strikes, "Strike count"),
    });
    output(result, options.json, renderOptionChain);
  });

  program.addCommand(option);

  const spread = new Command("spread").description("Research multi-leg derivative spreads");
  seriesOptions(
    spread
      .command("quote")
      .description("Analyze a two-leg vertical from individual leg markets")
      .argument("<kind>", "call-debit, call-credit, put-debit, or put-credit")
      .argument("<underlying>", "Underlying symbol")
      .requiredOption("--long <strike>", "Long-leg strike")
      .requiredOption("--short <strike>", "Short-leg strike")
      .option("--quantity <count>", "Number of spreads", "1")
      .option("--limit <price>", "Optional user limit for an additional scenario")
  ).action(async (kindValue: string, underlying: string, options: SpreadOptions) => {
    const quantity = integer(options.quantity, "Quantity");
    if (quantity === 0) throw new Error("Quantity must be greater than zero.");
    const result = await (
      await service(broker(options.broker))
    ).quoteVertical({
      ...seriesRequest(underlying, options),
      kind: spreadKind(kindValue),
      longStrike: number(options.long, "long strike"),
      shortStrike: number(options.short, "short strike"),
      quantity,
      ...(options.limit !== undefined ? { limit: number(options.limit, "limit") } : {}),
    });
    output(result, options.json, renderVerticalSpread);
  });

  seriesOptions(
    spread
      .command("preview")
      .description("Run an explicit non-submitting vertical What-If")
      .argument("<kind>", "call-debit, call-credit, put-debit, or put-credit")
      .argument("<underlying>", "Underlying symbol")
      .requiredOption("--long <strike>", "Long-leg strike")
      .requiredOption("--short <strike>", "Short-leg strike")
      .option("--account <id>", "Exact account ID; defaults to IBKR_ACCOUNT_ID")
      .option("--credit <price>", "Positive net credit")
      .option("--debit <price>", "Positive net debit")
      .option("--quantity <count>", "Number of spreads", "1")
      .option("--tif <value>", "DAY or GTC", "DAY")
      .option("--session <value>", "REGULAR or OVERNIGHT", "REGULAR")
  ).action(async (kindValue: string, underlying: string, options: PreviewOptions) => {
    if ((options.credit === undefined) === (options.debit === undefined)) {
      throw new Error("Provide exactly one of --credit or --debit.");
    }
    const quantity = integer(options.quantity, "Quantity");
    if (quantity === 0) throw new Error("Quantity must be greater than zero.");
    const priceEffect = options.credit !== undefined ? "CREDIT" : "DEBIT";
    const limitValue = options.credit ?? options.debit;
    if (limitValue === undefined) throw new Error("A credit or debit is required.");
    const result = await (
      await previewService(broker(options.broker))
    ).previewVertical({
      ...seriesRequest(underlying, options),
      accountId: accountId(options.account),
      kind: spreadKind(kindValue),
      longStrike: number(options.long, "long strike"),
      shortStrike: number(options.short, "short strike"),
      quantity,
      priceEffect,
      limit: number(limitValue, priceEffect.toLowerCase()),
      tif: tif(options.tif),
      session: session(options.session),
    });
    output(result, options.json, renderSpreadPreview);
  });

  spread
    .command("submit")
    .description("Submit the exact, unexpired reviewed preview")
    .argument("<preview-id>", "Exact preview ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--account <id>", "Exact account ID; defaults to IBKR_ACCOUNT_ID")
    .option("--operator <name>", "CME operator identity; defaults to HUSKLY_EXT_OPERATOR")
    .option("--confirm", "Confirm this order submission")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (previewId: string, options: ExecutionOptions) => {
      const confirm = confirmed(options.confirm);
      const extOperator = operator(options.operator);
      const result = await (
        await executionService(broker(options.broker))
      ).submit({
        previewId,
        accountId: accountId(options.account),
        operator: extOperator,
        confirm,
      });
      output(result, options.json, renderSubmission);
    });

  spread
    .command("acknowledge")
    .description("Acknowledge one known broker warning for the exact preview")
    .argument("<preview-id>", "Exact preview ID")
    .argument("<reply-id>", "Exact broker warning reply ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--account <id>", "Exact account ID; defaults to IBKR_ACCOUNT_ID")
    .option("--confirm", "Confirm this warning acknowledgment")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (previewId: string, replyId: string, options: ExecutionOptions) => {
      const confirm = confirmed(options.confirm);
      const result = await (
        await executionService(broker(options.broker))
      ).acknowledgeWarning({
        previewId,
        replyId,
        accountId: accountId(options.account),
        confirm,
      });
      output(result, options.json, renderSubmission);
    });
  program.addCommand(spread);

  const order = new Command("order").description("Inspect or cancel guarded derivative orders");
  order
    .command("show")
    .argument("<order-id>", "Broker order ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--account <id>", "Exact account ID; defaults to IBKR_ACCOUNT_ID")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (orderId: string, options: ExecutionOptions) => {
      const result = await (
        await executionService(broker(options.broker))
      ).getStatus(orderId, accountId(options.account));
      output(result, options.json, renderOrderLifecycle);
    });
  order
    .command("watch")
    .argument("<order-id>", "Broker order ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--account <id>", "Exact account ID; defaults to IBKR_ACCOUNT_ID")
    .option("--timeout <seconds>", "Maximum watch duration", "300")
    .option("--poll <seconds>", "Polling interval", "2")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (orderId: string, options: WatchOptions) => {
      const result = await (
        await executionService(broker(options.broker))
      ).watch({
        orderId,
        accountId: accountId(options.account),
        timeoutMs: number(options.timeout, "timeout") * 1000,
        pollMs: number(options.poll, "poll") * 1000,
      });
      output(result, options.json, renderOrderLifecycle);
    });
  order
    .command("cancel")
    .argument("<order-id>", "Broker order ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--account <id>", "Exact account ID; defaults to IBKR_ACCOUNT_ID")
    .option("--operator <name>", "CME operator identity; defaults to HUSKLY_EXT_OPERATOR")
    .option("--confirm", "Confirm cancellation")
    .option("--timeout <seconds>", "Maximum verification duration", "300")
    .option("--poll <seconds>", "Polling interval", "2")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (orderId: string, options: WatchOptions) => {
      const confirm = confirmed(options.confirm);
      const extOperator = operator(options.operator);
      const result = await (
        await executionService(broker(options.broker))
      ).cancel({
        orderId,
        accountId: accountId(options.account),
        operator: extOperator,
        confirm,
        timeoutMs: number(options.timeout, "timeout") * 1000,
        pollMs: number(options.poll, "poll") * 1000,
      });
      output(result, options.json, renderOrderLifecycle);
    });
  program.addCommand(order);

  const brokerCommand = new Command("broker").description("Broker diagnostics");
  brokerCommand
    .command("doctor")
    .description("Run read-only broker trading diagnostics")
    .option("--broker <name>", "Broker to use: schwab or ibkr", "ibkr")
    .option("--trading", "Include trading-session and advisory permission diagnostics")
    .option("--json", "Emit a stable JSON DTO")
    .action(
      async (options: { broker: string; trading?: boolean; json?: boolean }) => {
        const result = await (
          await previewService(broker(options.broker))
        ).getTradingDiagnostics();
        const safeResult: TradingDiagnostics = {
          ...result,
          accountId: maskAccountId(result.accountId),
          selectedAccountId:
            result.selectedAccountId === null ? null : maskAccountId(result.selectedAccountId),
        };
        output(safeResult, options.json, renderTradingDiagnostics);
      }
    );
  program.addCommand(brokerCommand);
}
