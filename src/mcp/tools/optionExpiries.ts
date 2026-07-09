import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDays, format } from "date-fns";
import { apiClient } from "#src/cli/shared.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";

export function registerGetOptionExpiriesTool(server: McpServer): void {
  server.registerTool(
    "get_option_expiries",
    {
      title: "List available option expiration dates",
      description:
        "List upcoming option expiration dates for a symbol, with days-to-expiry for each. Always uses Schwab.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol"),
        type: z
          .enum(["PUT", "CALL"])
          .optional()
          .default("PUT")
          .describe("Contract type to check expiries for"),
        from: z.string().optional().describe("Start date (YYYY-MM-DD), defaults to today"),
        to: z.string().optional().describe("End date (YYYY-MM-DD), defaults to 90 days from today"),
      },
    },
    async ({ symbol, type, from, to }) =>
      runTool(async () => {
        const defaultDaysAhead = 90;
        const fromDate = from ?? format(new Date(), "yyyy-MM-dd");
        const toDate = to ?? format(addDays(new Date(), defaultDaysAhead), "yyyy-MM-dd");
        const api = await apiClient();
        const expiries = await api.getAvailableExpiries(symbol, type, fromDate, toDate);
        const today = new Date();
        return jsonResult({
          broker: "schwab",
          symbol,
          type,
          expiries: expiries.map((expiry) => ({
            date: format(expiry, "yyyy-MM-dd"),
            daysToExpiry: Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
          })),
        });
      })
  );
}
