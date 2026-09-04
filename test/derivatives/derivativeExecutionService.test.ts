import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observe } from "#src/brokers/brokerClient.js";
import type {
  DerivativeContract,
  DerivativeDiscoveryClient,
} from "#src/derivatives/derivativeDiscovery.js";
import type {
  DerivativeComboExecutionRequest,
  DerivativeExecutionClient,
  DerivativeOrderLifecycle,
  DerivativeOrderSubmissionResult,
} from "#src/derivatives/derivativeExecution.js";
import type { DerivativePreviewClient } from "#src/derivatives/derivativePreview.js";
import {
  DerivativeExecutionService,
  FileExecutionStateStore,
  InMemoryExecutionStateStore,
} from "#src/derivatives/derivativeExecutionService.js";
import {
  DerivativePreviewService,
  InMemoryPreviewStore,
} from "#src/derivatives/derivativePreviewService.js";

function contract(strike: number, drift = false): DerivativeContract {
  return {
    identity: {
      assetClass: "FOP",
      underlying: "NQ",
      expiration: "2026-08-21",
      strike,
      right: "PUT",
      tradingClass: "QN3",
      exchange: "CME",
      multiplier: 20,
      settlement: "PM",
      exerciseStyle: "AMERICAN",
    },
    brokerReference: {
      broker: "ibkr",
      contractId: String((strike === 26400 ? 892767804 : 892767774) + (drift ? 1 : 0)),
    },
  };
}

class FakeDiscovery implements DerivativeDiscoveryClient {
  drift = false;
  getExpiries = () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z"));
  getContracts = () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z"));
  getChain = () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z"));
  getReferenceQuote = () => Promise.reject(new Error("not used"));
  resolveContract = (request: { strike: number }) =>
    Promise.resolve(observe(contract(request.strike, this.drift), "available", "2026-07-29T12:00:00.000Z"));
}

class FakePreviewClient implements DerivativePreviewClient {
  environment: "paper" | "live" = "paper";
  getTradingDiagnostics() {
    return Promise.resolve({
      accountId: "U1234567",
      environment: this.environment,
      authenticated: true,
      competingSession: false,
      marketDataAvailable: true,
      advisoryAssetPermissions: [],
      state: "ready" as const,
      readReady: true,
      newMutationReady: false,
      recoveryMutationReady: false,
      lockOwned: true,
      accountVerified: true,
      connected: true,
      lastTickleAt: null,
      nextRenewalAt: null,
      lastBrokerRequestAt: null,
      readQueueDepth: 0,
      pendingWarnings: 0,
      reconciliationRequiredOperations: 0,
    });
  }

  previewDerivativeCombo(_request: Parameters<DerivativePreviewClient["previewDerivativeCombo"]>[0]) {
    return Promise.resolve({
      environment: this.environment,
      accepted: true,
      submitted: false as const,
      commission: 2.5,
      initialMargin: { current: 10_000, change: 3220, after: 13_220 },
      maintenanceMargin: { current: 9000, change: 3000, after: 12_000 },
      warnings: [],
      rejectionReasons: [],
      advisoryAssetPermissions: ["STK"],
    });
  }
}

class FakeExecutionClient implements DerivativeExecutionClient {
  submitted?: DerivativeComboExecutionRequest;
  canceled = false;
  canceledRequest?: unknown;
  submitResult: DerivativeOrderSubmissionResult = {
    state: "accepted",
    orderId: "777",
    status: "WORKING",
    clientOrderId: null,
    warnings: [],
  };
  acknowledgeResults: DerivativeOrderSubmissionResult[] = [];
  statuses: DerivativeOrderLifecycle[] = [];

  submitDerivativeCombo(request: DerivativeComboExecutionRequest) {
    this.submitted = request;
    return Promise.resolve(this.submitResult);
  }

  acknowledgeOrderWarning(_input: { replyId: string; confirmed: true }) {
    const result = this.acknowledgeResults.shift();
    return result === undefined
      ? Promise.reject(new Error("missing acknowledgment fixture"))
      : Promise.resolve(result);
  }

  getDerivativeOrderStatus(accountId: string, orderId: string) {
    const fixture = this.statuses.shift();
    if (fixture !== undefined) return Promise.resolve(fixture);
    return Promise.resolve(this.lifecycle(accountId, orderId, "WORKING"));
  }

