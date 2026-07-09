import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDays, format, parse } from "date-fns";
import { apiClient } from "#src/cli/shared.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";

export function registerGetOptionChainTool(server: McpServer): void {
  server.registerTool(
    "get_option_chain",
    {
      title: "Get an option chain",
      description:
        "Get calls and puts (symbol/bid/ask/mid/delta) for a symbol at a given expiration date, optionally filtered around a strike price. Always uses Schwab. Omit expiry to use the nearest upcoming expiration. The returned symbol/strike/expiry/putCall are the exact inputs place_option_order needs.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol"),
        expiry: z
          .string()
          .optional()
          .describe("Expiration date (YYYY-MM-DD); defaults to the nearest upcoming expiry"),
        around: z
          .number()
          .optional()
          .describe(
            "Strike price to center the returned strikes around; defaults to the current stock price"
          ),
        strikes: z
          .number()
          .int()
          .positive()
          .default(10)
          .describe("Number of strikes to include above and below the center strike"),
      },
    },
    async ({ symbol, expiry: expiryArg, around, strikes }) =>
      runTool(async () => {
        const api = await apiClient();
        let expiry: Date;
        if (expiryArg) {
          expiry = parse(expiryArg, "yyyy-MM-dd", new Date());
        } else {
          const defaultDaysAhead = 30;
          const [exp] = await api.getAvailableExpiries(
            symbol,
            "PUT",
            format(new Date(), "yyyy-MM-dd"),
            format(addDays(new Date(), defaultDaysAhead), "yyyy-MM-dd")
          );
          if (!exp) throw new Error(`No expiries available for ${symbol}`);
          expiry = exp;
        }

        const [chain, quotes] = await Promise.all([
          api.getOptionChain(symbol, expiry),
          api.getQuotes([symbol]),
        ]);

        if (chain.length === 0) {
          throw new Error(`No options found for ${symbol} ${format(expiry, "yyyy-MM-dd")}`);
        }

        const quoteData = quotes[symbol];
        const currentPrice = quoteData?.quote.mark ?? quoteData?.quote.lastPrice;
        const aroundStrike = around ?? currentPrice;

        const allStrikes = Array.from(new Set(chain.map((o) => o.strike))).sort((a, b) => a - b);
        let strikesToInclude: Set<number>;
        if (aroundStrike !== undefined) {
          const closestIdx = allStrikes.reduce(
            (bestIdx, strike, idx) =>
              Math.abs(strike - aroundStrike) < Math.abs((allStrikes[bestIdx] ?? 0) - aroundStrike)
                ? idx
                : bestIdx,
            0
          );
          const startIdx = Math.max(0, closestIdx - strikes);
          const endIdx = Math.min(allStrikes.length, closestIdx + strikes + 1);
          strikesToInclude = new Set(allStrikes.slice(startIdx, endIdx));
        } else {
          strikesToInclude = new Set(allStrikes);
        }

        const filtered = chain.filter((o) => strikesToInclude.has(o.strike));

        return jsonResult({
          broker: "schwab",
          symbol,
          expiry: format(expiry, "yyyy-MM-dd"),
          currentPrice,
          options: filtered.map((o) => ({
            symbol: o.symbol,
            strike: o.strike,
            type: o.isCall ? "CALL" : "PUT",
            bid: o.bid,
            ask: o.ask,
            mid: o.mid,
            delta: o.delta,
          })),
        });
      })
  );
}
