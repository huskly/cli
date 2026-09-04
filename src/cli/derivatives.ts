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
import type {
  OrderOperationView,
  OrderReconciliationView,
} from "#src/derivatives/derivativeExecution.js";
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
  broker?: string;
  confirm?: boolean;
  json?: boolean;
  operator?: string;
}

interface WatchOptions extends ExecutionOptions {
  poll: string;
  timeout: string;
}

interface AcknowledgeOptions extends ExecutionOptions {
  reply: string;
}

type ResearchServiceLike = Pick<DerivativeResearchService, "discover" | "chain" | "quoteVertical">;
type PreviewServiceLike = Pick<
  DerivativePreviewService,
  "previewVertical" | "getTradingDiagnostics"
>;
type ExecutionServiceLike = Pick<
  DerivativeExecutionService,
  "submit" | "recover" | "getStatus" | "watch" | "acknowledgeWarning" | "reconcile" | "cancel"
>;

export interface DerivativeCommandDependencies {
  readonly createResearchService?: (broker: BrokerName) => Promise<ResearchServiceLike>;
  readonly createPreviewService?: (broker: BrokerName) => Promise<PreviewServiceLike>;
  readonly createExecutionService?: (broker: BrokerName) => Promise<ExecutionServiceLike>;
  readonly log?: (line: string) => void;
}

interface SafeAccountView {
  readonly maskedId: string;
  readonly environment: "paper" | "live";
}

interface SafeOperationView {
  readonly operationId: string;
  readonly kind: OrderOperationView["kind"];
  readonly action: OrderOperationView["action"];
  readonly state: OrderOperationView["state"];
  readonly createdAt: string;
  readonly latestTransitionAt: string;
  readonly pendingWarning: OrderOperationView["pendingWarning"];
  readonly reconciliation: OrderOperationView["reconciliation"];
  readonly result: {
    readonly kind: NonNullable<OrderOperationView["result"]>["kind"];
    readonly warningCount: number;
    readonly orderCount: number;
    readonly statuses?: readonly NonNullable<
      OrderOperationView["result"]
    >["orders"][number]["status"][];
    readonly reasonCategories?: readonly string[];
  } | null;
  readonly childActions: readonly {
    readonly operationId: string;
    readonly action: "warning_acknowledgement" | "cancellation";
    readonly state: string;
    readonly createdAt: string;
    readonly latestTransitionAt: string;
  }[];
}

interface SafeSpreadPreviewView {
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly account: SafeAccountView;
  readonly order: {
    readonly kind: VerticalSpreadKind;
    readonly quantity: number;
    readonly priceEffect: "CREDIT" | "DEBIT";
    readonly limit: number;
    readonly tif: "DAY" | "GTC";
    readonly session: "REGULAR" | "OVERNIGHT";
    readonly legs: readonly {
      readonly side: "LONG" | "SHORT";
      readonly ratio: 1 | -1;
      readonly assetClass: DerivativeAssetClass;
      readonly underlying: string;
      readonly expiration: string;
      readonly strike: number;
      readonly right: DerivativeRight;
      readonly tradingClass: string;
      readonly exchange: string;
      readonly multiplier: number;
    }[];
  };
  readonly whatIf: {
    readonly accepted: boolean;
    readonly submitted: false;
    readonly commission: number | null;
    readonly initialMargin: SpreadPreviewDto["whatIf"]["initialMargin"];
    readonly maintenanceMargin: SpreadPreviewDto["whatIf"]["maintenanceMargin"];
    readonly warnings: readonly string[];
    readonly rejectionReasons: readonly string[];
    readonly advisoryAssetPermissions: readonly string[];
  };
  readonly submitted: false;
}

interface SafeSubmissionView {
  readonly previewId: string;
  readonly state: SubmissionDto["state"];
  readonly account: SafeAccountView;
  readonly operation: SafeOperationView;
  readonly updatedAt?: string | null;
  readonly verifiedStatus?: SubmissionDto["status"];
  readonly warnings: readonly {
    readonly replyId: string;
    readonly known: boolean;
    readonly messageCount: number;
  }[];
  readonly rejectionReasons: readonly string[];
  readonly recoveryEvidence: {
    readonly required: true;
    readonly reasonCategories: readonly string[];
    readonly orderCount: number;
    readonly reconciliation: OrderOperationView["reconciliation"];
  } | null;
}

