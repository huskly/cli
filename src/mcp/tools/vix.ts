import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiClient } from "#src/cli/shared.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";

export function registerGetVixLevelTool(server: McpServer): void {
  server.registerTool(
    "get_vix_level",
    {
      title: "Get the current VIX level",
      description:
        "Get the current CBOE Volatility Index (VIX) level, a measure of market fear/volatility. Always uses Schwab.",
    },
    async () =>
      runTool(async () => {
        const api = await apiClient();
        const vix = await api.getVixLevel();
        return jsonResult({ broker: "schwab", vix: vix ?? null });
      })
  );
}
