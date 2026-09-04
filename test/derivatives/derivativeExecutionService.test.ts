import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import type {
  DerivativeExecutionClient,
  OrderOperationView,
  OrderReconciliationView,
} from "#src/derivatives/derivativeExecution.js";
import {
  DerivativeExecutionService,
  FileExecutionStateStore,
  InMemoryExecutionStateStore,
  type ActionRecord,
  type SubmissionRecord,
} from "#src/derivatives/derivativeExecutionService.js";
import type { CanonicalComboIntent } from "#src/derivatives/derivativePreview.js";
import type { SpreadPreviewDto } from "#src/derivatives/derivativePreviewService.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
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
const preview: SpreadPreviewDto = {
  previewId: "a".repeat(64),
  createdAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-09-04T00:05:00.000Z",
  account: { maskedId: "U***567", environment: "paper" },
  order: {
    kind: "put-credit",
    gateway: intent,
    legs: [
      { side: "LONG", ratio: 1, contract: intent.legs[0].contract },
      { side: "SHORT", ratio: -1, contract: intent.legs[1].contract },
    ],
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
};
function operation(
  state: OrderOperationView["state"] = "accepted",
  kind: "accepted" | "warning" | "refused" | "recovery_required" = "accepted"
): OrderOperationView {
  return {
    operationId: "op-1",
    kind: "combo",
    action: "submission",
    parentOperationId: null,
    intentSchemaVersion: 1,
    intentHash: "hash",
    state,
    correlations: [],
    children: [],
    pendingWarning: kind === "warning" ? { sequence: 1, replyId: "reply-1" } : null,
    reconciliation:
      kind === "recovery_required"
        ? { observedAt: "2026-09-04T00:00:00.000Z", status: "incomplete", reason: "uncertain" }
        : null,
    result:
      kind === "accepted" || kind === "warning"
        ? {
            kind,
            orders: [
              {
                memberId: "root",
                parentMemberId: null,
                orderId: "777",
                parentOrderId: null,
                clientOrderId: null,
                status: kind === "warning" ? "WARNING_PENDING" : "WORKING",
              },
            ],
            warningCount: kind === "warning" ? 1 : 0,
          }
        : { kind, orders: [], warningCount: 0, reasonCategories: ["unknown"] },
    createdAt: "2026-09-04T00:00:00.000Z",
    latestTransitionAt: "2026-09-04T00:00:01.000Z",
  };
}
class FakeNetwork implements DerivativeExecutionClient {
  createCalls = 0;
  lookupCalls = 0;
  getCalls = 0;
  acknowledgeCalls = 0;
  reconcileCalls = 0;
  cancelCalls = 0;
  created = operation();
  nextError: unknown;
  lastCreate?: { intent: CanonicalComboIntent; key: string; operator: string };
  lastLookup?: unknown;
  lastActionKey?: string;
  preview = () => Promise.reject(new Error("unused"));
  create(value: CanonicalComboIntent, key: string, operator: string) {
    this.createCalls++;
    this.lastCreate = { intent: value, key, operator };
    if (this.nextError !== undefined)
      return Promise.reject(
        this.nextError instanceof Error ? this.nextError : new Error("network failed")
      );
    return Promise.resolve(this.created);
  }
  lookup(kind: "combo", key: string) {
    this.lookupCalls++;
    this.lastLookup = { kind, key };
    return Promise.resolve(this.created);
  }
  get(_id: string) {
    this.getCalls++;
    return Promise.resolve(this.created);
  }
  acknowledge(_id: string, _reply: string, key: string) {
    this.acknowledgeCalls++;
    this.lastActionKey = key;
    return Promise.resolve(this.created);
  }
  reconcile(_id: string) {
    this.reconcileCalls++;
    return Promise.resolve({
      operation: this.created,
      observation: null,
    } as unknown as OrderReconciliationView);
  }
  cancel(_id: string, key: string) {
    this.cancelCalls++;
    this.lastActionKey = key;
    return Promise.resolve(this.created);
  }
}
function context(
  store: InMemoryExecutionStateStore = new InMemoryExecutionStateStore(),
  now: () => Date = () => new Date("2026-09-04T00:00:00.000Z"),
  delay: (ms: number) => Promise<void> = () => Promise.resolve(),
  key: () => string = () => "exact-key"
) {
  const network = new FakeNetwork();
  let consumed = 0;
  const previews = {
    validatePreview: () => Promise.resolve(preview),
    consumePreview: () => {
      consumed++;
      return Promise.resolve();
    },
  };
  const service = new DerivativeExecutionService(
    {} as never,
    {} as never,
    network,
    previews as never,
    store,
    now,
    delay,
    undefined,
    key
  );
  return { network, store, service, consumed: () => consumed };
}

void test("pending state and exact key are durable before create starts, then completion is durable before return", async () => {
  const pendingGate = deferred();
  const completeGate = deferred();
  const base = new InMemoryExecutionStateStore();
  let pendingSeen: SubmissionRecord | undefined;
  let completeSeen: SubmissionRecord | undefined;
  const store = Object.create(base) as InMemoryExecutionStateStore;
  store.saveSubmission = async (value: SubmissionRecord) => {
    if (value.state === "submission_pending") {
      await pendingGate.promise;
      pendingSeen = value;
    } else {
      await completeGate.promise;
      completeSeen = value;
    }
    await base.saveSubmission(value);
  };
  store.loadSubmission = base.loadSubmission.bind(base);
  store.loadSubmissionByOperation = base.loadSubmissionByOperation.bind(base);
  store.saveAction = base.saveAction.bind(base);
  store.loadAction = base.loadAction.bind(base);
  const ctx = context(store);
  let returned = false;
  const submission = ctx.service
    .submit({ previewId: preview.previewId, operator: "felipecsl", confirm: true })
    .then((value) => {
      returned = true;
      return value;
    });
  await Promise.resolve();
  assert.equal(ctx.network.createCalls, 0);
  pendingGate.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ctx.network.createCalls, 1);
  assert.ok(pendingSeen);
  assert.equal(pendingSeen.idempotencyKey, "exact-key");
  assert.equal(pendingSeen.state, "submission_pending");
  assert.equal(returned, false);
  assert.equal(ctx.consumed(), 0);
  completeGate.resolve();
  const result = await submission;
  assert.ok(completeSeen);
  assert.equal(completeSeen.operationId, "op-1");
  assert.equal(completeSeen.operation?.result?.kind, "accepted");
  assert.equal(result.operation.result?.kind, "accepted");
  assert.equal(ctx.consumed(), 1);
});

