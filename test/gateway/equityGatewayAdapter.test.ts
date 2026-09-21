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
        version: "1.0.0",
        state: "ready",
        readReady: true,
        newMutationReady: true,
        recoveryMutationReady: true,
        lockOwned: true,
        accountVerified: true,
        account: "DU1234567",
        environment: "paper",
        authenticated: true,
        connected: true,
        competingSession: false,
        lastTickleAt: null,
        nextRenewalAt: null,
        readQueueDepth: 0,
        pendingWarnings: 0,
        reconciliationRequiredOperations: 0,
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
  const diagnostics = await adapter.getTradingDiagnostics();
  assert.equal(diagnostics.maskedAccountDisplay, "D***567");
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

test("equity adapter rejects malformed diagnostics before readiness checks", async () => {
  const api = {
    getDiagnostics: () =>
      Promise.resolve({
        environment: "paper",
        accountVerified: "true",
        newMutationReady: "true",
        recoveryMutationReady: "true",
        account: "DU1234567",
      }),
  } as unknown as GatewayMutationApi;
  await assert.rejects(
    new EquityGatewayAdapter(api).getTradingDiagnostics(),
    /Gateway request failed/u
  );
});

test("equity adapter forwards exact STP preview and submit objects", async () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const api = {
    getDiagnostics: () =>
      Promise.resolve({
        version: "1.0.0",
        state: "ready",
        readReady: true,
        newMutationReady: true,
        recoveryMutationReady: true,
        lockOwned: true,
        accountVerified: true,
        account: "DU1234567",
        environment: "paper",
        authenticated: true,
        connected: true,
        competingSession: false,
        lastTickleAt: null,
        nextRenewalAt: null,
        readQueueDepth: 0,
        pendingWarnings: 0,
        reconciliationRequiredOperations: 0,
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
      return Promise.resolve({ operationId: "operation-2", kind: "single" });
    },
    lookupOrderOperation: (...args: unknown[]) => {
      calls.push({ name: "lookup", args });
      return Promise.resolve({ operationId: "operation-2", kind: "single" });
    },
  } as unknown as GatewayMutationApi;
  const adapter = new EquityGatewayAdapter(api);
  const resolved = await adapter.resolveContract("IBIT");
  const intent = {
    contract: resolved,
    side: "BUY" as const,
    quantity: 5,
    tif: "GTC" as const,
    session: "REGULAR" as const,
    orderType: "STP" as const,
    stopPrice: 45.5,
  };
  await adapter.preview(intent);
  await adapter.create(intent, "equity-stp-key", "operator-9");

  assert.deepEqual(calls, [
    { name: "resolve", args: [{ symbol: "IBIT" }] },
    { name: "preview", args: [intent] },
    {
      name: "create",
      args: [
        { kind: "single", ...intent, extOperator: "operator-9", manualIndicator: true },
        "equity-stp-key",
      ],
    },
  ]);
  assert.equal(JSON.stringify(calls).includes("limit"), false);
});
