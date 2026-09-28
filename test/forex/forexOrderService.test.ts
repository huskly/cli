import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import { FileEquitySubmissionStore } from "../../src/equities/equityOrderService.js";
import type {
  CanonicalForexIntent,
  ForexContract,
  ForexGatewayClient,
} from "../../src/forex/forexOrder.js";
import { FileForexSubmissionStore, ForexOrderService } from "../../src/forex/forexOrderService.js";
import {
  InMemorySingleOrderPreviewStore,
  InMemorySingleOrderSubmissionStore,
  type SingleOrderPreviewResult,
  type SingleOrderSubmissionStore,
  type SingleOrderTradingDiagnostics,
} from "../../src/orders/singleOrderWorkflow.js";

const contract: ForexContract = {
  conid: 15016059,
  assetClass: "CASH",
  symbol: "USD",
  currency: "JPY",
  localSymbol: "USD.JPY",
  exchange: "IDEALPRO",
};
const operation = {
  operationId: "operation-fx-1",
  kind: "single",
  action: "submission",
  parentOperationId: null,
  intentSchemaVersion: 1,
  intentHash: "a".repeat(64),
  state: "accepted",
  correlations: [],
  children: [],
  pendingWarning: null,
  reconciliation: null,
  result: { kind: "accepted", orders: [], warningCount: 0 },
  blockedCause: null,
  outcome: null,
  createdAt: "2026-09-25T12:00:00.000Z",
  latestTransitionAt: "2026-09-25T12:00:01.000Z",
} as OrderOperation;

class Gateway implements ForexGatewayClient {
  public diagnostics: SingleOrderTradingDiagnostics = {
    environment: "paper",
    accountVerified: true,
    newMutationReady: true,
    recoveryMutationReady: true,
    maskedAccountDisplay: "D***567",
  };
  public resolved: ForexContract = contract;
  public warnings: string[] = [];
  public resolveCalls: string[] = [];
  public previewCalls: CanonicalForexIntent[] = [];
  public createCalls: { intent: CanonicalForexIntent; key: string; operator: string }[] = [];
  public lookupCalls: string[] = [];
  public createFailure: Error | undefined;

  public getTradingDiagnostics() {
    return Promise.resolve(this.diagnostics);
  }
  public resolveContract(pair: string) {
    this.resolveCalls.push(pair);
    return Promise.resolve(this.resolved);
  }
  public preview(intent: CanonicalForexIntent): Promise<SingleOrderPreviewResult> {
    this.previewCalls.push(intent);
    return Promise.resolve({
      environment: this.diagnostics.environment,
      accepted: true,
      submitted: false,
      commission: 2,
      initialMargin: { current: 1000, change: 900, after: 1900 },
      maintenanceMargin: null,
      warnings: this.warnings,
      rejectionReasons: [],
      advisoryAssetPermissions: [],
      currency: "USD",
    });
  }
  public create(intent: CanonicalForexIntent, key: string, operator: string) {
    this.createCalls.push({ intent, key, operator });
    if (this.createFailure !== undefined) return Promise.reject(this.createFailure);
    return Promise.resolve(operation);
  }
  public lookup(key: string) {
    this.lookupCalls.push(key);
    return Promise.resolve(operation);
  }
}

function service(
  now: () => Date = () => new Date("2026-09-25T12:00:00.000Z"),
  submissions: SingleOrderSubmissionStore<CanonicalForexIntent> = new InMemorySingleOrderSubmissionStore()
) {
  const gateway = new Gateway();
  const previews = new InMemorySingleOrderPreviewStore<CanonicalForexIntent>();
  let keys = 0;
  return {
    gateway,
    previews,
    value: new ForexOrderService({
      gateway,
      previews,
      submissions,
      now,
      ttlMs: 60_000,
      nonce: () => "00000000-0000-4000-8000-000000000001",
      key: () => `00000000-0000-4000-8000-00000000000${String(++keys + 1)}`,
    }),
  };
}

const input = { pair: "usd/jpy", side: "BUY", quantity: 25_000, limit: 147.25 } as const;