void test("transport loss marks submission uncertain and never retries", async () => {
  const ctx = context();
  ctx.network.nextError = new ConsumerError({
    code: "gateway_transport_failure",
    operation: "createOrderOperation",
    message: "Gateway request failed",
    status: undefined,
    gatewayCode: undefined,
    retryAfterSeconds: undefined,
  });
  await assert.rejects(
    () => ctx.service.submit({ previewId: preview.previewId, operator: "x", confirm: true }),
    (error: unknown) => error instanceof ConsumerError && error.code === "gateway_transport_failure"
  );
  assert.equal(ctx.network.createCalls, 1);
  assert.equal((await ctx.store.loadSubmission(preview.previewId))?.state, "submission_uncertain");
  assert.equal(ctx.consumed(), 0);
});

void test("explicit recovery uses creator-scoped original kind and key with zero creates", async () => {
  const ctx = context();
  await ctx.store.saveSubmission({
    schemaVersion: 1,
    previewId: preview.previewId,
    operationKind: "combo",
    idempotencyKey: "original-key",
    canonicalIntent: intent,
    state: "submission_uncertain",
    operationId: null,
    operation: null,
    createdAt: preview.createdAt,
    updatedAt: preview.createdAt,
  });
  const result = await ctx.service.recover({ previewId: preview.previewId });
  assert.equal(ctx.network.createCalls, 0);
  assert.equal(ctx.network.lookupCalls, 1);
  assert.deepEqual(ctx.network.lastLookup, { kind: "combo", key: "original-key" });
  assert.equal(result.operationId, "op-1");
});

void test("successful recovery_required envelope remains full structured evidence", async () => {
  const ctx = context();
  ctx.network.created = operation("reconciliation_required", "recovery_required");
  const result = await ctx.service.submit({
    previewId: preview.previewId,
    operator: "x",
    confirm: true,
  });
  assert.equal(result.state, "recovery_required");
  assert.equal(result.operation.reconciliation?.status, "incomplete");
  assert.deepEqual(result.operation.result?.orders, []);
});

