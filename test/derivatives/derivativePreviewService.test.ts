import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observe } from "#src/brokers/brokerClient.js";
import type {
  DerivativeContract,
  DerivativeDiscoveryClient,
} from "#src/derivatives/derivativeDiscovery.js";
import type { DerivativePreviewClient } from "#src/derivatives/derivativePreview.js";
import {
  DerivativePreviewService,
  FilePreviewStore,
  maskAccountId,
  type PreviewVerticalRequest,
} from "#src/derivatives/derivativePreviewService.js";

function contract(strike: number): DerivativeContract {
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
    brokerReference: { broker: "ibkr", contractId: strike === 26400 ? "892767804" : "892767774" },
  };
}

const discovery: DerivativeDiscoveryClient = {
  getExpiries: () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z")),
  getContracts: () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z")),
  resolveContract: (request) =>
    Promise.resolve(observe(contract(request.strike), "available", "2026-07-29T12:00:00.000Z")),
  getChain: () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z")),
  getReferenceQuote: () => Promise.reject(new Error("not used")),
};

const preview: DerivativePreviewClient = {
  getTradingDiagnostics: () =>
    Promise.resolve({
      accountId: "U1234567",
      maskedAccountDisplay: "U***567",
      environment: "paper",
      authenticated: true,
      competingSession: false,
      marketDataAvailable: true,
      advisoryAssetPermissions: [],
      state: "ready",
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
    }),
  previewDerivativeCombo: (_request) =>
    Promise.resolve({
      environment: "paper",
      accepted: true,
      submitted: false,
      commission: 2.5,
      initialMargin: { current: 10_000, change: 3220, after: 13_220 },
      maintenanceMargin: { current: 9000, change: 3000, after: 12_000 },
      warnings: [],
      rejectionReasons: [],
      advisoryAssetPermissions: ["STK"],
    }),
};

function request(overrides: Partial<PreviewVerticalRequest> = {}): PreviewVerticalRequest {
  return {
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
    ...overrides,
  };
}

void test("preview DTO masks the account and binds exact economic terms", async () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  let outgoingPreviewRequest: unknown;
  const service = new DerivativePreviewService(
    discovery,
    {
      ...preview,
      previewDerivativeCombo: (request) => {
        outgoingPreviewRequest ??= request;
        return preview.previewDerivativeCombo(request);
      },
    },
    () => now,
    60_000
  );
  const first = await service.previewVertical(request());
  const changed = await service.previewVertical(request({ limit: 38 }));

  assert.deepEqual(outgoingPreviewRequest, {
    legs: [
      { contract: contract(26400), ratio: 1 },
      { contract: contract(26600), ratio: -1 },
    ],
    quantity: 1,
    priceEffect: "CREDIT",
    limit: 39,
    tif: "DAY",
    session: "REGULAR",
  });
  assert.equal("accountId" in (outgoingPreviewRequest as Record<string, unknown>), false);
  assert.equal("clientOrderId" in (outgoingPreviewRequest as Record<string, unknown>), false);
  assert.equal(first.account.maskedId, "U***567");
  assert.equal(first.order.kind, "put-credit");
  assert.equal(first.order.gateway.orderType, "LMT");
  assert.equal(first.submitted, false);
  assert.equal(first.whatIf.initialMargin?.change, 3220);
  assert.equal(first.order.legs[0].contract.identity.strike, 26400);
  assert.notEqual(first.previewId, changed.previewId);
  assert.deepEqual(await service.validatePreview(first.previewId), first);
});

void test("preview validation rejects at the exact expiry boundary and keeps the last valid instant", async () => {
  let now = new Date("2026-07-29T12:00:00.000Z");
  const service = new DerivativePreviewService(discovery, preview, () => now, 60_000);
  const result = await service.previewVertical(request());
  now = new Date("2026-07-29T12:00:59.999Z");
  assert.equal((await service.validatePreview(result.previewId)).previewId, result.previewId);
  now = new Date("2026-07-29T12:01:00.000Z");
  await assert.rejects(() => service.validatePreview(result.previewId), /expired/);
});

