import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createGatewayMutationApi,
  GatewayMutationAdapter,
} from "#src/gateway/gatewayMutationAdapter.js";
import { mcpGatewayTransport, type GatewayTransport } from "#src/gateway/gatewayTransport.js";
import { DerivativeResearchService } from "#src/derivatives/derivativeResearch.js";
import {
  DerivativePreviewService,
  FilePreviewStore,
  type PreviewStore,
} from "#src/derivatives/derivativePreviewService.js";
import {
  DerivativeExecutionService,
  FileExecutionStateStore,
  type ExecutionStateStore,
} from "#src/derivatives/derivativeExecutionService.js";
import {
  createIbkrGatewayDerivativeReadApi,
  IbkrDerivativeAdapter,
} from "#src/derivatives/ibkrDerivativeAdapter.js";
import { observationResult, jsonResult, runTool } from "#src/mcp/toolResult.js";

const assetClass = z.enum(["OPT", "FOP"]);
const spreadKind = z.enum(["call-debit", "call-credit", "put-debit", "put-credit"]);
const series = {
  assetClass,
  underlying: z.string().min(1),
  expiration: z.iso.date(),
  tradingClass: z.string().min(1).optional(),
  exchange: z.string().min(1).optional(),
};
const confirmed = z.literal(true).describe("Must be exactly true for this broker write");

function exactSeries(input: {
  assetClass: "OPT" | "FOP";
  underlying: string;
  expiration: string;
  tradingClass?: string | undefined;
  exchange?: string | undefined;
}) {
  return {
    assetClass: input.assetClass,
    underlying: input.underlying.toUpperCase(),
    expiration: input.expiration,
    ...(input.tradingClass !== undefined ? { tradingClass: input.tradingClass.toUpperCase() } : {}),
    ...(input.exchange !== undefined ? { exchange: input.exchange.toUpperCase() } : {}),
  };
}

interface ChainToolInput {
  assetClass: "OPT" | "FOP";
  underlying: string;
  expiration: string;
  tradingClass?: string | undefined;
  exchange?: string | undefined;
  right?: "CALL" | "PUT" | undefined;
  around?: number | undefined;
  strikes: number;
}

interface QuoteSpreadToolInput {
  assetClass: "OPT" | "FOP";
  underlying: string;
  expiration: string;
  tradingClass?: string | undefined;
  exchange?: string | undefined;
  kind: "call-debit" | "call-credit" | "put-debit" | "put-credit";
  longStrike: number;
  shortStrike: number;
  quantity: number;
  limit?: number | undefined;
}

interface PreviewSpreadToolInput {
  assetClass: "OPT" | "FOP";
  underlying: string;
  expiration: string;
  tradingClass?: string | undefined;
  exchange?: string | undefined;
  kind: "call-debit" | "call-credit" | "put-debit" | "put-credit";
  longStrike: number;
  shortStrike: number;
  quantity: number;
  priceEffect: "CREDIT" | "DEBIT";
  limit: number;
  tif: "DAY" | "GTC";
  session: "REGULAR" | "OVERNIGHT";
}

interface SubmitSpreadToolInput {
  previewId: string;
  operator: string;
  confirm: true;
}

interface RecoverSpreadToolInput {
  previewId: string;
}

interface AcknowledgeWarningToolInput {
  operationId: string;
  replyId: string;
  confirm: true;
}

interface OperationToolInput {
  operationId: string;
}

interface ReconcileToolInput {
  operationId: string;
  confirm: true;
}

interface CancelToolInput {
  operationId: string;
  confirm: true;
  timeoutMs: number;
  pollMs: number;
}

export interface McpToolRegistrar {
  registerTool(
    name: string,
    definition: RegisteredMcpTool["definition"],
    handler: RegisteredMcpTool["handler"]
  ): void;
}

export interface RegisteredMcpTool {
  definition: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
  };
  handler: { bivarianceHack(input: unknown): Promise<CallToolResult> }["bivarianceHack"];
}

export interface DerivativeTools {
  research: Pick<DerivativeResearchService, "chain" | "quoteVertical">;
  preview: Pick<DerivativePreviewService, "previewVertical">;
  execution: Pick<
    DerivativeExecutionService,
    "submit" | "recover" | "acknowledgeWarning" | "getStatus" | "reconcile" | "cancel"
  >;
}

