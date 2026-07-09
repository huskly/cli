#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetQuoteTool } from "#src/mcp/tools/quote.js";
import { registerSearchSymbolTool } from "#src/mcp/tools/searchSymbol.js";
import { registerGetPriceHistoryTool } from "#src/mcp/tools/priceHistory.js";
import { registerGetMoversTool } from "#src/mcp/tools/movers.js";
import { registerGetVixLevelTool } from "#src/mcp/tools/vix.js";
import { registerGetOptionChainTool } from "#src/mcp/tools/optionChain.js";
import { registerGetOptionExpiriesTool } from "#src/mcp/tools/optionExpiries.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "huskly-cli-mcp", version: "1.0.0" });

  registerGetQuoteTool(server);
  registerSearchSymbolTool(server);
  registerGetPriceHistoryTool(server);
  registerGetMoversTool(server);
  registerGetVixLevelTool(server);
  registerGetOptionChainTool(server);
  registerGetOptionExpiriesTool(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Fatal error starting huskly-cli-mcp:", message);
  process.exit(1);
});