  cancelDerivativeOrder(input: {
    accountId: string;
    orderId: string;
    assetClass: "OPT" | "FOP";
    extOperator: string;
    manualIndicator: boolean;
  }) {
    this.canceled = true;
    this.canceledRequest = input;
    return Promise.resolve();
  }

  lifecycle(
    accountId: string,
    orderId: string,
    status: DerivativeOrderLifecycle["status"]
  ): DerivativeOrderLifecycle {
    return {
      accountId,
      orderId,
      clientOrderId: this.submitted?.clientOrderId ?? "huskly-test",
      status,
      quantity: 1,
      filledQuantity: status === "FILLED" ? 1 : 0,
      remainingQuantity: status === "FILLED" || status === "CANCELED" ? 0 : 1,
      averagePrice: status === "FILLED" ? -38.5 : null,
      limitPrice: -39,
      commissionAndFees: status === "FILLED" ? 2.5 : null,
      legs: [
        { conid: 892767804, ratio: 1 },
        { conid: 892767774, ratio: -1 },
      ],
      updatedAt: "2026-07-29T12:00:00.000Z",
    };
  }
}

const fixedNow = new Date("2026-07-29T12:00:00.000Z");

async function setup() {
  const discovery = new FakeDiscovery();
  const previewClient = new FakePreviewClient();
  const execution = new FakeExecutionClient();
  const previews = new DerivativePreviewService(
    discovery,
    previewClient,
    () => fixedNow,
    60_000,
    new InMemoryPreviewStore()
  );
  const preview = await previews.previewVertical({
    kind: "put-credit",
    assetClass: "FOP",
    underlying: "NQ",
    expiration: "2026-08-21",
    tradingClass: "QN3",
    exchange: "CME",
    longStrike: 26400,
    shortStrike: 26600,
    quantity: 1,
    priceEffect: "CREDIT",
    limit: 39,
    tif: "DAY",
    session: "REGULAR",
  });
  const state = new InMemoryExecutionStateStore();
  const service = new DerivativeExecutionService(
    discovery,
    previewClient,
    execution,
    previews,
    state,
    () => fixedNow,
    () => Promise.resolve(),
    { enabled: false, accountAllowlist: [] }
  );
  return { discovery, previewClient, execution, previews, preview, state, service };
}

void test("confirmed submission revalidates and verifies the exact preview", async () => {
  const { service, execution, preview, previews } = await setup();
  const result = await service.submit({
    previewId: preview.previewId,
    accountId: "U1234567",
    operator: "felipecsl",
    confirm: true,
  });
  assert.equal(result.state, "accepted");
  assert.equal(result.account.maskedId, "U***567");
  const submitted = execution.submitted;
  assert.ok(submitted);
  assert.equal(submitted.manualIndicator, true);
  assert.equal(submitted.extOperator, "felipecsl");
  assert.equal(submitted.limit, 39);
  assert.deepEqual(
    submitted.legs.map(({ contract: item, ratio }) => [item.brokerReference?.contractId, ratio]),
    [
      ["892767804", 1],
      ["892767774", -1],
    ]
  );
  await assert.rejects(
    () =>
      previews.validatePreview(preview.previewId),
    /Unknown preview ID/
  );
});

void test("submission rejects contract drift and unallowlisted live accounts", async () => {
  const drifted = await setup();
  drifted.discovery.drift = true;
  await assert.rejects(
    () =>
      drifted.service.submit({
        previewId: drifted.preview.previewId,
        accountId: "U1234567",
        operator: "felipecsl",
        confirm: true,
      }),
    /contract drifted/
  );
  assert.equal(drifted.execution.submitted, undefined);

  const live = await setup();
  live.previewClient.environment = "live";
  await assert.rejects(
    () =>
      live.service.submit({
        previewId: live.preview.previewId,
        accountId: "U1234567",
        operator: "felipecsl",
        confirm: true,
      }),
    /explicit enablement.*allowlisting/
  );
});