interface SafeLifecycleView extends SafeSubmissionView {
  readonly verifiedAgainstPreview: true;
  readonly quantity: number;
  readonly filledQuantity: number;
  readonly remainingQuantity: number;
  readonly averagePrice: number | null;
  readonly limitPrice: number | null;
  readonly commissionAndFees: number | null;
}

interface SafeReconciliationView {
  readonly operation: SafeOperationView;
  readonly observation: OrderOperationView["reconciliation"];
}

interface SafeTradingDiagnosticsView {
  readonly account: {
    readonly maskedId: string;
    readonly environment: TradingDiagnostics["environment"];
    readonly verified: boolean;
  };
  readonly gateway: {
    readonly state: TradingDiagnostics["state"];
    readonly authenticated: boolean;
    readonly connected: boolean | null;
    readonly competingSession: boolean;
    readonly readReady: boolean;
    readonly newMutationReady: boolean;
    readonly recoveryMutationReady: boolean;
    readonly lockOwned: boolean;
  };
  readonly marketDataAvailable: boolean | null;
  readonly advisoryAssetPermissions: readonly string[];
  readonly timing: {
    readonly lastTickleAt: string | null;
    readonly nextRenewalAt: string | null;
    readonly lastBrokerRequestAt: string | null;
  };
  readonly queueDepth: number;
  readonly pendingWarnings: number;
  readonly reconciliationRequiredOperations: number;
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

function safeAccount(
  maskedId: string | null | undefined,
  environment: SafeAccountView["environment"]
): SafeAccountView {
  return { maskedId: maskedId ?? "unknown", environment };
}

function safeOperation(operation: OrderOperationView): SafeOperationView {
  const result =
    operation.result === null
      ? null
      : {
          kind: operation.result.kind,
          warningCount: operation.result.warningCount,
          orderCount: operation.result.orders.length,
          ...(operation.result.orders.length === 0
            ? {}
            : { statuses: [...new Set(operation.result.orders.map((order) => order.status))] }),
          ...("reasonCategories" in operation.result && operation.result.reasonCategories.length > 0
            ? { reasonCategories: operation.result.reasonCategories }
            : {}),
        };
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    action: operation.action,
    state: operation.state,
    createdAt: operation.createdAt,
    latestTransitionAt: operation.latestTransitionAt,
    pendingWarning: operation.pendingWarning,
    reconciliation: operation.reconciliation,
    result,
    childActions: operation.children.map((child) => ({
      operationId: child.operationId,
      action: child.action,
      state: child.state,
      createdAt: child.createdAt,
      latestTransitionAt: child.latestTransitionAt,
    })),
  };
}

function toSpreadPreviewView(result: SpreadPreviewDto): SafeSpreadPreviewView {
  return {
    previewId: result.previewId,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
    account: safeAccount(result.account.maskedId, result.account.environment),
    order: {
      kind: result.order.kind,
      quantity: result.order.quantity,
      priceEffect: result.order.priceEffect,
      limit: result.order.limit,
      tif: result.order.tif,
      session: result.order.session,
      legs: result.order.legs.map((leg) => ({
        side: leg.side,
        ratio: leg.ratio,
        assetClass: leg.contract.identity.assetClass,
        underlying: leg.contract.identity.underlying,
        expiration: leg.contract.identity.expiration,
        strike: leg.contract.identity.strike,
        right: leg.contract.identity.right,
        tradingClass: leg.contract.identity.tradingClass,
        exchange: leg.contract.identity.exchange,
        multiplier: leg.contract.identity.multiplier,
      })),
    },
    whatIf: {
      accepted: result.whatIf.accepted,
      submitted: result.whatIf.submitted,
      commission: result.whatIf.commission,
      initialMargin: result.whatIf.initialMargin,
      maintenanceMargin: result.whatIf.maintenanceMargin,
      warnings: result.whatIf.warnings,
      rejectionReasons: result.whatIf.rejectionReasons,
      advisoryAssetPermissions: result.whatIf.advisoryAssetPermissions,
    },
    submitted: result.submitted,
  };
}

