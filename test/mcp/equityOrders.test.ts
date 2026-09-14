import assert from "node:assert/strict";
import test from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConsumerError } from "../../src/gateway/gatewayErrors.js";
import {
  registerEquityOrderTools,
  type EquityTools,
  type RegisteredMcpTool,
} from "../../src/mcp/tools/equityOrders.js";

class FakeServer {
  public readonly tools = new Map<string, RegisteredMcpTool>();
  public registerTool(
    name: string,
    definition: RegisteredMcpTool["definition"],
    handler: RegisteredMcpTool["handler"]
  ): void {
    this.tools.set(name, { definition, handler });
  }
}

function requiredTool(server: FakeServer, name: string): RegisteredMcpTool {
  const tool = server.tools.get(name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

function body(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0] as { readonly text: string };
  return JSON.parse(content.text) as Record<string, unknown>;
}

function tools() {
  const calls = { initialize: 0, preview: 0, submit: 0 };
  const value: EquityTools = {
    orders: {
      preview: async (input) => {
        await Promise.resolve();
        calls.preview += 1;
        return {
          previewId: "a".repeat(64),
          createdAt: "2026-09-14T12:00:00.000Z",
          expiresAt: "2026-09-14T12:05:00.000Z",
          environment: "paper",
          order: {
            contract: {
              conid: 8314,
              assetClass: "STK",
              symbol: input.symbol.toUpperCase(),
              exchange: "SMART",
              primaryExchange: "NASDAQ",
              currency: "USD",
            },
            side: input.side,
            quantity: input.quantity,
            tif: input.tif ?? "DAY",
            session: input.session ?? "REGULAR",
            orderType: "LMT",
            limit: input.limit,
          },
          whatIf: {
            accepted: true,
            submitted: false,
            commission: null,
            initialMargin: null,
            maintenanceMargin: null,
            warnings: [],
            rejectionReasons: [],
            advisoryAssetPermissions: [],
          },
          submitted: false,
        };
      },
      submit: async (input) => {
        await Promise.resolve();
        calls.submit += 1;
        return {
          previewId: input.previewId,
          environment: "paper",
          order: {
            contract: {
              conid: 8314,
              assetClass: "STK",
              symbol: "IBIT",
              exchange: "SMART",
              primaryExchange: "NASDAQ",
              currency: "USD",
            },
            side: "BUY",
            quantity: 2,
            tif: "DAY",
            session: "REGULAR",
            orderType: "LMT",
            limit: 52.25,
          },
          operation: { operationId: "operation-1", kind: "single" } as never,
          recovered: false,
        };
      },
    },
  };
  return {
    calls,
    create: () => {
      calls.initialize += 1;
      return Promise.resolve(value);
    },
  };
}

test("equity tools register only the approved account-free inputs", () => {
  const server = new FakeServer();
  registerEquityOrderTools(server);
  assert.deepEqual([...server.tools.keys()], ["preview_equity_order", "submit_equity_order"]);
  const preview = server.tools.get("preview_equity_order");
  const submit = server.tools.get("submit_equity_order");
  assert.ok(preview && submit);
  assert.deepEqual(Object.keys(preview.definition.inputSchema as object), [
    "symbol",
    "side",
    "quantity",
    "limit",
    "tif",
    "session",
  ]);
  assert.deepEqual(Object.keys(submit.definition.inputSchema as object), [
    "previewId",
    "operator",
    "confirm",
  ]);
  const schemaText = JSON.stringify([preview.definition, submit.definition]);
  assert.equal(schemaText.includes("accountId"), false);
  assert.equal(schemaText.includes("conid"), false);
  assert.match(preview.definition.description ?? "", /never submits/u);
});

test("preview never submits and returns an expiring immutable preview", async () => {
  const fake = tools();
  const server = new FakeServer();
  registerEquityOrderTools(server, { createEquityTools: fake.create });
  const result = await requiredTool(server, "preview_equity_order").handler({
    symbol: "ibit",
    side: "BUY",
    quantity: 2,
    limit: 52.25,
    tif: "DAY",
    session: "REGULAR",
  });
  const parsed = body(result);
  assert.equal(result.isError, undefined);
  assert.equal(parsed["submitted"], false);
  assert.equal(typeof parsed["expiresAt"], "string");
  assert.equal(fake.calls.preview, 1);
  assert.equal(fake.calls.submit, 0);
});

test("false confirmation fails before service initialization", async () => {
  const fake = tools();
  const server = new FakeServer();
  registerEquityOrderTools(server, { createEquityTools: fake.create });
  const result = await requiredTool(server, "submit_equity_order").handler({
    previewId: "a".repeat(64),
    operator: "operator-7",
    confirm: false,
  });
  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /exactly true/u);
  assert.deepEqual(fake.calls, { initialize: 0, preview: 0, submit: 0 });
});

test("submission returns warning and recovery states without changing preview terms", async () => {
  for (const state of ["warning_pending", "reconciliation_required"] as const) {
    const fake = tools();
    const baseCreate = fake.create;
    const server = new FakeServer();
    registerEquityOrderTools(server, {
      createEquityTools: async () => {
        const value = await baseCreate();
        value.orders.submit = async (input) => {
          await Promise.resolve();
          return {
            previewId: input.previewId,
            environment: "paper",
            order: {
              contract: {
                conid: 8314,
                assetClass: "STK",
                symbol: "IBIT",
                exchange: "SMART",
                primaryExchange: "NASDAQ",
                currency: "USD",
              },
              side: "SELL",
              quantity: 3,
              tif: "GTC",
              session: "OVERNIGHT",
              orderType: "LMT",
              limit: 51,
            },
            operation: { operationId: "operation-1", kind: "single", state } as never,
            recovered: false,
          };
        };
        return value;
      },
    });
    const result = await requiredTool(server, "submit_equity_order").handler({
      previewId: "a".repeat(64),
      operator: "operator-7",
      confirm: true,
    });
    assert.equal(result.isError, undefined);
    assert.equal((body(result)["operation"] as { state: string }).state, state);
  }
});

test("gateway errors stay bounded and redact provider text", async () => {
  const server = new FakeServer();
  registerEquityOrderTools(server, {
    createEquityTools: () =>
      Promise.resolve({
        orders: {
          preview: async () => {
            await Promise.resolve();
            throw new ConsumerError({
              code: "broker_data_unavailable",
              operation: "resolveEquityContract",
              message: "RAW-PROVIDER-SECRET",
              status: 503,
              gatewayCode: "broker_unavailable",
              retryAfterSeconds: undefined,
            });
          },
          submit: async () => {
            await Promise.resolve();
            throw new Error("unused");
          },
        },
      }),
  });
  const result = await requiredTool(server, "preview_equity_order").handler({
    symbol: "IBIT",
    side: "BUY",
    quantity: 2,
    limit: 52.25,
    tif: "DAY",
    session: "REGULAR",
  });
  const source = JSON.stringify(result);
  assert.equal(result.isError, true);
  assert.equal(source.includes("RAW-PROVIDER-SECRET"), false);
  assert.match(source, /Broker data is unavailable/u);
});
