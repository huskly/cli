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
  type SubmissionRecord,
} from "#src/derivatives/derivativeExecutionService.js";
import type { CanonicalComboIntent } from "#src/derivatives/derivativePreview.js";
import type { SpreadPreviewDto } from "#src/derivatives/derivativePreviewService.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
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
          settlement: "PM",
          exerciseStyle: "AMERICAN",
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
          settlement: "PM",
          exerciseStyle: "AMERICAN",
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
  options: {
    state?: OrderOperationView["state"];
    kind?: "accepted" | "warning" | "refused" | "recovery_required";
    warning?: { sequence: number; replyId: string } | null;
    orderId?: string | null;
    clientOrderId?: string | null;
    children?: OrderOperationView["children"];
  } = {}
): OrderOperationView {
  const state = options.state ?? "accepted";
  const kind = options.kind ?? "accepted";
  const warning =
    options.warning ?? (kind === "warning" ? { sequence: 1, replyId: "reply-1" } : null);
  return {
    operationId: "op-1",
    kind: "combo",
    action: "submission",
    parentOperationId: null,
    intentSchemaVersion: 1,
    intentHash: "hash",
    state,
    correlations: [],
    children: options.children ?? [],
    pendingWarning: warning,
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
                orderId: options.orderId === undefined ? "777" : options.orderId,
                parentOrderId: null,
                clientOrderId: options.clientOrderId ?? null,
                status:
                  kind === "warning"
                    ? "WARNING_PENDING"
                    : state === "cancelled"
                      ? "CANCELED"
                      : "WORKING",
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
  createHandler?: (
    intent: CanonicalComboIntent,
    key: string,
    operator: string
  ) => Promise<OrderOperationView>;
  acknowledgeHandler?: (
    operationId: string,
    replyId: string,
    key: string
  ) => Promise<OrderOperationView>;
  cancelHandler?: (operationId: string, key: string) => Promise<OrderOperationView>;
  getHandler?: (operationId: string) => Promise<OrderOperationView>;
  createKeys: string[] = [];
  actionKeys: string[] = [];
  preview = () => Promise.reject(new Error("unused"));
  create(value: CanonicalComboIntent, key: string, operator: string) {
    this.createCalls += 1;
    this.createKeys.push(key);
    return this.createHandler?.(value, key, operator) ?? Promise.resolve(this.created);
  }
  lookup(_kind: "combo", _key: string) {
    this.lookupCalls += 1;
    return Promise.resolve(this.created);
  }
  get(operationId: string) {
    this.getCalls += 1;
    return this.getHandler?.(operationId) ?? Promise.resolve(this.created);
  }
  acknowledge(operationId: string, replyId: string, key: string) {
    this.acknowledgeCalls += 1;
    this.actionKeys.push(key);
    return this.acknowledgeHandler?.(operationId, replyId, key) ?? Promise.resolve(this.created);
  }
  reconcile(_operationId: string): Promise<OrderReconciliationView> {
    this.reconcileCalls += 1;
    return Promise.resolve(this.created);
  }
  cancel(operationId: string, key: string) {
    this.cancelCalls += 1;
    this.actionKeys.push(key);
    return this.cancelHandler?.(operationId, key) ?? Promise.resolve(this.created);
  }
}

function service(
  store: InMemoryExecutionStateStore | FileExecutionStateStore,
  network: FakeNetwork,
  key: () => string = () => "exact-key",
  selectedPreview: SpreadPreviewDto = preview,
  now: () => Date = () => new Date("2026-09-04T00:00:00.000Z"),
  delay: (ms: number) => Promise<void> = () => Promise.resolve()
) {
  return new DerivativeExecutionService(
    {} as never,
    {} as never,
    network,
    {
      validatePreview: () => Promise.resolve(selectedPreview),
      consumePreview: () => Promise.resolve(),
    } as never,
    store,
    now,
    delay,
    undefined,
    key
  );
}

void test("submission reservation is durable before the one create call", async () => {
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  const started = deferred();
  const release = deferred<OrderOperationView>();
  network.createHandler = async () => {
    started.resolve();
    return release.promise;
  };
  const execution = service(store, network);
  const submitted = execution.submit({
    previewId: preview.previewId,
    operator: "operator",
    confirm: true,
  });
  await started.promise;
  const reserved = await store.loadSubmission(preview.previewId);
  assert.ok(reserved);
  assert.equal(reserved.state, "submission_pending");
  assert.equal(reserved.idempotencyKey, "exact-key");
  release.resolve(operation());
  const result = await submitted;
  assert.equal(result.operationId, "op-1");
  assert.equal(network.createCalls, 1);
});

void test("two real-file services reserve one durable submission key and make one network call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "execution-submit-race-"));
  try {
    const network = new FakeNetwork();
    const started = deferred();
    const release = deferred<OrderOperationView>();
    network.createHandler = async () => {
      started.resolve();
      return release.promise;
    };
    const first = service(new FileExecutionStateStore(directory), network, () => "key-one");
    const second = service(new FileExecutionStateStore(directory), network, () => "key-two");
    const settledPromise = Promise.allSettled([
      first.submit({ previewId: preview.previewId, operator: "one", confirm: true }),
      second.submit({ previewId: preview.previewId, operator: "two", confirm: true }),
    ]);
    await started.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(network.createCalls, 1);
    const names = await readdir(join(directory, "submissions"));
    assert.equal(names.length, 1);
    const reserved = JSON.parse(
      await readFile(join(directory, "submissions", names[0] ?? ""), "utf8")
    ) as SubmissionRecord;
    assert.ok(["key-one", "key-two"].includes(reserved.idempotencyKey));
    release.resolve(operation());
    const settled = await settledPromise;
    assert.equal(settled.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(settled.filter(({ status }) => status === "rejected").length, 1);
    assert.equal(network.createKeys.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("transport loss marks a submission uncertain and explicit recovery only looks it up", async () => {
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  network.createHandler = () =>
    Promise.reject(
      new ConsumerError({
        code: "gateway_transport_failure",
        operation: "createOrderOperation",
        message: "Gateway request failed",
        status: undefined,
        gatewayCode: undefined,
        retryAfterSeconds: undefined,
      })
    );
  const execution = service(store, network);
  await assert.rejects(() =>
    execution.submit({ previewId: preview.previewId, operator: "x", confirm: true })
  );
  assert.equal((await store.loadSubmission(preview.previewId))?.state, "submission_uncertain");
  network.created = operation();
  const recovered = await execution.recover({ previewId: preview.previewId });
  assert.equal(recovered.operationId, "op-1");
  assert.equal(network.createCalls, 1);
  assert.equal(network.lookupCalls, 1);
});

void test("multi-step warnings use stable sequence identities, distinct keys, and update canonical state", async () => {
  let keyNumber = 0;
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  network.created = operation({
    state: "warning_pending",
    kind: "warning",
    warning: { sequence: 1, replyId: "reply-1" },
  });
  network.acknowledgeHandler = (_id, replyId) => {
    network.created =
      replyId === "reply-1"
        ? operation({
            state: "warning_pending",
            kind: "warning",
            warning: { sequence: 2, replyId: "reply-2" },
          })
        : operation();
    return Promise.resolve(network.created);
  };
  const execution = service(store, network, () => `key-${String(++keyNumber)}`);
  await execution.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  const secondWarning = await execution.acknowledgeWarning({
    operationId: "op-1",
    replyId: "reply-1",
    confirm: true,
  });
  assert.equal(secondWarning.operation.pendingWarning?.replyId, "reply-2");
  assert.equal(
    (await store.loadSubmissionByOperation("op-1"))?.operation?.pendingWarning?.sequence,
    2
  );
  const accepted = await execution.acknowledgeWarning({
    operationId: "op-1",
    replyId: "reply-2",
    confirm: true,
  });
  assert.equal(accepted.operation.pendingWarning, null);
  assert.equal(network.acknowledgeCalls, 2);
  assert.notEqual(network.actionKeys[0], network.actionKeys[1]);
  assert.equal(
    (await store.loadAction("op-1", "warning_acknowledgement", 1, "reply-1"))?.state,
    "completed"
  );
  assert.equal(
    (await store.loadAction("op-1", "warning_acknowledgement", 2, "reply-2"))?.state,
    "completed"
  );
});

void test("uncertain warning recovery completes from parent evidence without a second action call", async () => {
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  network.created = operation({ state: "warning_pending", kind: "warning" });
  network.acknowledgeHandler = () => {
    network.created = operation();
    return Promise.reject(new Error("response lost"));
  };
  const execution = service(store, network);
  await execution.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  await assert.rejects(() =>
    execution.acknowledgeWarning({ operationId: "op-1", replyId: "reply-1", confirm: true })
  );
  const recovered = await execution.acknowledgeWarning({
    operationId: "op-1",
    replyId: "reply-1",
    confirm: true,
  });
  assert.equal(recovered.operation.state, "accepted");
  assert.equal(network.acknowledgeCalls, 1);
  assert.equal(network.getCalls, 1);
});

void test("uncertain warning recovery replays exactly once with the same durable key when parent evidence is unchanged", async () => {
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  network.created = operation({ state: "warning_pending", kind: "warning" });
  let lost = true;
  network.acknowledgeHandler = () => {
    if (lost) {
      lost = false;
      return Promise.reject(new Error("response lost"));
    }
    network.created = operation();
    return Promise.resolve(network.created);
  };
  const execution = service(store, network, () => "durable-warning-key");
  await execution.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  await assert.rejects(() =>
    execution.acknowledgeWarning({ operationId: "op-1", replyId: "reply-1", confirm: true })
  );
  await execution.acknowledgeWarning({ operationId: "op-1", replyId: "reply-1", confirm: true });
  assert.equal(network.acknowledgeCalls, 2);
  assert.deepEqual(network.actionKeys, ["durable-warning-key", "durable-warning-key"]);
});

void test("uncertain cancellation recovery completes from parent evidence without a second action call", async () => {
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  const execution = service(store, network, () => "durable-cancel-key");
  await execution.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  network.cancelHandler = () => {
    network.created = operation({ state: "cancelled" });
    return Promise.reject(new Error("response lost"));
  };
  await assert.rejects(() => execution.cancel({ operationId: "op-1", confirm: true }));
  const recovered = await execution.cancel({ operationId: "op-1", confirm: true });
  assert.equal(recovered.operation.state, "cancelled");
  assert.equal(network.cancelCalls, 1);
  assert.equal(network.getCalls, 1);
  assert.deepEqual(network.actionKeys, ["durable-cancel-key"]);
});

void test("two real-file services reserve one cancellation action and make one network call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "execution-action-race-"));
  try {
    const network = new FakeNetwork();
    const first = service(new FileExecutionStateStore(directory), network, () => "submit-key");
    await first.submit({ previewId: preview.previewId, operator: "x", confirm: true });
    const started = deferred();
    const release = deferred<OrderOperationView>();
    network.cancelHandler = async () => {
      started.resolve();
      return release.promise;
    };
    const left = service(new FileExecutionStateStore(directory), network, () => "cancel-one");
    const right = service(new FileExecutionStateStore(directory), network, () => "cancel-two");
    const settledPromise = Promise.allSettled([
      left.cancel({ operationId: "op-1", confirm: true }),
      right.cancel({ operationId: "op-1", confirm: true }),
    ]);
    await started.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(network.cancelCalls, 1);
    release.resolve(operation({ state: "cancelled" }));
    const settled = await settledPromise;
    assert.equal(settled.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(settled.filter(({ status }) => status === "rejected").length, 1);
    assert.equal(network.actionKeys.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("lifecycle DTO never substitutes operation identity or invented fill and price evidence", async () => {
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  network.created = operation({ orderId: null, clientOrderId: null });
  const livePreview = { ...preview, account: { maskedId: null, environment: "live" as const } };
  const execution = service(store, network, () => "key", livePreview);
  const submitted = await execution.submit({
    previewId: preview.previewId,
    operator: "x",
    confirm: true,
  });
  assert.equal(submitted.operationId, "op-1");
  assert.equal(submitted.orderId, null);
  assert.deepEqual(submitted.account, { maskedId: null, environment: "live" });
  const status = await execution.getStatus("op-1");
  assert.equal(status.orderId, null);
  assert.equal(status.clientOrderId, null);
  assert.equal(status.quantity, null);
  assert.equal(status.filledQuantity, null);
  assert.equal(status.remainingQuantity, null);
  assert.equal(status.limitPrice, null);
  assert.equal(status.averagePrice, null);
  assert.equal(status.commissionAndFees, null);
});

void test("known canonical state repairs a failed operation index write after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "execution-index-repair-"));
  try {
    let fail = true;
    const faulty = new FileExecutionStateStore(directory, () => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error("injected index failure"));
      }
      return Promise.resolve();
    });
    const network = new FakeNetwork();
    await assert.rejects(
      () =>
        service(faulty, network).submit({
          previewId: preview.previewId,
          operator: "x",
          confirm: true,
        }),
      /injected index failure/
    );
    const restarted = service(new FileExecutionStateStore(directory), network);
    const recovered = await restarted.recover({ previewId: preview.previewId });
    assert.equal(recovered.operationId, "op-1");
    assert.equal(network.lookupCalls, 0);
    assert.equal(
      (await new FileExecutionStateStore(directory).loadSubmissionByOperation("op-1"))?.previewId,
      preview.previewId
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("reconciliation uses the exact generated envelope and persists returned evidence", async () => {
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  const execution = service(store, network);
  await execution.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  network.created = operation({ kind: "recovery_required", state: "reconciliation_required" });
  const reconciled = await execution.reconcile("op-1");
  assert.equal(reconciled.operationId, "op-1");
  assert.equal(reconciled.reconciliation?.status, "incomplete");
  assert.equal(
    (await store.loadSubmissionByOperation("op-1"))?.operation?.reconciliation?.reason,
    "uncertain"
  );
  assert.equal(network.reconcileCalls, 1);
});

void test("watch uses injected time at the exact deadline", async () => {
  let time = 0;
  const delays: number[] = [];
  const store = new InMemoryExecutionStateStore();
  const network = new FakeNetwork();
  network.created = operation({ state: "broker_attempt_started" });
  const execution = service(
    store,
    network,
    () => "key",
    preview,
    () => new Date(time),
    (ms) => {
      delays.push(ms);
      time += ms;
      return Promise.resolve();
    }
  );
  await execution.submit({ previewId: preview.previewId, operator: "x", confirm: true });
  await assert.rejects(
    () => execution.watch({ operationId: "op-1", timeoutMs: 1000, pollMs: 600 }),
    /Timed out/
  );
  assert.deepEqual(delays, [600, 400]);
  assert.equal(network.getCalls, 3);
});

void test("file store keeps one canonical submission and a derived private operation index", async () => {
  const directory = await mkdtemp(join(tmpdir(), "execution-v1-"));
  try {
    const store = new FileExecutionStateStore(directory);
    const record: SubmissionRecord = {
      schemaVersion: 1,
      previewId: preview.previewId,
      operationKind: "combo",
      idempotencyKey: "key",
      canonicalIntent: intent,
      account: preview.account,
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
    assert.doesNotMatch(source, /accountId|clientOrderId.*huskly/u);
    assert.equal((await store.loadSubmissionByOperation("op-1"))?.schemaVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
