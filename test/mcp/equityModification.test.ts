import assert from "node:assert/strict";
import test from "node:test";
import { registerEquityOrderTools, type RegisteredMcpTool } from "#src/mcp/tools/equityOrders.js";
import type { EquityModificationDto } from "#src/equities/equityOrderModification.js";
const expected = {
  modificationId: "mod-1",
  orderId: "1234",
  ownerOperationId: null,
  state: "accepted",
  before: {
    symbol: "AAPL",
    conid: 1,
    side: "BUY",
    orderType: "LMT",
    limit: 250,
    stopPrice: null,
    quantity: 10,
    filledQuantity: 0,
    tif: "DAY",
    session: "REGULAR",
  },
  requested: { limit: 251 },
  submitted: null,
  reconciliation: null,
  result: null,
  createdAt: "now",
  latestTransitionAt: "now",
  acknowledgedWarnings: 0,
} as EquityModificationDto;
const unusedModification = {
  get: () => Promise.resolve(expected),
  reconcile: () => Promise.resolve(expected),
  decline: () => Promise.resolve(expected),
};

test("modify_equity_order accepts account-free changes and returns the same safe DTO", async () => {
  const tools = new Map<string, RegisteredMcpTool>();
  let input: unknown;
  registerEquityOrderTools(
    {
      registerTool(name, definition, handler) {
        tools.set(name, { definition, handler });
      },
    },
    {
      createEquityTools: () =>
        Promise.resolve({
          orders: {
            preview: (() => {
              throw Error("unused");
            }) as never,
            submit: (() => {
              throw Error("unused");
            }) as never,
          },
          modification: {
            ...unusedModification,
            modify: (value) => {
              input = value;
              return Promise.resolve(expected);
            },
          },
        }),
    }
  );
  const tool = tools.get("modify_equity_order");
  assert.ok(tool);
  assert.deepEqual(Object.keys(tool.definition.inputSchema as object), [
    "orderId",
    "limit",
    "stopPrice",
    "quantity",
    "tif",
    "operator",
    "confirm",
  ]);
  const result = await tool.handler({
    orderId: "1234",
    limit: 251,
    operator: "alice",
    confirm: true,
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(input, {
    orderId: "1234",
    changes: { limit: 251 },
    operator: "alice",
    confirm: true,
  });
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), expected);
  const invalid = await tool.handler({
    orderId: "1234",
    limit: 251,
    operator: "alice",
    confirm: false,
  });
  assert.equal(invalid.isError, true);
});

test("get and reconcile modification tools return state and require confirmation", async () => {
  const tools = new Map<string, RegisteredMcpTool>();
  const calls: string[] = [];
  registerEquityOrderTools(
    {
      registerTool(name, definition, handler) {
        tools.set(name, { definition, handler });
      },
    },
    {
      createEquityTools: () =>
        Promise.resolve({
          orders: {
            preview: (() => {
              throw Error("unused");
            }) as never,
            submit: (() => {
              throw Error("unused");
            }) as never,
          },
          modification: {
            ...unusedModification,
            modify: (() => {
              throw Error("unused");
            }) as never,
            get: async (id) => {
              await Promise.resolve();
              calls.push(`get:${id}`);
              return expected;
            },
            reconcile: async (id, confirm) => {
              await Promise.resolve();
              calls.push(`reconcile:${id}:${String(confirm)}`);
              return { ...expected, state: "not_applied" };
            },
          },
        }),
    }
  );
  const get = tools.get("get_order_modification");
  const reconcile = tools.get("reconcile_order_modification");
  assert.ok(get && reconcile);
  const read = await get.handler({ modificationId: "mod-1" });
  assert.equal(
    (JSON.parse((read.content[0] as { text: string }).text) as EquityModificationDto)
      .modificationId,
    "mod-1"
  );
  const invalid = await reconcile.handler({ modificationId: "mod-1", confirm: false });
  assert.equal(invalid.isError, true);
  const resolved = await reconcile.handler({ modificationId: "mod-1", confirm: true });
  assert.equal(
    (JSON.parse((resolved.content[0] as { text: string }).text) as EquityModificationDto).state,
    "not_applied"
  );
  assert.deepEqual(calls, ["get:mod-1", "reconcile:mod-1:true"]);
});
