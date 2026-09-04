import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { BrokerClient, BrokerName } from "#src/brokers/brokerClient.js";
import { z } from "zod";
import { mcpBrokerClient, resolveToolBroker } from "#src/mcp/defaultBroker.js";
import { observationResult, runTool } from "#src/mcp/toolResult.js";

export interface QuoteToolDependencies {
  readonly resolveBrokerClient?: (broker: BrokerName) => Promise<BrokerClient>;
}

export function createGetQuoteHandler(
  dependencies: QuoteToolDependencies = {}
): (input: { symbols: string[]; broker?: "schwab" | "ibkr" | undefined }) => Promise<CallToolResult> {
  return async ({ symbols, broker }) =>
    runTool(async () => {
      const resolvedBroker = resolveToolBroker(broker);
      const api = await (dependencies.resolveBrokerClient ?? mcpBrokerClient)(resolvedBroker);
      const quoteObservation = await api.getQuotes(symbols);
      const quotes = quoteObservation.value;

      const results = symbols.map((symbol) => {
        const quote = quotes[symbol] ?? quotes[symbol.toUpperCase()];
        if (!quote) {
          return { symbol, error: `No quote data available for ${symbol}` };
        }
        const q = quote.quote;
        return {
          symbol: quote.symbol,
          description: quote.reference.description,
          exchange: quote.reference.exchangeName ?? quote.reference.exchange,
          lastPrice: q.mark ?? q.lastPrice,
          change: q.netChange,
          percentChange: q.netPercentChange,
          bid: q.bidPrice,
          ask: q.askPrice,
          open: q.openPrice,
          high: q.highPrice,
          low: q.lowPrice,
          previousClose: q.closePrice,
          volume: q.totalVolume,
          week52High: q["52WeekHigh"],
          week52Low: q["52WeekLow"],
        };
      });

      return observationResult(quoteObservation, { broker: resolvedBroker, quotes: results });
    });
}

export function registerGetQuoteTool(server: McpServer, dependencies: QuoteToolDependencies = {}): void {
  server.registerTool(
    "get_quote",
    {
      title: "Get stock quote",
      description:
        "Get current price quotes (last price, bid/ask, day range, volume, 52-week range) for one or more stock symbols. Works with either Schwab or IBKR.",
      inputSchema: {
        symbols: z
          .array(z.string())
          .min(1)
          .describe('Stock ticker symbols to quote, e.g. ["MSFT", "AAPL"]'),
        broker: z
          .enum(["schwab", "ibkr"])
          .optional()
          .describe(
            "Broker to fetch the quote from. Defaults to the server's configured default broker (schwab unless HUSKLY_MCP_DEFAULT_BROKER is set)."
          ),
      },
    },
    createGetQuoteHandler(dependencies)
  );
}
