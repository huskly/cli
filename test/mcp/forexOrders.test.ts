import assert from "node:assert/strict";
import test from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RegisteredMcpTool } from "../../src/mcp/tools/equityOrders.js";
import { registerForexOrderTools, type ForexTools } from "../../src/mcp/tools/forexOrders.js";
import type { PreviewForexOrderInput } from "../../src/forex/forexOrderService.js";

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
  const received: { preview: PreviewForexOrderInput[]; submit: unknown[] } = {
    preview: [],
    submit: [],
  };
  const value = {
    orders: {
      preview: (input: PreviewForexOrderInput) => {
        received.preview.push(input);
        return Promise.resolve({ previewId: "c".repeat(64), submitted: false });
      },
      submit: (input: unknown) => {
        received.submit.push(input);
        return Promise.resolve({ previewId: "c".repeat(64), recovered: false });
      },
    },
  } as unknown as ForexTools;
  return { received, create: () => Promise.resolve(value) };
}

test("fx tools register the same account-free inputs as the CLI", () => {
  const server = new FakeServer();
  registerForexOrderTools(server, { createForexTools: tools().create });
  assert.deepEqual([...server.tools.keys()], ["fx_order_preview", "fx_order_submit"]);
  assert.deepEqual(
    Object.keys(requiredTool(server, "fx_order_preview").definition.inputSchema as object),
    ["pair", "side", "quantity", "limit", "tif"]
  );
  assert.deepEqual(
    Object.keys(requiredTool(server, "fx_order_submit").definition.inputSchema as object),
    ["previewId", "operator", "confirm"]
  );
});

test("fx_order_preview passes the terms to the forex service", async () => {
  const server = new FakeServer();
  const fake = tools();
  registerForexOrderTools(server, { createForexTools: fake.create });
  const input = { pair: "USD.JPY", side: "BUY", quantity: 25000, limit: 147.25, tif: "DAY" };
  const result = await requiredTool(server, "fx_order_preview").handler(input);
  assert.equal(result.isError, undefined);
  assert.equal(body(result)["submitted"], false);
  assert.deepEqual(fake.received.preview, [input]);
});

test("fx_order_submit refuses an unconfirmed write", async () => {
  const server = new FakeServer();
  const fake = tools();
  registerForexOrderTools(server, { createForexTools: fake.create });
  const refused = await requiredTool(server, "fx_order_submit").handler({
    previewId: "c".repeat(64),
    operator: "alice",
    confirm: false,
  });
  assert.equal(refused.isError, true);
  assert.deepEqual(fake.received.submit, []);
  await requiredTool(server, "fx_order_submit").handler({
    previewId: "c".repeat(64),
    operator: "alice",
    confirm: true,
  });
  assert.deepEqual(fake.received.submit, [
    { previewId: "c".repeat(64), operator: "alice", confirm: true },
  ]);
});
