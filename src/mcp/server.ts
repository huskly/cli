#!/usr/bin/env node
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import type { BrokerClient, BrokerName } from "#src/brokers/brokerClient.js";
import { registerGetQuoteTool } from "#src/mcp/tools/quote.js";
import { registerGetPositionsTool } from "#src/mcp/tools/positions.js";
import { registerSearchSymbolTool } from "#src/mcp/tools/searchSymbol.js";
import { registerGetPriceHistoryTool } from "#src/mcp/tools/priceHistory.js";
import { registerGetMoversTool } from "#src/mcp/tools/movers.js";
import { registerGetVixLevelTool } from "#src/mcp/tools/vix.js";
import { registerGetOptionChainTool } from "#src/mcp/tools/optionChain.js";
import { registerGetOptionExpiriesTool } from "#src/mcp/tools/optionExpiries.js";
import { registerPlaceOptionOrderTool } from "#src/mcp/tools/placeOptionOrder.js";
import {
  registerDerivativeTools,
  type DerivativeToolDependencies,
} from "#src/mcp/tools/derivatives.js";

export interface RegisteredMcpTool {
  definition: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
  };
  handler: { bivarianceHack(input: unknown): Promise<CallToolResult> }["bivarianceHack"];
}

export interface McpToolRegistrar {
  registerTool(
    name: string,
    definition: RegisteredMcpTool["definition"],
    handler: RegisteredMcpTool["handler"]
  ): void;
}

export interface McpServerDependencies extends DerivativeToolDependencies {
  readonly resolveBrokerClient?: (broker: BrokerName) => Promise<BrokerClient>;
  readonly createDerivativeTools?: DerivativeToolDependencies["createTools"];
}

export function registerMcpTools(
  server: McpToolRegistrar,
  dependencies: McpServerDependencies = {}
): void {
  registerGetQuoteTool(
    server as McpServer,
    dependencies.resolveBrokerClient === undefined
      ? {}
      : { resolveBrokerClient: dependencies.resolveBrokerClient }
  );
  registerGetPositionsTool(
    server as McpServer,
    dependencies.resolveBrokerClient === undefined
      ? {}
      : { resolveBrokerClient: dependencies.resolveBrokerClient }
  );
  registerSearchSymbolTool(
    server as McpServer,
    dependencies.resolveBrokerClient === undefined
      ? {}
      : { resolveBrokerClient: dependencies.resolveBrokerClient }
  );
  registerGetPriceHistoryTool(server as McpServer);
  registerGetMoversTool(server as McpServer);
  registerGetVixLevelTool(server as McpServer);
  registerGetOptionChainTool(server as McpServer);
  registerGetOptionExpiriesTool(server as McpServer);
  registerPlaceOptionOrderTool(server as McpServer);
  registerDerivativeTools(server, { ...dependencies, ...(dependencies.createDerivativeTools === undefined ? {} : { createTools: dependencies.createDerivativeTools }) });
}

export function createMcpServer(dependencies: McpServerDependencies = {}): McpServer {
  const server = new McpServer({ name: "huskly-cli-mcp", version: "1.0.0" });
  registerMcpTools(server, dependencies);
  return server;
}

export async function startMcpServer(
  dependencies: McpServerDependencies = {},
  transport: StdioServerTransport = new StdioServerTransport()
): Promise<void> {
  const server = createMcpServer(dependencies);
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
  await server.connect(transport);
  process.stdin.resume();
  await closed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startMcpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Fatal error starting huskly-cli-mcp:", message);
    process.exit(1);
  });
}