function toSubmissionView(result: SubmissionDto): SafeSubmissionView {
  const operation = safeOperation(result.operation);
  return {
    previewId: result.previewId,
    state: result.state,
    account: safeAccount(result.account.maskedId, result.account.environment),
    operation,
    ...(result.updatedAt !== undefined ? { updatedAt: result.updatedAt } : {}),
    ...(result.status !== undefined ? { verifiedStatus: result.status } : {}),
    warnings: result.warnings.map((warning) => ({
      replyId: warning.replyId,
      known: warning.known,
      messageCount: warning.messages.length,
    })),
    rejectionReasons: result.rejectionReasons,
    recoveryEvidence:
      operation.result?.kind !== "recovery_required"
        ? null
        : {
            required: true,
            reasonCategories: operation.result.reasonCategories ?? [],
            orderCount: operation.result.orderCount,
            reconciliation: operation.reconciliation,
          },
  };
}

function toLifecycleView(result: OrderLifecycleDto): SafeLifecycleView {
  const base = toSubmissionView(result);
  return {
    ...base,
    verifiedAgainstPreview: result.verifiedAgainstPreview,
    quantity: result.quantity,
    filledQuantity: result.filledQuantity,
    remainingQuantity: result.remainingQuantity,
    averagePrice: result.averagePrice,
    limitPrice: result.limitPrice,
    commissionAndFees: result.commissionAndFees,
  };
}

function toReconciliationView(result: OrderReconciliationView): SafeReconciliationView {
  return {
    operation: safeOperation(result),
    observation: result.reconciliation,
  };
}

function toTradingDiagnosticsView(result: TradingDiagnostics): SafeTradingDiagnosticsView {
  return {
    account: {
      maskedId: maskAccountId(result.maskedAccountDisplay ?? result.accountId),
      environment: result.environment,
      verified: result.accountVerified,
    },
    gateway: {
      state: result.state,
      authenticated: result.authenticated,
      connected: result.connected,
      competingSession: result.competingSession,
      readReady: result.readReady,
      newMutationReady: result.newMutationReady,
      recoveryMutationReady: result.recoveryMutationReady,
      lockOwned: result.lockOwned,
    },
    marketDataAvailable: result.marketDataAvailable,
    advisoryAssetPermissions: result.advisoryAssetPermissions,
    timing: {
      lastTickleAt: result.lastTickleAt,
      nextRenewalAt: result.nextRenewalAt,
      lastBrokerRequestAt: result.lastBrokerRequestAt,
    },
    queueDepth: result.readQueueDepth,
    pendingWarnings: result.pendingWarnings,
    reconciliationRequiredOperations: result.reconciliationRequiredOperations,
  };
}

function renderSafeOperation(operation: SafeOperationView): string[] {
  const lines = [
    `Operation: ${operation.operationId}`,
    `Kind: ${operation.kind}  Action: ${operation.action}  State: ${operation.state}`,
    `Created: ${operation.createdAt}  Updated: ${operation.latestTransitionAt}`,
  ];
  if (operation.result !== null) {
    lines.push(
      `Result: ${operation.result.kind}  Orders: ${String(operation.result.orderCount)}  Warnings: ${String(operation.result.warningCount)}`
    );
    if (operation.result.statuses !== undefined) {
      lines.push(`Observed statuses: ${operation.result.statuses.join(" | ")}`);
    }
    if (operation.result.reasonCategories !== undefined) {
      lines.push(`Reason categories: ${operation.result.reasonCategories.join(" | ")}`);
    }
  } else {
    lines.push("Result: pending");
  }
  if (operation.pendingWarning !== null) {
    lines.push(
      `Pending warning: reply ${operation.pendingWarning.replyId}  sequence ${String(operation.pendingWarning.sequence)}`
    );
  }
  if (operation.reconciliation !== null) {
    lines.push(
      `Reconciliation: ${operation.reconciliation.status} @ ${operation.reconciliation.observedAt}  reason ${operation.reconciliation.reason}`
    );
  }
  if (operation.childActions.length > 0) {
    lines.push(
      `Child actions: ${operation.childActions.map((child) => `${child.action}:${child.state}:${child.operationId}`).join(" | ")}`
    );
  }
  return lines;
}