void test("known warnings require exact acknowledgment and unknown warnings stop", async () => {
  const known = await setup();
  known.execution.submitResult = {
    state: "warning",
    warnings: [
      {
        replyId: "reply-1",
        messages: ["Percentage constraint"],
        messageIds: ["o163"],
        known: true,
      },
    ],
  };
  const pending = await known.service.submit({
    previewId: known.preview.previewId,
    accountId: "U1234567",
    operator: "felipecsl",
    confirm: true,
  });
  assert.equal(pending.state, "warning");
  assert.equal(pending.status, "WARNING_PENDING");
  known.execution.acknowledgeResults.push({
    state: "accepted",
    orderId: "777",
    status: "WORKING",
    clientOrderId: null,
    warnings: [],
  });
  assert.equal(
    (
      await known.service.acknowledgeWarning({
        previewId: known.preview.previewId,
        replyId: "reply-1",
        accountId: "U1234567",
        confirm: true,
      })
    ).state,
    "accepted"
  );

  const unknown = await setup();
  unknown.execution.submitResult = {
    state: "warning",
    warnings: [{ replyId: "reply-x", messages: ["Unknown"], messageIds: ["x999"], known: false }],
  };
  await unknown.service.submit({
    previewId: unknown.preview.previewId,
    accountId: "U1234567",
    operator: "felipecsl",
    confirm: true,
  });
  await assert.rejects(
    () =>
      unknown.service.acknowledgeWarning({
        previewId: unknown.preview.previewId,
        replyId: "reply-x",
        accountId: "U1234567",
        confirm: true,
      }),
    /Unknown broker warning/
  );
});

void test("preserves recovery-required submission evidence without accepting the order", async () => {
  const context = await setup();
  context.execution.submitResult = {
    state: "recovery_required",
    reasons: ["Ambiguous broker response"],
    orders: [{ orderId: "777", status: "UNKNOWN", clientOrderId: "huskly-test" }],
    warnings: [],
    errors: [
      {
        message: "Broker response was incomplete",
        code: null,
        statusCode: null,
        details: {},
      },
    ],
    unrecognizedResponses: [{ raw: true }],
  };

  const result = await context.service.submit({
    previewId: context.preview.previewId,
    accountId: "U1234567",
    operator: "felipecsl",
    confirm: true,
  });

  assert.equal(result.state, "recovery_required");
  assert.ok(result.recovery);
  assert.deepEqual(result.recovery.reasons, ["Ambiguous broker response"]);
  assert.equal(result.recovery.orders[0]?.orderId, "777");
});

void test("post-submit verification rejects changed legs or economics", async () => {
  const { service, execution, preview } = await setup();
  const mismatch = execution.lifecycle("U1234567", "777", "WORKING");
  mismatch.legs = [{ conid: 892767804, ratio: 1 }];
  execution.statuses.push(mismatch);
  await assert.rejects(
    () =>
      service.submit({
        previewId: preview.previewId,
        accountId: "U1234567",
        operator: "felipecsl",
        confirm: true,
      }),
    /legs or ratios/
  );
});

void test("watch and cancel require verified terminal lifecycle states", async () => {
  const context = await setup();
  await context.service.submit({
    previewId: context.preview.previewId,
    accountId: "U1234567",
    operator: "felipecsl",
    confirm: true,
  });
  context.execution.statuses.push(
    context.execution.lifecycle("U1234567", "777", "PARTIALLY_FILLED"),
    context.execution.lifecycle("U1234567", "777", "FILLED")
  );
  assert.equal(
    (
      await context.service.watch({
        orderId: "777",
        accountId: "U1234567",
        timeoutMs: 1000,
        pollMs: 0,
      })
    ).status,
    "FILLED"
  );

  context.execution.statuses.push(
    context.execution.lifecycle("U1234567", "777", "WORKING"),
    context.execution.lifecycle("U1234567", "777", "CANCELED")
  );
  assert.equal(
    (
      await context.service.cancel({
        orderId: "777",
        accountId: "U1234567",
        operator: "felipecsl",
        confirm: true,
        timeoutMs: 1000,
        pollMs: 0,
      })
    ).status,
    "CANCELED"
  );
  assert.equal(context.execution.canceled, true);
  assert.deepEqual(context.execution.canceledRequest, {
    accountId: "U1234567",
    orderId: "777",
    assetClass: "FOP",
    extOperator: "felipecsl",
    manualIndicator: true,
  });
});

void test("file execution state validates persisted expectations without storing account IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-execution-state-"));
  try {
    const { preview } = await setup();
    const store = new FileExecutionStateStore(directory);
    await store.saveOrder({
      orderId: "777",
      previewId: preview.previewId,
      accountDigest: "a".repeat(64),
      environment: "paper",
      clientOrderId: "huskly-test",
      preview,
    });
    const [filename] = await readdir(join(directory, "orders"));
    assert.ok(filename);
    const persisted = await readFile(join(directory, "orders", filename), "utf8");
    assert.doesNotMatch(persisted, /U1234567/);
    assert.equal((await store.loadOrder("777"))?.orderId, "777");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
