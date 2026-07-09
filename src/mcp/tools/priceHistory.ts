import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiClient } from "#src/cli/shared.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";

export function registerGetPriceHistoryTool(server: McpServer): void {
  server.registerTool(
    "get_price_history",
    {
      title: "Get historical daily price candles",
      description:
        'Get daily OHLCV price history for a symbol going back a number of days. Always uses Schwab (the only broker with historical data available); ignores broker selection. Convert natural-language ranges to a day count before calling, e.g. "1 month" -> 30, "6 months" -> 180, "1 year"/"12 months" -> 365.',
      inputSchema: {
        symbol: z.string().describe('Stock ticker symbol, e.g. "AAPL"'),
        days: z
          .number()
          .int()
          .positive()
          .default(90)
          .describe("Number of calendar days of history to return, counting back from today"),
      },
    },
    async ({ symbol, days }) =>
      runTool(async () => {
        const api = await apiClient();
        const candles = await api.getPriceHistory({ symbol, days });
        return jsonResult({
          broker: "schwab",
          symbol,
          days,
          candles: candles.map((c) => ({
            date: new Date(c.datetime).toISOString().split("T")[0] ?? "",
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
        });
      })
  );
}
