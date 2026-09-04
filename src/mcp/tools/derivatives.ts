import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  derivativeDiscoveryClient,
  derivativeExecutionClient,
  derivativePreviewClient,
} from "#src/derivatives/derivativeClient.js";
import { DerivativeResearchService } from "#src/derivatives/derivativeResearch.js";
import {
  DerivativePreviewService,
  FilePreviewStore,
} from "#src/derivatives/derivativePreviewService.js";
import {
  DerivativeExecutionService,
  FileExecutionStateStore,
} from "#src/derivatives/derivativeExecutionService.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";

const assetClass = z.enum(["OPT", "FOP"]);
const spreadKind = z.enum(["call-debit", "call-credit", "put-debit", "put-credit"]);
const series = {
  assetClass,
  underlying: z.string().min(1),
  expiration: z.iso.date(),
  tradingClass: z.string().min(1).optional(),
  exchange: z.string().min(1).optional(),
};
const account = z.string().min(1).describe("Exact IBKR account ID; never returned unmasked");
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

interface DerivativeTools {
  research: DerivativeResearchService;
  preview: DerivativePreviewService;
  execution: DerivativeExecutionService;
}

let toolsPromise: Promise<DerivativeTools> | undefined;

async function derivativeTools(): Promise<DerivativeTools> {
  toolsPromise ??= (async () => {
    const [discovery, previewClient, executionClient] = await Promise.all([
      derivativeDiscoveryClient("ibkr"),
      derivativePreviewClient("ibkr"),
      derivativeExecutionClient("ibkr"),
    ]);
    const preview = new DerivativePreviewService(
      discovery,
      previewClient,
      () => new Date(),
      5 * 60 * 1000,
      new FilePreviewStore()
    );
    return {
      research: new DerivativeResearchService(discovery),
      preview,
      execution: new DerivativeExecutionService(
        discovery,
        previewClient,
        executionClient,
        preview,
        new FileExecutionStateStore()
      ),
    };
  })();
  return toolsPromise;
}

export function registerDerivativeTools(server: McpServer): void {
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
    async (input) =>
      runTool(async () =>
        jsonResult(
          await (
            await derivativeTools()
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
    async (input) =>
      runTool(async () =>
        jsonResult(
          await (
            await derivativeTools()
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
    async (input) =>
      runTool(async () =>
        jsonResult(
          await (
            await derivativeTools()
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
        "Submit only an unexpired preview after account, environment, and contract revalidation. Live execution also requires the process allowlist policy.",
      inputSchema: {
        previewId: z.string().regex(/^[a-f0-9]{64}$/),
        accountId: account,
        operator: z.string().min(1).describe("CME operator identity"),
        confirm: confirmed,
      },
    },
    async (input) =>
      runTool(async () => jsonResult(await (await derivativeTools()).execution.submit(input)))
  );

  server.registerTool(
    "acknowledge_order_warning",
    {
      title: "Acknowledge a known IBKR order warning",
      description:
        "Continue one exact warning reply for one exact preview. Unknown warning IDs fail closed.",
      inputSchema: {
        previewId: z.string().regex(/^[a-f0-9]{64}$/),
        replyId: z.string().min(1),
        accountId: account,
        confirm: confirmed,
      },
    },
    async (input) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools()).execution.acknowledgeWarning(input))
      )
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get guarded IBKR derivative order status",
      description:
        "Fetch fresh lifecycle state and verify the broker order against its persisted exact preview.",
      inputSchema: { orderId: z.string().min(1), accountId: account },
    },
    async ({ orderId, accountId }) =>
      runTool(async () =>
        jsonResult(await (await derivativeTools()).execution.getStatus(orderId, accountId))
      )
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel a guarded IBKR derivative order",
      description:
        "Request cancellation, then poll until a verified CANCELED state. Other terminal states are returned as errors.",
      inputSchema: {
        orderId: z.string().min(1),
        accountId: account,
        operator: z.string().min(1).describe("CME operator identity"),
        confirm: confirmed,
        timeoutMs: z.number().int().positive().max(900_000).default(300_000),
        pollMs: z.number().int().positive().max(30_000).default(2_000),
      },
    },
    async (input) =>
      runTool(async () => jsonResult(await (await derivativeTools()).execution.cancel(input)))
  );
}
