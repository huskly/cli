import assert from "node:assert/strict";
import test from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { observe } from "#src/brokers/brokerClient.js";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import { observationResult, runTool } from "#src/mcp/toolResult.js";

function parse(result: CallToolResult) {
  const first = result.content[0] as { type: "text"; text: string } | undefined;
  assert.ok(first);
  return JSON.parse(first.text) as Record<string, unknown>;
}

void test("observation results keep explicit evidence and preserve partial reads", () => {
  const result = observationResult(
    observe([{ symbol: "SPY" }], "partial", "2026-09-04T00:00:00.000Z"),
    { broker: "ibkr", quotes: [{ symbol: "SPY" }] }
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(parse(result), {
    broker: "ibkr",
    quotes: [{ symbol: "SPY" }],
    observedAt: "2026-09-04T00:00:00.000Z",
    completeness: "partial",
    warnings: ["Broker data is partial."],
  });
});

void test("unavailable observations become safe MCP errors", () => {
  const result = observationResult(observe([], "unavailable", "2026-09-04T00:00:00.000Z"), {
    broker: "ibkr",
    positions: [],
  });

  assert.equal(result.isError, true);
  assert.deepEqual(parse(result), {
    broker: "ibkr",
    positions: [],
    observedAt: "2026-09-04T00:00:00.000Z",
    completeness: "unavailable",
    warnings: ["Broker data is unavailable."],
  });
});

void test("runTool redacts read-only authorization failures", async () => {
  const result = await runTool(() =>
    Promise.reject(
      new ConsumerError({
        code: "authorization_failure",
        operation: "createOrderOperation",
        message: "acct U123 secret body should not leak",
        status: 403,
        gatewayCode: "forbidden",
        retryAfterSeconds: undefined,
      })
    )
  );

  assert.equal(result.isError, true);
  assert.deepEqual(parse(result), {
    error: {
      code: "authorization_failure",
      operation: "createOrderOperation",
      message: "Gateway authorization failed. The MCP credential may be read-only for this operation.",
    },
  });
});