void test("warning and cancellation keys are independently durable before their calls", async () => {
  let keyNumber = 0;
  const ctx = context(
    new InMemoryExecutionStateStore(),
    () => new Date("2026-09-04T00:00:00.000Z"),
    () => Promise.resolve(),
    () => `key-${String(++keyNumber)}`
  );
  ctx.network.created = operation("warning_pending", "warning");
  await ctx.service.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  await ctx.service.acknowledgeWarning({ operationId: "op-1", replyId: "reply-1", confirm: true });
  const warning = await ctx.store.loadAction("op-1", "warning_acknowledgement");
  await ctx.service.cancel({ operationId: "op-1", confirm: true });
  const cancellation = await ctx.store.loadAction("op-1", "cancellation");
  assert.ok(warning);
  assert.ok(cancellation);
  assert.equal(ctx.network.acknowledgeCalls, 1);
  assert.equal(ctx.network.cancelCalls, 1);
  assert.equal(warning.state, "completed");
  assert.equal(cancellation.state, "completed");
  assert.notEqual(warning.idempotencyKey, cancellation.idempotencyKey);
  assert.equal(ctx.network.lastActionKey, cancellation.idempotencyKey);
  await ctx.service.cancel({ operationId: "op-1", confirm: true });
  assert.equal(ctx.network.cancelCalls, 1);
});

void test("pending cancellation action is durable before its network request begins", async () => {
  const base = new InMemoryExecutionStateStore();
  const gate = deferred();
  let pending: ActionRecord | undefined;
  const store = Object.create(base) as InMemoryExecutionStateStore;
  store.saveSubmission = base.saveSubmission.bind(base);
  store.loadSubmission = base.loadSubmission.bind(base);
  store.loadSubmissionByOperation = base.loadSubmissionByOperation.bind(base);
  store.loadAction = base.loadAction.bind(base);
  store.saveAction = async (value: ActionRecord) => {
    if (value.state === "pending") {
      await gate.promise;
      pending = value;
    }
    await base.saveAction(value);
  };
  const ctx = context(store);
  await ctx.service.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  const cancellation = ctx.service.cancel({ operationId: "op-1", confirm: true });
  await Promise.resolve();
  assert.equal(ctx.network.cancelCalls, 0);
  gate.resolve();
  await cancellation;
  assert.ok(pending);
  assert.equal(pending.state, "pending");
  assert.equal(ctx.network.cancelCalls, 1);
  assert.equal(ctx.network.lastActionKey, pending.idempotencyKey);
});

void test("reconciliation runs exactly once only for each explicit invocation", async () => {
  const ctx = context();
  await ctx.service.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  assert.equal(ctx.network.reconcileCalls, 0);
  await ctx.service.reconcile("op-1");
  assert.equal(ctx.network.reconcileCalls, 1);
});

void test("watch uses injected time and delay at the exact deadline", async () => {
  let time = 0;
  const delays: number[] = [];
  const ctx = context(
    new InMemoryExecutionStateStore(),
    () => new Date(time),
    (ms) => {
      delays.push(ms);
      time += ms;
      return Promise.resolve();
    }
  );
  ctx.network.created = operation("broker_attempt_started");
  await ctx.service.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  await assert.rejects(
    () => ctx.service.watch({ operationId: "op-1", timeoutMs: 1000, pollMs: 600 }),
    /Timed out/
  );
  assert.deepEqual(delays, [600, 400]);
  assert.equal(ctx.network.getCalls, 3);
});

void test("hidden not-found outcomes stay indistinguishable", () => {
  const hidden = () =>
    new ConsumerError({
      code: "gateway_transport_failure",
      operation: "getOrderOperation",
      message: "Gateway request failed",
      status: 404,
      gatewayCode: "not_found",
      retryAfterSeconds: undefined,
    });
  assert.deepEqual(hidden().toJSON(), hidden().toJSON());
});

void test("file store persists strict private versioned state without account or client-order injection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "execution-v1-"));
  try {
    const store = new FileExecutionStateStore(directory);
    const record: SubmissionRecord = {
      schemaVersion: 1,
      previewId: preview.previewId,
      operationKind: "combo",
      idempotencyKey: "key",
      canonicalIntent: intent,
      state: "operation_known",
      operationId: "op-1",
      operation: operation(),
      createdAt: preview.createdAt,
      updatedAt: preview.createdAt,
    };
    await store.saveSubmission(record);
    const [file] = await readdir(join(directory, "submissions"));
    assert.ok(file);
    const source = await readFile(join(directory, "submissions", file), "utf8");
    assert.doesNotMatch(source, /accountId|clientOrderId.*huskly/);
    assert.equal((await store.loadSubmissionByOperation("op-1"))?.schemaVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