export interface DerivativeToolDependencies {
  readonly createTools?: () => Promise<DerivativeTools>;
  readonly resolveGatewayTransport?: () => Promise<GatewayTransport>;
  readonly previewStore?: PreviewStore;
  readonly executionStateStore?: ExecutionStateStore;
  readonly now?: () => Date;
  readonly previewTtlMs?: number;
  readonly delay?: (ms: number) => Promise<void>;
  readonly key?: () => string;
}

let toolsPromise: Promise<DerivativeTools> | undefined;

export async function createDerivativeTools(
  dependencies: DerivativeToolDependencies = {}
): Promise<DerivativeTools> {
  const transport = await (dependencies.resolveGatewayTransport ?? mcpGatewayTransport)();
  const discovery = new IbkrDerivativeAdapter(createIbkrGatewayDerivativeReadApi(transport));
  const mutation = new GatewayMutationAdapter(createGatewayMutationApi(transport));
  const preview = new DerivativePreviewService(
    discovery,
    {
      getTradingDiagnostics: () => discovery.getTradingDiagnostics(),
      previewDerivativeCombo: (request) =>
        mutation.preview({
          ...request,
          legs: [
            { contract: request.legs[0].contract, ratio: 1 },
            { contract: request.legs[1].contract, ratio: -1 },
          ],
          orderType: "LMT",
        }),
    },
    dependencies.now ?? (() => new Date()),
    dependencies.previewTtlMs ?? 5 * 60 * 1000,
    dependencies.previewStore ?? new FilePreviewStore()
  );
  return {
    research: new DerivativeResearchService(discovery),
    preview,
    execution: new DerivativeExecutionService(
      discovery,
      {
        getTradingDiagnostics: () => discovery.getTradingDiagnostics(),
        previewDerivativeCombo: (request) =>
          mutation.preview({
            ...request,
            legs: [
              { contract: request.legs[0].contract, ratio: 1 },
              { contract: request.legs[1].contract, ratio: -1 },
            ],
            orderType: "LMT",
          }),
      },
      mutation,
      preview,
      dependencies.executionStateStore ?? new FileExecutionStateStore(),
      dependencies.now ?? (() => new Date()),
      dependencies.delay,
      undefined,
      dependencies.key
    ),
  };
}

async function derivativeTools(
  dependencies: DerivativeToolDependencies = {}
): Promise<DerivativeTools> {
  if (dependencies.createTools !== undefined) {
    return dependencies.createTools();
  }
  toolsPromise ??= createDerivativeTools(dependencies).catch((error: unknown) => {
    toolsPromise = undefined;
    throw error;
  });
  return toolsPromise;
}

function chainResult(
  chain: Awaited<ReturnType<DerivativeResearchService["chain"]>>
): CallToolResult {
  return observationResult(chain.quotes, {
    referenceQuote: chain.referenceQuote,
    center: chain.center,
    quotes: chain.quotes.value,
  });
}

function verticalQuoteResult(
  result: Awaited<ReturnType<DerivativeResearchService["quoteVertical"]>>
): CallToolResult {
  return observationResult(result.referenceQuote, {
    referenceQuote: result.referenceQuote.value,
    spread: result.spread,
    pricingNotice: result.pricingNotice,
  });
}

