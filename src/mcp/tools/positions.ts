import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { brokerClient } from "#src/cli/shared.js";
import { resolveToolBroker } from "#src/mcp/defaultBroker.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";
import { parseOccSymbol } from "#src/helpers.js";

export function registerGetPositionsTool(server: McpServer): void {
  server.registerTool(
    "get_positions",
    {
      title: "Get account positions",
      description:
        "Get the current logged-in user's account positions (holdings), " +
        "including quantity, average price, market value, and P/L. " +
        "Works with either Schwab or IBKR.",
      inputSchema: {
        symbol: z.string().optional().describe("Optional symbol to filter positions by"),
        type: z.string().optional().describe("Optional asset type filter, e.g. EQUITY or OPTION"),
        broker: z
          .enum(["schwab", "ibkr"])
          .optional()
          .describe(
            "Broker to fetch positions from. Defaults to the server's configured default broker (schwab unless HUSKLY_MCP_DEFAULT_BROKER is set)."
          ),
      },
    },
    async ({ symbol, type, broker }) =>
      runTool(async () => {
        const resolvedBroker = resolveToolBroker(broker);
        const api = await brokerClient(resolvedBroker);
        const positionObservation = await api.getPositions(symbol);
        let positions = positionObservation.value;

        if (type) {
          const upperType = type.toUpperCase();
          positions = positions.filter((pos) => pos.instrument.assetType === upperType);
        }

        const results = positions.map((pos) => {
          const assetType = pos.instrument.assetType;
          const isOption = assetType === "OPTION";
          const contractMultiplier = isOption ? 100 : 1;
          const symbolLabel = isOption
            ? parseOccSymbol(pos.instrument.symbol)
            : pos.instrument.symbol;
          const quantity =
            pos.longQuantity !== null && pos.longQuantity > 0 ? pos.longQuantity : pos.shortQuantity;
          const currentPrice =
            quantity !== null && quantity !== 0 && pos.marketValue !== null
              ? Math.abs(pos.marketValue / quantity / contractMultiplier)
              : null;
          const openProfitLoss =
            pos.longQuantity !== null && pos.longQuantity > 0
              ? pos.longOpenProfitLoss
              : pos.shortOpenProfitLoss;
          const costBasis =
            pos.averagePrice !== null && quantity !== null
              ? pos.averagePrice * quantity * contractMultiplier
              : null;
          const openProfitLossPercent =
            costBasis !== null && costBasis !== 0 && openProfitLoss !== null
              ? (openProfitLoss / costBasis) * 100
              : null;

          return {
            symbol: symbolLabel,
            assetType,
            longQuantity: pos.longQuantity,
            shortQuantity: pos.shortQuantity,
            averagePrice: pos.averagePrice,
            currentPrice,
            marketValue: pos.marketValue,
            currentDayProfitLoss: pos.currentDayProfitLoss,
            openProfitLoss,
            openProfitLossPercent,
          };
        });

        return jsonResult({ broker: resolvedBroker, positions: results });
      })
  );
}