function renderSpreadPreview(result: SafeSpreadPreviewView): string {
  return [
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId}  Environment: ${result.account.environment}`,
    `Created: ${result.createdAt}`,
    `Expires: ${result.expiresAt}`,
    `${result.order.kind} x${String(result.order.quantity)} ${result.order.priceEffect.toLowerCase()} ${String(result.order.limit)}  ${result.order.tif} ${result.order.session}`,
    `Legs: ${result.order.legs.map((leg) => `${leg.side} ${leg.underlying} ${leg.expiration} ${String(leg.strike)} ${leg.right}`).join(" | ")}`,
    `Initial margin change: ${formatPrice(result.whatIf.initialMargin?.change ?? null)}`,
    `Maintenance margin change: ${formatPrice(result.whatIf.maintenanceMargin?.change ?? null)}`,
    `Commission/fees: ${formatPrice(result.whatIf.commission)}`,
    `Warnings: ${result.whatIf.warnings.join(" | ") || "none"}`,
    `Rejections: ${result.whatIf.rejectionReasons.join(" | ") || "none"}`,
    "NO ORDER WAS SUBMITTED.",
  ].join("\n");
}

function renderSubmission(result: SafeSubmissionView): string {
  const lines = [
    `Submission: ${result.state}`,
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId}  Environment: ${result.account.environment}`,
    ...renderSafeOperation(result.operation),
  ];
  if (result.verifiedStatus !== undefined) {
    lines.push(`Verified status: ${result.verifiedStatus}`);
  }
  if (result.updatedAt !== undefined) {
    lines.push(`Updated: ${result.updatedAt ?? "unknown"}`);
  }
  for (const warning of result.warnings) {
    lines.push(
      `Warning reply: ${warning.replyId} (${warning.known ? "known" : "unknown"})  message count ${String(warning.messageCount)}`
    );
  }
  if (result.rejectionReasons.length > 0) {
    lines.push(`Rejected: ${result.rejectionReasons.join(" | ")}`);
  }
  if (result.recoveryEvidence !== null) {
    lines.push(
      `Recovery evidence: required  reason categories ${result.recoveryEvidence.reasonCategories.join(" | ") || "none"}  observed orders ${String(result.recoveryEvidence.orderCount)}`
    );
  }
  return lines.join("\n");
}

function renderOrderLifecycle(result: SafeLifecycleView): string {
  return [
    `Order lifecycle: ${result.state}`,
    `Preview: ${result.previewId}`,
    `Account: ${result.account.maskedId}  Environment: ${result.account.environment}`,
    ...renderSafeOperation(result.operation),
    `Verified against preview: ${String(result.verifiedAgainstPreview)}`,
    `Quantity: ${String(result.filledQuantity)}/${String(result.quantity)}  Remaining: ${String(result.remainingQuantity)}`,
    `Limit: ${formatPrice(result.limitPrice)}  Average fill: ${formatPrice(result.averagePrice)}`,
    `Commission/fees: ${formatPrice(result.commissionAndFees)}`,
  ].join("\n");
}

function renderReconciliation(result: SafeReconciliationView): string {
  return [
    ...renderSafeOperation(result.operation),
    result.observation === null
      ? "Observation: unavailable"
      : `Observation: ${result.observation.status} @ ${result.observation.observedAt}  reason ${result.observation.reason}`,
  ].join("\n");
}