export function registerDerivativeTools(
  server: McpToolRegistrar,
  dependencies: DerivativeToolDependencies = {}
): void {
  server.registerTool(
    "get_derivative_chain",
    {
      title: "Get an exact derivative chain",
      description:
        "Resolve and quote an IBKR option or futures-option series. Broker references are opaque and non-durable.",
      inputSchema: {
        ...series,
        right: z.enum(["CALL", "PUT"]).optional(),
        around: z.number().optional(),
        strikes: z.number().int().nonnegative().default(10),
      },
    },
    async (input: ChainToolInput) =>
      runTool(async () =>
        chainResult(
          await (
            await derivativeTools(dependencies)
          ).research.chain({
            ...exactSeries(input),
            ...(input.right !== undefined ? { right: input.right } : {}),
            ...(input.around !== undefined ? { around: input.around } : {}),
            strikes: input.strikes,
          })
        )
      )
  );

  server.registerTool(
    "quote_option_spread",
    {
      title: "Quote a vertical option spread",
      description:
        "Research a vertical from individual IBKR leg markets. This is not an executable combo preview.",
      inputSchema: {
        ...series,
        kind: spreadKind,
        longStrike: z.number().positive(),
        shortStrike: z.number().positive(),
        quantity: z.number().int().positive().default(1),
        limit: z.number().positive().optional(),
      },
    },
    async (input: QuoteSpreadToolInput) =>
      runTool(async () =>
        verticalQuoteResult(
          await (
            await derivativeTools(dependencies)
          ).research.quoteVertical({
            ...exactSeries(input),
            kind: input.kind,
            longStrike: input.longStrike,
            shortStrike: input.shortStrike,
            quantity: input.quantity,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          })
        )
      )
  );

  server.registerTool(
    "preview_option_spread_order",
    {
      title: "Preview an IBKR vertical spread order",
      description:
        "Run a non-submitting IBKR What-If and persist a short-lived exact preview ID. No order is submitted.",
      inputSchema: {
        ...series,
        kind: spreadKind,
        longStrike: z.number().positive(),
        shortStrike: z.number().positive(),
        quantity: z.number().int().positive().default(1),
        priceEffect: z.enum(["CREDIT", "DEBIT"]),
        limit: z.number().positive(),
        tif: z.enum(["DAY", "GTC"]).default("DAY"),
        session: z.enum(["REGULAR", "OVERNIGHT"]).default("REGULAR"),
      },
    },
    async (input: PreviewSpreadToolInput) =>
      runTool(async () =>
        jsonResult(
          await (
            await derivativeTools(dependencies)
          ).preview.previewVertical({
            ...exactSeries(input),
            kind: input.kind,
            longStrike: input.longStrike,
            shortStrike: input.shortStrike,
            quantity: input.quantity,
            priceEffect: input.priceEffect,
            limit: input.limit,
            tif: input.tif,
            session: input.session,
          })
        )
      )
  );

  server.registerTool(
    "submit_option_spread_order",
    {
      title: "Submit an exact reviewed IBKR spread preview",
      description:
        "Submit only an unexpired preview after environment and contract revalidation. Live execution also requires the process allowlist policy.",
      inputSchema: {
        previewId: z.string().regex(/^[a-f0-9]{64}$/),
        operator: z.string().min(1).describe("CME operator identity"),
        confirm: confirmed,
      },
    },
    async (input: SubmitSpreadToolInput) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools(dependencies)).execution.submit(input))
      )
  );

  server.registerTool(
    "recover_option_spread_order",
    {
      title: "Recover a lost IBKR spread submission response",
      description:
        "Lookup the durable gateway order operation for one exact preview after a lost submission response.",
      inputSchema: {
        previewId: z.string().regex(/^[a-f0-9]{64}$/),
      },
    },
    async (input: RecoverSpreadToolInput) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools(dependencies)).execution.recover(input))
      )
  );

  server.registerTool(
    "acknowledge_order_warning",
    {
      title: "Acknowledge a known IBKR order warning",
      description:
        "Continue one exact warning reply for one exact gateway operation. Unknown warning IDs fail closed.",
      inputSchema: {
        operationId: z.string().min(1),
        replyId: z.string().min(1),
        confirm: confirmed,
      },
    },
    async (input: AcknowledgeWarningToolInput) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools(dependencies)).execution.acknowledgeWarning(input))
      )
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get guarded IBKR derivative order status",
      description:
        "Fetch fresh lifecycle state and verify the gateway operation against its persisted exact preview.",
      inputSchema: { operationId: z.string().min(1) },
    },
    async ({ operationId }: OperationToolInput) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools(dependencies)).execution.getStatus(operationId))
      )
  );

  server.registerTool(
    "reconcile_order_operation",
    {
      title: "Reconcile a gateway order operation",
      description: "Run explicit gateway reconciliation for one operation ID.",
      inputSchema: {
        operationId: z.string().min(1),
        confirm: confirmed,
      },
    },
    async ({ operationId }: ReconcileToolInput) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools(dependencies)).execution.reconcile(operationId))
      )
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel a guarded IBKR derivative order",
      description:
        "Request cancellation, then poll until a verified CANCELED state. Other terminal states are returned as errors.",
      inputSchema: {
        operationId: z.string().min(1),
        confirm: confirmed,
        timeoutMs: z.number().int().positive().max(900_000).default(300_000),
        pollMs: z.number().int().positive().max(30_000).default(2_000),
      },
    },
    async (input: CancelToolInput) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools(dependencies)).execution.cancel(input))
      )
  );
}
