import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayMutationApi } from "../../src/gateway/gatewayMutationAdapter.js";
import { EquityGatewayAdapter } from "../../src/equities/equityGatewayAdapter.js";

const contract = {
  conid: 8314,
  assetClass: "STK" as const,
  symbol: "IBIT",
  exchange: "SMART" as const,
  primaryExchange: "NASDAQ",
  currency: "USD" as const,
};

test("equity adapter resolves previews and submits one exact generated request", async () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const api = {
    getDiagnostics: () =>
      Promise.resolve({
        environment: "paper",
        accountVerified: true,
        newMutationReady: true,
      }),
    resolveEquityContract: (...args: unknown[]) => {
      calls.push({ name: "resolve", args });
      return Promise.resolve({
        observedAt: "2026-09-14T12:00:00.000Z",
        status: "available",
        contract,
      });
    },
    previewOrders: (...args: unknown[]) => {
      calls.push({ name: "preview", args });
      return Promise.resolve({
        environment: "paper",
        accepted: true,
        submitted: false,
        commission: null,
        initialMargin: null,
        maintenanceMargin: null,
        warnings: [],
        rejectionReasons: [],
        advisoryAssetPermissions: [],
      });
    },
    createOrderOperation: (...args: unknown[]) => {
      calls.push({ name: "create", args });
      return Promise.resolve({ operationId: "operation-1", kind: "single" });
    },
    lookupOrderOperation: (...args: unknown[]) => {
      calls.push({ name: "lookup", args });
      return Promise.resolve({ operationId: "operation-1", kind: "single" });
    },
  } as unknown as GatewayMutationApi;
  const adapter = new EquityGatewayAdapter(api);
  const resolved = await adapter.resolveContract("IBIT");
  const intent = {
    contract: resolved,
    side: "SELL" as const,
    quantity: 2,
    tif: "DAY" as const,
    session: "REGULAR" as const,
    orderType: "LMT" as const,
    limit: 52.25,
  };
  await adapter.preview(intent);
  await adapter.create(intent, "equity-key", "operator-7");
  await adapter.lookup("equity-key");

  assert.deepEqual(calls, [
    { name: "resolve", args: [{ symbol: "IBIT" }] },
    { name: "preview", args: [intent] },
    {
      name: "create",
      args: [
        { kind: "single", ...intent, extOperator: "operator-7", manualIndicator: true },
        "equity-key",
      ],
    },
    { name: "lookup", args: [{ kind: "single", idempotencyKey: "equity-key" }] },
  ]);
  assert.equal(JSON.stringify(calls).includes("accountId"), false);
});
