import assert from "node:assert/strict";
import test from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { BrokerClient } from "#src/brokers/brokerClient.js";
import { observe } from "#src/brokers/brokerClient.js";
import { registerMcpTools, type RegisteredMcpTool } from "#src/mcp/server.js";

class FakeServer {
  readonly tools = new Map<string, RegisteredMcpTool>();

  registerTool(
    name: string,
    definition: RegisteredMcpTool["definition"],
    handler: RegisteredMcpTool["handler"]
  ): void {
    this.tools.set(name, { definition, handler });
  }
}

function parse(result: CallToolResult) {
  const first = result.content[0] as { type: "text"; text: string } | undefined;
  assert.ok(first);
  return JSON.parse(first.text) as Record<string, unknown>;
}

function requiredTool(server: FakeServer, name: string): RegisteredMcpTool {
  const tool = server.tools.get(name);
  assert.ok(tool, `expected tool ${name}`);
  return tool;
}

const unavailableBroker: BrokerClient = {
  getAccountBalances: () =>
    Promise.resolve(
      observe(
        {
          liquidationValue: null,
          cashBalance: null,
          availableFunds: null,
          buyingPower: null,
          equity: null,
        },
        "unavailable",
        "2026-09-04T00:00:00.000Z"
      )
    ),
  getPositions: () => Promise.resolve(observe([], "unavailable", "2026-09-04T00:00:00.000Z")),
  getQuotes: () => Promise.resolve(observe({}, "unavailable", "2026-09-04T00:00:00.000Z")),
  searchInstruments: () => Promise.resolve(observe([], "unavailable", "2026-09-04T00:00:00.000Z")),
  fetchTransactionHistory: () =>
    Promise.resolve(observe([], "unavailable", "2026-09-04T00:00:00.000Z")),
  fetchOrders: () => Promise.resolve(observe([], "unavailable", "2026-09-04T00:00:00.000Z")),
};

void test("server exports registration seams so tests can call MCP handlers without stdio", async () => {
  const server = new FakeServer();
  registerMcpTools(server, {
    resolveBrokerClient: () => Promise.resolve(unavailableBroker),
    createDerivativeTools: () => Promise.reject(new Error("not used")),
  });

  assert.ok(server.tools.has("get_quote"));
  assert.ok(server.tools.has("get_positions"));
  assert.ok(server.tools.has("search_symbol"));
  assert.ok(server.tools.has("place_option_order"));
  assert.ok(server.tools.has("recover_option_spread_order"));
  assert.ok(server.tools.has("reconcile_order_operation"));

  const quote = await requiredTool(server, "get_quote").handler({ symbols: ["SPY"], broker: "ibkr" });
  assert.equal(quote.isError, true);
  assert.deepEqual(parse(quote), {
    broker: "ibkr",
    quotes: [{ symbol: "SPY", error: "No quote data available for SPY" }],
    observedAt: "2026-09-04T00:00:00.000Z",
    completeness: "unavailable",
    warnings: ["Broker data is unavailable."],
  });
});

void test("shared read tools keep gateway evidence and preserve partial payloads", async () => {
  const partialBroker: BrokerClient = {
    ...unavailableBroker,
    getQuotes: () =>
      Promise.resolve(
        observe(
          {
            SPY: {
              symbol: "SPY",
              reference: {
                description: "SPDR S&P 500 ETF",
                exchange: "ARCA",
                exchangeName: "NYSE Arca",
              },
              quote: {
                mark: 640.12,
                lastPrice: null,
                netChange: 1.5,
                netPercentChange: 0.2,
                bidPrice: 640.1,
                askPrice: 640.14,
                openPrice: 638,
                highPrice: 641,
                lowPrice: 637.5,
                closePrice: 638.62,
                totalVolume: 1000,
                "52WeekHigh": 650,
                "52WeekLow": 500,
              },
            },
          },
          "partial",
          "2026-09-04T00:00:00.000Z"
        )
      ),
    getPositions: () =>
      Promise.resolve(
        observe(
          [
            {
              instrument: { symbol: "SPY", assetType: "ETF" },
              longQuantity: 2,
              shortQuantity: 0,
              averagePrice: 630,
              marketValue: 1280,
              currentDayProfitLoss: 10,
              longOpenProfitLoss: 20,
              shortOpenProfitLoss: 0,
            },
          ],
          "partial",
          "2026-09-04T00:00:00.000Z"
        )
      ),
    searchInstruments: () =>
      Promise.resolve(
        observe(
          [
            {
              symbol: "SPY",
              description: "SPDR S&P 500 ETF",
              exchange: "ARCA",
              assetType: "ETF",
              brokerId: "1",
            },
          ],
          "partial",
          "2026-09-04T00:00:00.000Z"
        )
      ),
  };

  const server = new FakeServer();
  registerMcpTools(server, {
    resolveBrokerClient: () => Promise.resolve(partialBroker),
    createDerivativeTools: () => Promise.reject(new Error("not used")),
  });

  const quote = await requiredTool(server, "get_quote").handler({ symbols: ["SPY"], broker: "ibkr" });
  assert.deepEqual(parse(quote), {
    broker: "ibkr",
    quotes: [
      {
        symbol: "SPY",
        description: "SPDR S&P 500 ETF",
        exchange: "NYSE Arca",
        lastPrice: 640.12,
        change: 1.5,
        percentChange: 0.2,
        bid: 640.1,
        ask: 640.14,
        open: 638,
        high: 641,
        low: 637.5,
        previousClose: 638.62,
        volume: 1000,
        week52High: 650,
        week52Low: 500,
      },
    ],
    observedAt: "2026-09-04T00:00:00.000Z",
    completeness: "partial",
    warnings: ["Broker data is partial."],
  });

  const positions = await requiredTool(server, "get_positions").handler({ broker: "ibkr" });
  assert.equal(positions.isError, undefined);
  const positionsBody = parse(positions);
  assert.equal(positionsBody["completeness"], "partial");
  assert.deepEqual(positionsBody["warnings"], ["Broker data is partial."]);

  const search = await requiredTool(server, "search_symbol").handler({
    query: "spy",
    projection: "search",
    broker: "ibkr",
  });
  assert.equal(search.isError, undefined);
  const searchBody = parse(search);
  assert.equal(searchBody["completeness"], "partial");
  assert.deepEqual(searchBody["warnings"], ["Broker data is partial."]);
});
