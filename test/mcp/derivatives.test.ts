import assert from "node:assert/strict";
import test from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import {
  registerDerivativeTools,
  type DerivativeTools,
  type RegisteredMcpTool,
} from "#src/mcp/tools/derivatives.js";

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
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

function fakeTools() {
  const calls = {
    chain: 0,
    quoteVertical: 0,
    preview: 0,
    submit: 0,
    recover: 0,
    acknowledge: 0,
    getStatus: 0,
    reconcile: 0,
    cancel: 0,
  };

  const research = {
    chain: () => {
      calls.chain += 1;
      return Promise.resolve({
        referenceQuote: null,
        center: 27864.25,
        quotes: {
          observedAt: "2026-09-04T00:00:00.000Z",
          completeness: "partial",
          value: [
            {
              contract: {
                identity: {
                  assetClass: "FOP",
                  underlying: "NQ",
                  expiration: "2026-08-21",
                  strike: 26600,
                  right: "PUT",
                  tradingClass: "QN3",
                  exchange: "CME",
                  multiplier: 20,
                },
                brokerReference: { broker: "ibkr", contractId: "892767774" },
              },
              dataAvailability: "delayed",
              timestamp: null,
              bid: null,
              ask: null,
              last: 383,
              mark: null,
              delta: -0.257,
              impliedVolatility: null,
              volume: 237,
              openInterest: 50,
            },
          ],
        },
      });
    },
    quoteVertical: () => {
      calls.quoteVertical += 1;
      return Promise.resolve({
        referenceQuote: {
          observedAt: "2026-09-04T00:00:00.000Z",
          completeness: "partial",
          value: {
            brokerReference: { broker: "ibkr", contractId: "770561204" },
            symbol: "NQ",
            dataAvailability: "live",
            timestamp: null,
            bid: 27865,
            ask: 27866.5,
            last: 27865.5,
            mark: 27864.25,
          },
        },
        spread: {
          width: 200,
          naturalPrice: 39,
          midpointPrice: 40,
          requestedLimit: 39,
          limitSatisfied: true,
          quantity: 1,
          cashFlow: { effect: "CREDIT", perSpread: 39, gross: 780 },
          maxProfit: 780,
          maxLoss: 3220,
          breakEven: 26561,
          warnings: [],
        },
        pricingNotice:
          "Natural and midpoint prices are synthesized from individual leg markets; they are not a broker combo NBBO or executable preview.",
      });
    },
  };

  const preview = {
    previewVertical: () => {
      calls.preview += 1;
      return Promise.resolve({
        previewId: "a".repeat(64),
        createdAt: "2026-09-04T00:00:00.000Z",
        expiresAt: "2026-09-04T00:05:00.000Z",
        account: { maskedId: "U***567", environment: "paper" },
        order: {
          kind: "put-credit",
          gateway: {
            legs: [],
            quantity: 1,
            tif: "DAY",
            session: "REGULAR",
            priceEffect: "CREDIT",
            orderType: "LMT",
            limit: 39,
          },
          legs: [],
          quantity: 1,
          priceEffect: "CREDIT",
          limit: 39,
          tif: "DAY",
          session: "REGULAR",
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
      });
    },
  };

  const execution = {
    submit: (input: { previewId: string }) => {
      calls.submit += 1;
      return Promise.resolve({
        previewId: input.previewId,
        operationId: "op-1",
        orderId: "777",
        state: "accepted",
        operation: {
          operationId: "op-1",
          state: "accepted",
          result: { kind: "accepted", orders: [{ orderId: "777" }], warningCount: 0 },
          latestTransitionAt: "2026-09-04T00:00:01.000Z",
        },
        account: { maskedId: "****", environment: "paper" },
        updatedAt: "2026-09-04T00:00:01.000Z",
        warnings: [],
        rejectionReasons: [],
      });
    },
    recover: ({ previewId }: { previewId: string }) => {
      calls.recover += 1;
      return Promise.resolve({
        previewId,
        operationId: "op-1",
        state: "accepted",
        operation: {
          operationId: "op-1",
          state: "accepted",
          result: { kind: "accepted", orders: [], warningCount: 0 },
          latestTransitionAt: "2026-09-04T00:00:01.000Z",
        },
        account: { maskedId: "****", environment: "paper" },
        updatedAt: "2026-09-04T00:00:01.000Z",
        warnings: [],
        rejectionReasons: [],
      });
    },
    acknowledgeWarning: ({ operationId, replyId }: { operationId: string; replyId: string }) => {
      calls.acknowledge += 1;
      return Promise.resolve({
        operationId,
        previewId: "a".repeat(64),
        state: "accepted",
        operation: {
          operationId,
          state: "accepted",
          result: { kind: "accepted", orders: [], warningCount: 0 },
          latestTransitionAt: "2026-09-04T00:00:01.000Z",
        },
        account: { maskedId: "****", environment: "paper" },
        verifiedAgainstPreview: true,
        warnings: [{ replyId, messages: [], messageIds: [], known: true }],
        rejectionReasons: [],
        orderId: "777",
        clientOrderId: "",
        status: "WORKING",
        quantity: 1,
        filledQuantity: 0,
        remainingQuantity: 1,
        averagePrice: null,
        limitPrice: -39,
        commissionAndFees: null,
        legs: [],
        updatedAt: "2026-09-04T00:00:01.000Z",
      });
    },
    getStatus: (operationId: string) => {
      calls.getStatus += 1;
      return Promise.resolve({
        operationId,
        previewId: "a".repeat(64),
        state: "accepted",
        operation: {
          operationId,
          state: "accepted",
          result: { kind: "accepted", orders: [], warningCount: 0 },
          latestTransitionAt: "2026-09-04T00:00:01.000Z",
        },
        account: { maskedId: "****", environment: "paper" },
        verifiedAgainstPreview: true,
        warnings: [],
        rejectionReasons: [],
        orderId: "777",
        clientOrderId: "",
        status: "WORKING",
        quantity: 1,
        filledQuantity: 0,
        remainingQuantity: 1,
        averagePrice: null,
        limitPrice: -39,
        commissionAndFees: null,
        legs: [],
        updatedAt: "2026-09-04T00:00:01.000Z",
      });
    },
    reconcile: (operationId: string) => {
      calls.reconcile += 1;
      return Promise.resolve({ operation: { operationId, state: "accepted" }, observation: null });
    },
    cancel: ({ operationId }: { operationId: string }) => {
      calls.cancel += 1;
      return Promise.resolve({
        operationId,
        previewId: "a".repeat(64),
        state: "accepted",
        operation: {
          operationId,
          state: "cancelled",
          result: { kind: "accepted", orders: [], warningCount: 0 },
          latestTransitionAt: "2026-09-04T00:00:02.000Z",
        },
        account: { maskedId: "****", environment: "paper" },
        verifiedAgainstPreview: true,
        warnings: [],
        rejectionReasons: [],
        orderId: "777",
        clientOrderId: "",
        status: "CANCELED",
        quantity: 1,
        filledQuantity: 0,
        remainingQuantity: 0,
        averagePrice: null,
        limitPrice: -39,
        commissionAndFees: null,
        legs: [],
        updatedAt: "2026-09-04T00:00:02.000Z",
      });
    },
  };

  return {
    calls,
    tools: {
      research: research as unknown as DerivativeTools["research"],
      preview: preview as unknown as DerivativeTools["preview"],
      execution: execution as unknown as DerivativeTools["execution"],
    },
  };
}

void test("derivative tool registration removes account inputs and adds recovery plus reconciliation", async () => {
  const { calls, tools } = fakeTools();
  const server = new FakeServer();
  registerDerivativeTools(server, { createTools: () => Promise.resolve(tools) });

  assert.ok(server.tools.has("recover_option_spread_order"));
  assert.ok(server.tools.has("reconcile_order_operation"));
  const submitSchema = requiredTool(server, "submit_option_spread_order").definition.inputSchema;
  const acknowledgeSchema = requiredTool(server, "acknowledge_order_warning").definition
    .inputSchema;
  const statusSchema = requiredTool(server, "get_order_status").definition.inputSchema;
  const cancelSchema = requiredTool(server, "cancel_order").definition.inputSchema;
  assert.equal("accountId" in (submitSchema as Record<string, unknown>), false);
  assert.equal("accountId" in (acknowledgeSchema as Record<string, unknown>), false);
  assert.equal("accountId" in (statusSchema as Record<string, unknown>), false);
  assert.equal("accountId" in (cancelSchema as Record<string, unknown>), false);

  const previewResult = await requiredTool(server, "preview_option_spread_order").handler({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    kind: "put-credit",
    longStrike: 26400,
    shortStrike: 26600,
    quantity: 1,
    priceEffect: "CREDIT",
    limit: 39,
    tif: "DAY",
    session: "REGULAR",
    tradingClass: "QN3",
    exchange: "CME",
  });
  assert.equal(calls.preview, 1);
  assert.equal(calls.submit, 0);
  assert.equal(parse(previewResult)["submitted"], false);

  await requiredTool(server, "submit_option_spread_order").handler({
    previewId: "a".repeat(64),
    operator: "felipecsl",
    confirm: true,
  });
  await requiredTool(server, "recover_option_spread_order").handler({ previewId: "a".repeat(64) });
  await requiredTool(server, "acknowledge_order_warning").handler({
    operationId: "op-1",
    replyId: "reply-1",
    confirm: true,
  });
  await requiredTool(server, "get_order_status").handler({ operationId: "op-1" });
  await requiredTool(server, "reconcile_order_operation").handler({
    operationId: "op-1",
    confirm: true,
  });
  const cancelResult = await requiredTool(server, "cancel_order").handler({
    operationId: "op-1",
    confirm: true,
    timeoutMs: 1000,
    pollMs: 100,
  });

  assert.equal(parse(cancelResult)["operationId"], "op-1");
  assert.equal(calls.submit, 1);
  assert.equal(calls.recover, 1);
  assert.equal(calls.acknowledge, 1);
  assert.equal(calls.getStatus, 1);
  assert.equal(calls.reconcile, 1);
  assert.equal(calls.cancel, 1);
});

void test("derivative read tools keep observation evidence", async () => {
  const { calls, tools } = fakeTools();
  const server = new FakeServer();
  registerDerivativeTools(server, { createTools: () => Promise.resolve(tools) });

  const result = await requiredTool(server, "get_derivative_chain").handler({
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    strikes: 10,
    tradingClass: "QN3",
    exchange: "CME",
  });
  const body = parse(result);

  assert.equal(body["observedAt"], "2026-09-04T00:00:00.000Z");
  assert.equal(body["completeness"], "partial");
  assert.deepEqual(body["warnings"], ["Broker data is partial."]);
  assert.equal(calls.chain, 1);
});

void test("read-only mutation failures stay clear and redacted", async () => {
  const { tools } = fakeTools();
  const server = new FakeServer();
  registerDerivativeTools(server, {
    createTools: () =>
      Promise.resolve({
        ...tools,
        execution: {
          ...tools.execution,
          submit: () =>
            Promise.reject(
              new ConsumerError({
                code: "authorization_failure",
                operation: "createOrderOperation",
                message: "secret clientSecret body raw cause account U1234567",
                status: 403,
                gatewayCode: "forbidden",
                retryAfterSeconds: undefined,
              })
            ),
        },
      } as DerivativeTools),
  });

  const result = await requiredTool(server, "submit_option_spread_order").handler({
    previewId: "a".repeat(64),
    operator: "felipecsl",
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.deepEqual(parse(result), {
    error: {
      code: "authorization_failure",
      operation: "createOrderOperation",
      message:
        "Gateway authorization failed. The MCP credential may be read-only for this operation.",
    },
  });
});
