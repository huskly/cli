import test from "node:test";
import assert from "node:assert/strict";
import type { IbkrGatewayClient } from "@huskly/ibkr-gateway-client";
import {
  GatewayMutationAdapter,
  createGatewayMutationApi,
  type GatewayMutationApi,
} from "#src/gateway/gatewayMutationAdapter.js";
import type { GatewayTransport } from "#src/gateway/gatewayTransport.js";
import type { CanonicalComboIntent } from "#src/derivatives/derivativePreview.js";

const intent: CanonicalComboIntent = {
  legs: [
    {
      contract: {
        identity: {
          assetClass: "FOP",
          underlying: "NQ",
          expiration: "2026-08-21",
          strike: 26400,
          right: "PUT",
          tradingClass: "QN3",
          exchange: "CME",
          multiplier: 20,
        },
        brokerReference: { broker: "ibkr", contractId: "101" },
      },
      ratio: 1,
    },
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
        brokerReference: { broker: "ibkr", contractId: "102" },
      },
      ratio: -1,
    },
  ],
  quantity: 1,
  tif: "DAY",
  session: "REGULAR",
  priceEffect: "CREDIT",
  orderType: "LMT",
  limit: 39,
};
const operation = {
  operationId: "op-1",
  kind: "combo",
  action: "submission",
  parentOperationId: null,
  intentSchemaVersion: 1,
  intentHash: "hash",
  state: "reconciliation_required",
  correlations: [],
  children: [],
  pendingWarning: { sequence: 1, replyId: "reply-1" },
  reconciliation: {
    observedAt: "2026-09-04T00:00:00.000Z",
    status: "incomplete",
    reason: "unknown",
  },
  result: { kind: "recovery_required", orders: [], warningCount: 0, reasonCategories: ["unknown"] },
  createdAt: "2026-09-04T00:00:00.000Z",
  latestTransitionAt: "2026-09-04T00:00:01.000Z",
} as const;

void test("adapter uses exact generated requests and preserves normalized recovery evidence", async () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const api = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          calls.push({ name: String(name), args });
          return Promise.resolve(
            name === "previewOrders"
              ? {
                  environment: "paper",
                  accepted: true,
                  submitted: false,
                  commission: null,
                  initialMargin: null,
                  maintenanceMargin: null,
                  warnings: [],
                  rejectionReasons: [],
                  advisoryAssetPermissions: [],
                }
              : name === "reconcileOrderOperation"
                ? { operation, observation: operation.reconciliation }
                : operation
          );
        },
    }
  ) as GatewayMutationApi;
  const adapter = new GatewayMutationAdapter(api);
  await adapter.preview(intent);
  assert.equal(
    (await adapter.create(intent, "submit-key", "felipecsl")).result?.kind,
    "recovery_required"
  );
  await adapter.lookup("combo", "submit-key");
  await adapter.get("op-1");
  await adapter.acknowledge("op-1", "reply-1", "warning-key");
  await adapter.reconcile("op-1");
  await adapter.cancel("op-1", "cancel-key");
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "previewOrders",
      "createOrderOperation",
      "lookupOrderOperation",
      "getOrderOperation",
      "acknowledgeOrderWarning",
      "reconcileOrderOperation",
      "cancelOrderOperation",
    ]
  );
  assert.equal(calls.filter((call) => call.name === "createOrderOperation").length, 1);
  assert.deepEqual(calls[2]?.args, [{ kind: "combo", idempotencyKey: "submit-key" }]);
  assert.deepEqual(calls[4]?.args, ["op-1", "reply-1", "warning-key"]);
  assert.deepEqual(calls[6]?.args, ["op-1", "cancel-key"]);
  const createBody = calls[1]?.args[0] as Record<string, unknown>;
  assert.equal(createBody["kind"], "combo");
  assert.equal(createBody["extOperator"], "felipecsl");
  assert.equal("accountId" in createBody, false);
  assert.equal("clientOrderId" in createBody, false);
  assert.deepEqual(
    (createBody["legs"] as { contract: { conid: number } }[]).map((leg) => leg.contract.conid),
    [101, 102]
  );
});

void test("transport API makes one direct generated client call per operation", async () => {
  const direct: string[] = [];
  const client = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (..._args: unknown[]) => {
          direct.push(String(name));
          return Promise.resolve(
            name === "previewOrders"
              ? {
                  environment: "paper",
                  accepted: true,
                  submitted: false,
                  commission: null,
                  initialMargin: null,
                  maintenanceMargin: null,
                  warnings: [],
                  rejectionReasons: [],
                  advisoryAssetPermissions: [],
                }
              : name === "reconcileOrderOperation"
                ? { operation, observation: operation.reconciliation }
                : operation
          );
        },
    }
  ) as IbkrGatewayClient;
  const transport = {
    client,
    call: async <T>(_operation: string, invoke: (value: IbkrGatewayClient) => Promise<T>) =>
      invoke(client),
  } satisfies GatewayTransport;
  const api = createGatewayMutationApi(transport);
  await api.previewOrders({
    legs: [],
    quantity: 1,
    tif: "DAY",
    session: "REGULAR",
    priceEffect: "DEBIT",
    orderType: "LMT",
    limit: 1,
  });
  await api.createOrderOperation(
    {
      kind: "combo",
      legs: [],
      quantity: 1,
      tif: "DAY",
      session: "REGULAR",
      priceEffect: "DEBIT",
      orderType: "LMT",
      limit: 1,
    },
    "s"
  );
  await api.lookupOrderOperation({ kind: "combo", idempotencyKey: "s" });
  await api.getOrderOperation("op-1");
  await api.acknowledgeOrderWarning("op-1", "r", "w");
  await api.reconcileOrderOperation("op-1");
  await api.cancelOrderOperation("op-1", "c");
  assert.deepEqual(direct, [
    "previewOrders",
    "createOrderOperation",
    "lookupOrderOperation",
    "getOrderOperation",
    "acknowledgeOrderWarning",
    "reconcileOrderOperation",
    "cancelOrderOperation",
  ]);
});
