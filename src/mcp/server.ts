#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetQuoteTool } from "#src/mcp/tools/quote.js";
import { registerGetPositionsTool } from "#src/mcp/tools/positions.js";
import { registerSearchSymbolTool } from "#src/mcp/tools/searchSymbol.js";
import { registerGetPriceHistoryTool } from "#src/mcp/tools/priceHistory.js";
import { registerGetMoversTool } from "#src/mcp/tools/movers.js";
import { registerGetVixLevelTool } from "#src/mcp/tools/vix.js";
import { registerGetOptionChainTool } from "#src/mcp/tools/optionChain.js";
import { registerGetOptionExpiriesTool } from "#src/mcp/tools/optionExpiries.js";
import { registerPlaceOptionOrderTool } from "#src/mcp/tools/placeOptionOrder.js";
import { registerDerivativeTools } from "#src/mcp/tools/derivatives.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "huskly-cli-mcp", version: "1.0.0" });

  registerGetQuoteTool(server);
  registerGetPositionsTool(server);
  registerSearchSymbolTool(server);
  registerGetPriceHistoryTool(server);
  registerGetMoversTool(server);
  registerGetVixLevelTool(server);
  registerGetOptionChainTool(server);
  registerGetOptionExpiriesTool(server);
  registerPlaceOptionOrderTool(server);
  registerDerivativeTools(server);

  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
  await server.connect(transport);
  process.stdin.resume();
  await closed;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Fatal error starting huskly-cli-mcp:", message);
  process.exit(1);
});