test("preview resolves the normalized pair and stores LMT DAY terms without submitting", async () => {
  const fx = service();
  const result = await fx.value.preview(input);
  assert.deepEqual(fx.gateway.resolveCalls, ["USD.JPY"]);
  assert.deepEqual(result.order, {
    contract,
    side: "BUY",
    quantity: 25_000,
    tif: "DAY",
    orderType: "LMT",
    limit: 147.25,
  } satisfies CanonicalForexIntent);
  assert.equal("session" in result.order, false);
  assert.equal(result.whatIf.currency, "USD");
  assert.equal(result.submitted, false);
  assert.equal(fx.gateway.createCalls.length, 0);
});

test("preview refuses a resolved contract for another pair", async () => {
  const fx = service();
  fx.gateway.resolved = { ...contract, currency: "CNH", localSymbol: "USD.CNH" };
  await assert.rejects(fx.value.preview(input), /does not match/);
  assert.equal(fx.gateway.previewCalls.length, 0);
});

test("preview refuses bad terms before any gateway call", () => {
  const fx = service();
  for (const bad of [
    { ...input, pair: "USD.USD" },
    { ...input, quantity: 1.5 },
    { ...input, quantity: 0 },
    { ...input, limit: 0 },
    { ...input, limit: Number.NaN },
  ]) {
    assert.throws(() => fx.value.preview(bad));
  }
  assert.deepEqual(fx.gateway.resolveCalls, []);
});

test("preview keeps the IBKR odd-lot warning for a small order", async () => {
  const fx = service();
  fx.gateway.warnings = ["This order will be directed to the IDEALPRO odd lot market"];
  const result = await fx.value.preview({ ...input, quantity: 1_000 });
  assert.equal(result.whatIf.accepted, true);
  assert.deepEqual(result.whatIf.warnings, [
    "This order will be directed to the IDEALPRO odd lot market",
  ]);
});

test("an expired preview cannot be submitted", async () => {
  let current = new Date("2026-09-25T12:00:00.000Z");
  const fx = service(() => current);
  const result = await fx.value.preview(input);
  current = new Date("2026-09-25T12:01:00.000Z");
  await assert.rejects(
    fx.value.submit({ previewId: result.previewId, operator: "operator-7", confirm: true }),
    /expired/
  );
  assert.equal(fx.gateway.createCalls.length, 0);
});

test("submit writes once and a repeated submit returns the same operation", async () => {
  const fx = service();
  const result = await fx.value.preview(input);
  const first = await fx.value.submit({
    previewId: result.previewId,
    operator: "operator-7",
    confirm: true,
  });
  const second = await fx.value.submit({
    previewId: result.previewId,
    operator: "operator-7",
    confirm: true,
  });
  assert.equal(first.recovered, false);
  assert.equal(second.recovered, true);
  assert.equal(second.operation.operationId, first.operation.operationId);
  assert.equal(fx.gateway.createCalls.length, 1);
  assert.deepEqual(fx.gateway.createCalls[0]?.intent, result.order);
});

test("an uncertain write recovers by its idempotency key and never writes again", async () => {
  const fx = service();
  const result = await fx.value.preview(input);
  fx.gateway.createFailure = new Error("socket hang up");
  await assert.rejects(
    fx.value.submit({ previewId: result.previewId, operator: "operator-7", confirm: true }),
    /socket hang up/
  );
  fx.gateway.createFailure = undefined;
  const recovered = await fx.value.submit({
    previewId: result.previewId,
    operator: "operator-7",
    confirm: true,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(fx.gateway.createCalls.length, 1);
  assert.deepEqual(fx.gateway.lookupCalls, [fx.gateway.createCalls[0]?.key]);
});

test("the shared execution store keeps forex and equity submissions apart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-fx-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fx = service(undefined, new FileForexSubmissionStore(directory));
  const result = await fx.value.preview(input);
  await fx.value.submit({ previewId: result.previewId, operator: "operator-7", confirm: true });

  const stored = await new FileForexSubmissionStore(directory).load(result.previewId);
  assert.equal(stored?.canonicalIntent.contract.assetClass, "CASH");
  await assert.rejects(
    new FileEquitySubmissionStore(directory).load(result.previewId),
    /not an equity order/
  );
});
