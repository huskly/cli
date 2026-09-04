import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { brokerClient } from "#src/cli/shared.js";
import { resolveToolBroker } from "#src/mcp/defaultBroker.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";
import type { BrokerInstrumentSearchProjection } from "#src/brokers/brokerClient.js";

const IBKR_PROJECTIONS: BrokerInstrumentSearchProjection[] = ["symbol-search", "search"];

export function registerSearchSymbolTool(server: McpServer): void {
  server.registerTool(
    "search_symbol",
    {
      title: "Search for a stock symbol",
      description:
        "Look up ticker symbols or companies by name or description fragment. Useful when the user names a company but you need its ticker symbol.",
      inputSchema: {
        query: z.string().describe("Symbol or company name/description fragment to search for"),
        projection: z
          .enum([
            "symbol-search",
            "symbol-regex",
            "desc-search",
            "desc-regex",
            "search",
            "fundamental",
          ])
          .optional()
          .default("symbol-search")
          .describe(
            "Search mode. IBKR only supports symbol-search/search. 'fundamental' also returns fundamentals (Schwab only)."
          ),
        broker: z
          .enum(["schwab", "ibkr"])
          .optional()
          .describe("Broker to search with. Defaults to the server's configured default broker."),
      },
    },
    async ({ query, projection, broker }) =>
      runTool(async () => {
        const resolvedBroker = resolveToolBroker(broker);
        if (resolvedBroker === "ibkr" && !IBKR_PROJECTIONS.includes(projection)) {
          throw new Error(
            `IBKR search currently supports only symbol-search/search projections (got '${projection}').`
          );
        }
        const api = await brokerClient(resolvedBroker);
        const observation = await api.searchInstruments(query, projection);
        return jsonResult({ broker: resolvedBroker, query, projection, observedAt: observation.observedAt, completeness: observation.completeness, instruments: observation.value });
      })
  );
}
