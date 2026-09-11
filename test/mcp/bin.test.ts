import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

void test("the MCP package binary starts the stdio server through its dedicated launcher", async () => {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8")) as {
    bin: Record<string, string>;
  };
  assert.equal(manifest.bin["huskly-cli-mcp"], "./dist/mcp/bin.js");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=tsx", "--import", "tsx", "src/mcp/bin.ts"],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "mcp-bin-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === "get_quote"));
  } finally {
    await client.close().catch(() => undefined);
  }
});