void test("preview ignores diagnostics account authority and keeps only masked display", async () => {
  const service = new DerivativePreviewService(
    discovery,
    {
      ...preview,
      getTradingDiagnostics: () =>
        Promise.resolve({
          accountId: "DIFFERENT",
          maskedAccountDisplay: "U***567",
          environment: "paper",
          authenticated: false,
          competingSession: true,
          marketDataAvailable: null,
          advisoryAssetPermissions: [],
          state: "degraded",
          readReady: false,
          newMutationReady: false,
          recoveryMutationReady: false,
          lockOwned: false,
          accountVerified: false,
          connected: null,
          lastTickleAt: null,
          nextRenewalAt: null,
          lastBrokerRequestAt: null,
          readQueueDepth: 99,
          pendingWarnings: 1,
          reconciliationRequiredOperations: 2,
        }),
    },
    () => new Date("2026-07-29T12:00:00.000Z"),
    60_000
  );

  const result = await service.previewVertical(request());
  assert.equal(result.account.maskedId, "U***567");
});

void test("file preview store round-trips the canonical gateway intent without persisting authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-preview-test-"));
  try {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const writer = new DerivativePreviewService(
      discovery,
      preview,
      () => now,
      60_000,
      new FilePreviewStore(directory)
    );
    const result = await writer.previewVertical(request());
    const reader = new DerivativePreviewService(
      discovery,
      preview,
      () => now,
      60_000,
      new FilePreviewStore(directory)
    );
    assert.equal((await reader.validatePreview(result.previewId)).previewId, result.previewId);
    const [filename] = await readdir(directory);
    assert.ok(filename);
    const persisted = await readFile(join(directory, filename), "utf8");
    assert.doesNotMatch(persisted, /U1234567/);
    assert.doesNotMatch(persisted, /clientOrderId/);
    const parsed = JSON.parse(persisted) as {
      schemaVersion: number;
      canonicalIntent: { orderType: string };
      previewResult: { accepted: boolean };
    };
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.canonicalIntent.orderType, "LMT");
    assert.equal(parsed.previewResult.accepted, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("stores rejected previews and never submits during preview", async () => {
  let previewCalls = 0;
  const rejectedPreview: DerivativePreviewClient = {
    getTradingDiagnostics: () =>
      Promise.resolve({
        accountId: "U1234567",
        maskedAccountDisplay: "U***567",
        environment: "paper",
        authenticated: true,
        competingSession: false,
        marketDataAvailable: true,
        advisoryAssetPermissions: [],
        state: "ready",
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
      }),
    previewDerivativeCombo: () => {
      previewCalls += 1;
      return Promise.resolve({
        environment: "paper",
        accepted: false,
        submitted: false,
        commission: null,
        initialMargin: null,
        maintenanceMargin: null,
        warnings: ["Permissions missing"],
        rejectionReasons: ["Risk rejected"],
        advisoryAssetPermissions: [],
      });
    },
  };

  const directory = await mkdtemp(join(tmpdir(), "huskly-preview-test-"));
  try {
    const service = new DerivativePreviewService(
      discovery,
      rejectedPreview,
      () => new Date("2026-07-29T12:00:00.000Z"),
      60_000,
      new FilePreviewStore(directory)
    );
    const result = await service.previewVertical(request());
    assert.equal(previewCalls, 1);
    assert.equal(result.submitted, false);
    assert.equal(result.whatIf.accepted, false);
    await assert.rejects(() => service.validatePreview(result.previewId), /rejected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("account masking covers short paper fixtures", () => {
  assert.equal(maskAccountId("DU123456"), "D***456");
  assert.equal(maskAccountId("DU12"), "D***");
  assert.equal(maskAccountId("U1"), "U***");
});

void test("breaking old persisted preview formats is required", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-preview-test-"));
  try {
    const store = new FilePreviewStore(directory);
    await writeFile(
      join(directory, `${"a".repeat(64)}.json`),
      JSON.stringify({ dto: { previewId: "a".repeat(64) } }),
      { mode: 0o600 }
    );
    await chmod(join(directory, `${"a".repeat(64)}.json`), 0o600);
    await assert.rejects(() => store.load("a".repeat(64)), /schema|version|invalid/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