function renderTradingDiagnostics(result: SafeTradingDiagnosticsView): string {
  return [
    `Account: ${result.account.maskedId}  Environment: ${result.account.environment}  Verified: ${String(result.account.verified)}`,
    `Gateway state: ${result.gateway.state}`,
    `Authenticated: ${String(result.gateway.authenticated)}  Connected: ${String(result.gateway.connected)}  Competing session: ${String(result.gateway.competingSession)}`,
    `Read ready: ${String(result.gateway.readReady)}  New mutations ready: ${String(result.gateway.newMutationReady)}  Recovery ready: ${String(result.gateway.recoveryMutationReady)}  Lock owned: ${String(result.gateway.lockOwned)}`,
    `Market data: ${result.marketDataAvailable === null ? "unknown" : String(result.marketDataAvailable)}  Queue depth: ${String(result.queueDepth)}`,
    `Last tickle: ${result.timing.lastTickleAt ?? "unknown"}  Next renewal: ${result.timing.nextRenewalAt ?? "unknown"}  Last broker request: ${result.timing.lastBrokerRequestAt ?? "unknown"}`,
    `Pending warnings: ${String(result.pendingWarnings)}  Reconciliation required: ${String(result.reconciliationRequiredOperations)}`,
  ].join("\n");
}

function output<T>(
  value: T,
  json: boolean | undefined,
  render: (result: T) => string,
  log: (line: string) => void
): void {
  log(json === true ? JSON.stringify(value, null, 2) : render(value));
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
  broker: (override?: string) => BrokerName,
  dependencies: DerivativeCommandDependencies = {}
): void {
  const createResearchService = dependencies.createResearchService ?? service;
  const createPreviewService = dependencies.createPreviewService ?? previewService;
  const createExecutionService = dependencies.createExecutionService ?? executionService;
  const log = dependencies.log ?? console.log;

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
      await createResearchService(broker(options.broker))
    ).discover({
      ...seriesRequest(underlying, options),
      ...(options.strike !== undefined ? { strike: number(options.strike, "strike") } : {}),
      ...(options.right !== undefined ? { right: right(options.right) } : {}),
    });
    output(result, options.json, renderOptionDiscovery, log);
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
      await createResearchService(broker(options.broker))
    ).chain({
      ...seriesRequest(underlying, options),
      ...(options.right !== undefined ? { right: right(options.right) } : {}),
      ...(options.around !== undefined ? { around: number(options.around, "around strike") } : {}),
      strikes: integer(options.strikes, "Strike count"),
    });
    output(result, options.json, renderOptionChain, log);
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
      await createResearchService(broker(options.broker))
    ).quoteVertical({
      ...seriesRequest(underlying, options),
      kind: spreadKind(kindValue),
      longStrike: number(options.long, "long strike"),
      shortStrike: number(options.short, "short strike"),
      quantity,
      ...(options.limit !== undefined ? { limit: number(options.limit, "limit") } : {}),
    });
    output(result, options.json, renderVerticalSpread, log);
  });

  seriesOptions(
    spread
      .command("preview")
      .description("Run an explicit non-submitting vertical What-If")
      .argument("<kind>", "call-debit, call-credit, put-debit, or put-credit")
      .argument("<underlying>", "Underlying symbol")
      .requiredOption("--long <strike>", "Long-leg strike")
      .requiredOption("--short <strike>", "Short-leg strike")
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
      await createPreviewService(broker(options.broker))
    ).previewVertical({
      ...seriesRequest(underlying, options),
      kind: spreadKind(kindValue),
      longStrike: number(options.long, "long strike"),
      shortStrike: number(options.short, "short strike"),
      quantity,
      priceEffect,
      limit: number(limitValue, priceEffect.toLowerCase()),
      tif: tif(options.tif),
      session: session(options.session),
    });
    output(toSpreadPreviewView(result), options.json, renderSpreadPreview, log);
  });

  spread
    .command("submit")
    .description("Submit the exact, unexpired reviewed preview")
    .argument("<preview-id>", "Exact preview ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--operator <name>", "CME operator identity; defaults to HUSKLY_EXT_OPERATOR")
    .option("--confirm", "Confirm this order submission")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (previewId: string, options: ExecutionOptions) => {
      const confirm = confirmed(options.confirm);
      const extOperator = operator(options.operator);
      const result = await (
        await createExecutionService(broker(options.broker))
      ).submit({
        previewId,
        operator: extOperator,
        confirm,
      });
      output(toSubmissionView(result), options.json, renderSubmission, log);
    });

  spread
    .command("recover")
    .description("Recover a lost submission response for the exact preview")
    .argument("<preview-id>", "Exact preview ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (previewId: string, options: Omit<ExecutionOptions, "confirm" | "operator">) => {
      const result = await (
        await createExecutionService(broker(options.broker))
      ).recover({ previewId });
      output(toSubmissionView(result), options.json, renderSubmission, log);
    });
  program.addCommand(spread);

  const order = new Command("order").description("Inspect or manage guarded gateway operations");
  order
    .command("show")
    .argument("<operation-id>", "Gateway operation ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--json", "Emit a stable JSON DTO")
    .action(
      async (operationId: string, options: Omit<ExecutionOptions, "confirm" | "operator">) => {
        const result = await (
          await createExecutionService(broker(options.broker))
        ).getStatus(operationId);
        output(toLifecycleView(result), options.json, renderOrderLifecycle, log);
      }
    );
  order
    .command("watch")
    .argument("<operation-id>", "Gateway operation ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--timeout <seconds>", "Maximum watch duration", "300")
    .option("--poll <seconds>", "Polling interval", "2")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (operationId: string, options: WatchOptions) => {
      const result = await (
        await createExecutionService(broker(options.broker))
      ).watch({
        orderId: operationId,
        timeoutMs: number(options.timeout, "timeout") * 1000,
        pollMs: number(options.poll, "poll") * 1000,
      });
      output(toLifecycleView(result), options.json, renderOrderLifecycle, log);
    });
  order
    .command("acknowledge")
    .argument("<operation-id>", "Gateway operation ID")
    .requiredOption("--reply <reply-id>", "Exact pending warning reply ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--confirm", "Confirm this warning acknowledgment")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (operationId: string, options: AcknowledgeOptions) => {
      const confirm = confirmed(options.confirm);
      const result = await (
        await createExecutionService(broker(options.broker))
      ).acknowledgeWarning({
        operationId,
        replyId: options.reply,
        confirm,
      });
      output(toLifecycleView(result), options.json, renderOrderLifecycle, log);
    });
  order
    .command("reconcile")
    .argument("<operation-id>", "Gateway operation ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--confirm", "Confirm reconciliation")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (operationId: string, options: ExecutionOptions) => {
      confirmed(options.confirm);
      const result = await (
        await createExecutionService(broker(options.broker))
      ).reconcile(operationId);
      output(toReconciliationView(result), options.json, renderReconciliation, log);
    });
  order
    .command("cancel")
    .argument("<operation-id>", "Gateway operation ID")
    .option("--broker <name>", "Broker to use", "ibkr")
    .option("--confirm", "Confirm cancellation")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (operationId: string, options: ExecutionOptions) => {
      const confirm = confirmed(options.confirm);
      const result = await (
        await createExecutionService(broker(options.broker))
      ).cancel({
        orderId: operationId,
        confirm,
      });
      output(toLifecycleView(result), options.json, renderOrderLifecycle, log);
    });
  program.addCommand(order);

  const brokerCommand = new Command("broker").description("Broker diagnostics");
  brokerCommand
    .command("doctor")
    .description("Run gateway trading diagnostics")
    .option("--broker <name>", "Broker to use: schwab or ibkr", "ibkr")
    .option("--json", "Emit a stable JSON DTO")
    .action(async (options: { broker: string; json?: boolean }) => {
      const result = await (
        await createPreviewService(broker(options.broker))
      ).getTradingDiagnostics();
      output(toTradingDiagnosticsView(result), options.json, renderTradingDiagnostics, log);
    });
  program.addCommand(brokerCommand);
}
