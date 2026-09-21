import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { EquityGatewayAdapter } from "#src/equities/equityGatewayAdapter.js";
import {
  EquityOrderService,
  FileEquityPreviewStore,
  FileEquitySubmissionStore,
  normalizeEquityOrderTerms,
  type EquityPreviewStore,
  type EquitySubmissionStore,
} from "#src/equities/equityOrderService.js";
import { createGatewayMutationApi } from "#src/gateway/gatewayMutationAdapter.js";
import { mcpGatewayTransport, type GatewayTransport } from "#src/gateway/gatewayTransport.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";
export interface RegisteredMcpTool {
  readonly definition: {
    readonly title?: string;
    readonly description?: string;
    readonly inputSchema?: unknown;
  };
  readonly handler: { bivarianceHack(input: unknown): Promise<CallToolResult> }["bivarianceHack"];
}
export interface McpToolRegistrar {
  registerTool(
    name: string,
    definition: RegisteredMcpTool["definition"],
    handler: RegisteredMcpTool["handler"]
  ): void;
}

export interface EquityTools {
  readonly orders: Pick<EquityOrderService, "preview" | "submit">;
}

export interface EquityToolDependencies {
  readonly createEquityTools?: () => Promise<EquityTools>;
  readonly resolveGatewayTransport?: () => Promise<GatewayTransport>;
  readonly equityPreviewStore?: EquityPreviewStore;
  readonly equitySubmissionStore?: EquitySubmissionStore;
  readonly now?: () => Date;
  readonly previewTtlMs?: number;
  readonly nonce?: () => string;
  readonly key?: () => string;
}

let toolsPromise: Promise<EquityTools> | undefined;

export async function createEquityTools(
  dependencies: EquityToolDependencies = {}
): Promise<EquityTools> {
  const transport = await (dependencies.resolveGatewayTransport ?? mcpGatewayTransport)();
  const gateway = new EquityGatewayAdapter(createGatewayMutationApi(transport));
  return {
    orders: new EquityOrderService(
      gateway,
      dependencies.equityPreviewStore ?? new FileEquityPreviewStore(),
      dependencies.equitySubmissionStore ?? new FileEquitySubmissionStore(),
      dependencies.now,
      dependencies.previewTtlMs,
      dependencies.nonce,
      dependencies.key
    ),
  };
}

async function equityTools(dependencies: EquityToolDependencies): Promise<EquityTools> {
  if (dependencies.createEquityTools !== undefined) return dependencies.createEquityTools();
  toolsPromise ??= createEquityTools(dependencies).catch((error: unknown) => {
    toolsPromise = undefined;
    throw error;
  });
  return toolsPromise;
}

interface PreviewToolInput {
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly orderType?: "LIMIT" | "STOP";
  readonly limit?: number;
  readonly stopPrice?: number;
  readonly tif: "DAY" | "GTC";
  readonly session: "REGULAR" | "OVERNIGHT";
}

interface SubmitToolInput {
  readonly previewId: string;
  readonly operator: string;
  readonly confirm: boolean;
}

export function registerEquityOrderTools(
  server: McpToolRegistrar,
  dependencies: EquityToolDependencies = {}
): void {
  server.registerTool(
    "preview_equity_order",
    {
      title: "Preview an IBKR equity order",
      description:
        "Resolve one exact US-listed stock or ETF and run an IBKR What-If preview. " +
        "This never submits an order. The returned preview ID expires after a short time. " +
        "STOP is a native stop-market order, not stop-limit.",
      inputSchema: {
        symbol: z.string().min(1).max(32).describe("US stock or ETF symbol"),
        side: z.enum(["BUY", "SELL"]),
        quantity: z.number().int().positive().describe("Whole shares only"),
        orderType: z
          .enum(["LIMIT", "STOP"])
          .default("LIMIT")
          .describe("LIMIT or STOP (default LIMIT)"),
        limit: z.number().positive().optional().describe("Limit price (required for LIMIT)"),
        stopPrice: z
          .number()
          .positive()
          .optional()
          .describe("Stop price (required for STOP, native stop-market)"),
        tif: z.enum(["DAY", "GTC"]).default("DAY"),
        session: z.enum(["REGULAR", "OVERNIGHT"]).default("REGULAR"),
      },
    },
    async (input: PreviewToolInput): Promise<CallToolResult> =>
      runTool(async () => {
        const terms = normalizeEquityOrderTerms(input);
        return jsonResult(
          await (
            await equityTools(dependencies)
          ).orders.preview({
            symbol: input.symbol,
            side: input.side,
            quantity: input.quantity,
            ...terms,
            tif: input.tif,
            session: input.session,
          })
        );
      })
  );

  server.registerTool(
    "submit_equity_order",
    {
      title: "Submit a previewed IBKR equity order",
      description:
        "Submit only the immutable terms in a valid preview. This places a real order in the preview-bound IBKR environment. Use operation tools for warnings, status, reconciliation, and cancellation.",
      inputSchema: {
        previewId: z.string().regex(/^[a-f0-9]{64}$/),
        operator: z.string().min(1).max(64),
        confirm: z.literal(true).describe("Must be exactly true for this broker write"),
      },
    },
    async (input: SubmitToolInput): Promise<CallToolResult> =>
      runTool(async () => {
        if (!input.confirm) throw new Error("Confirmation must be exactly true");
        return jsonResult(await (await equityTools(dependencies)).orders.submit(input));
      })
  );
}
