import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiClient } from "#src/cli/shared.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";

export function registerGetMoversTool(server: McpServer): void {
  server.registerTool(
    "get_movers",
    {
      title: "Get top market movers for an index",
      description:
        "Get the top 10 movers (by volume, trade count, or percent change) for a market index. Always uses Schwab.",
      inputSchema: {
        index: z
          .enum([
            "$DJI",
            "$COMPX",
            "$SPX",
            "NYSE",
            "NASDAQ",
            "OTCBB",
            "INDEX_ALL",
            "EQUITY_ALL",
            "OPTION_ALL",
            "OPTION_PUT",
            "OPTION_CALL",
          ])
          .describe("Index symbol to get movers for"),
        sort: z
          .enum(["VOLUME", "TRADES", "PERCENT_CHANGE_UP", "PERCENT_CHANGE_DOWN"])
          .optional()
          .describe("Sort order; defaults to the API's default"),
        frequency: z
          .union([
            z.literal(0),
            z.literal(1),
            z.literal(5),
            z.literal(10),
            z.literal(30),
            z.literal(60),
          ])
          .optional()
          .describe("Minutes of trading frequency to consider"),
      },
    },
    async ({ index, sort, frequency }) =>
      runTool(async () => {
        const api = await apiClient();
        const response = await api.getMovers(index, sort, frequency);
        return jsonResult({
          broker: "schwab",
          index,
          sort,
          frequency,
          movers: response.screeners ?? [],
        });
      })
  );
}
