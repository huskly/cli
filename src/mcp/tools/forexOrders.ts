import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ForexGatewayAdapter } from "#src/forex/forexGatewayAdapter.js";
import {
  FileForexPreviewStore,
  FileForexSubmissionStore,
  ForexOrderService,
  type ForexPreviewStore,
  type ForexSubmissionStore,
} from "#src/forex/forexOrderService.js";
import { createGatewayMutationApi } from "#src/gateway/gatewayMutationAdapter.js";
import { mcpGatewayTransport, type GatewayTransport } from "#src/gateway/gatewayTransport.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";
import type { McpToolRegistrar } from "./equityOrders.js";

export interface ForexTools {
  readonly orders: Pick<ForexOrderService, "preview" | "submit">;
}

export interface ForexToolDependencies {
  readonly createForexTools?: () => Promise<ForexTools>;
  readonly resolveGatewayTransport?: () => Promise<GatewayTransport>;
  readonly forexPreviewStore?: ForexPreviewStore;
  readonly forexSubmissionStore?: ForexSubmissionStore;
  readonly now?: () => Date;
  readonly previewTtlMs?: number;
  readonly nonce?: () => string;
  readonly key?: () => string;
}

let toolsPromise: Promise<ForexTools> | undefined;

export async function createForexTools(
  dependencies: ForexToolDependencies = {}
): Promise<ForexTools> {
  const transport = await (dependencies.resolveGatewayTransport ?? mcpGatewayTransport)();
  return {
    orders: new ForexOrderService({
      gateway: new ForexGatewayAdapter(createGatewayMutationApi(transport)),
      previews: dependencies.forexPreviewStore ?? new FileForexPreviewStore(),
      submissions: dependencies.forexSubmissionStore ?? new FileForexSubmissionStore(),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.previewTtlMs === undefined ? {} : { ttlMs: dependencies.previewTtlMs }),
      ...(dependencies.nonce === undefined ? {} : { nonce: dependencies.nonce }),
      ...(dependencies.key === undefined ? {} : { key: dependencies.key }),
    }),
  };
}

async function forexTools(dependencies: ForexToolDependencies): Promise<ForexTools> {
  if (dependencies.createForexTools !== undefined) return dependencies.createForexTools();
  toolsPromise ??= createForexTools(dependencies).catch((error: unknown) => {
    toolsPromise = undefined;
    throw error;
  });
  return toolsPromise;
}

interface PreviewToolInput {
  readonly pair: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly limit: number;
  readonly tif: "DAY" | "GTC";
}

interface SubmitToolInput {
  readonly previewId: string;
  readonly operator: string;
  readonly confirm: boolean;
}

/** Register `fx_order_preview` and `fx_order_submit`, the MCP twins of `fx preview` and `fx submit`. */
export function registerForexOrderTools(
  server: McpToolRegistrar,
  dependencies: ForexToolDependencies = {}
): void {
  server.registerTool(
    "fx_order_preview",
    {
      title: "Preview an IBKR spot FX order",
      description:
        "Resolve one exact IDEALPRO currency pair and run an IBKR What-If preview for a LIMIT order. " +
        "This never submits an order. The returned preview ID expires after a short time. " +
        "The quantity is whole base-currency units, and the limit is the quote-currency price of one base unit. " +
        "IBKR checks the price increment and the minimum size; a small order can route as an odd lot, and the preview then shows the IBKR warning.",
      inputSchema: {
        pair: z.string().min(6).max(7).describe("Currency pair: USD.JPY, USD/JPY, or USDJPY"),
        side: z.enum(["BUY", "SELL"]).describe("BUY or SELL the base currency"),
        quantity: z
          .number()
          .int()
          .positive()
          .describe("Whole base-currency units, for example 25000 for 25,000 USD"),
        limit: z.number().positive().describe("Quote-currency price of one base unit"),
        tif: z.enum(["DAY", "GTC"]).default("DAY"),
      },
    },
    async (input: PreviewToolInput): Promise<CallToolResult> =>
      runTool(async () => jsonResult(await (await forexTools(dependencies)).orders.preview(input)))
  );

  server.registerTool(
    "fx_order_submit",
    {
      title: "Submit a previewed IBKR spot FX order",
      description:
        "Submit only the immutable terms in a valid FX preview. This places a real order in the preview-bound IBKR environment. Use operation tools for warnings, status, reconciliation, and cancellation.",
      inputSchema: {
        previewId: z.string().regex(/^[a-f0-9]{64}$/),
        operator: z.string().min(1).max(64),
        confirm: z.literal(true).describe("Must be exactly true for this broker write"),
      },
    },
    async (input: SubmitToolInput): Promise<CallToolResult> =>
      runTool(async () => {
        if (!input.confirm) throw new Error("Confirmation must be exactly true");
        return jsonResult(await (await forexTools(dependencies)).orders.submit(input));
      })
  );
}
