import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DerivativeContract, DerivativeDiscoveryClient } from "./derivativeDiscovery.js";
import type { DerivativePreviewClient } from "./derivativePreview.js";
import {
  DerivativePreviewService,
  FilePreviewStore,
  maskAccountId,
  type PreviewVerticalRequest,
} from "./derivativePreviewService.js";

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
    },
    brokerReference: { broker: "ibkr", contractId: strike === 26400 ? "892767804" : "892767774" },
  };
}

const discovery: DerivativeDiscoveryClient = {
  getExpiries: () => Promise.resolve([]),
  getContracts: () => Promise.resolve([]),
  resolveContract: (request) => Promise.resolve(contract(request.strike)),
  getChain: () => Promise.resolve([]),
  getReferenceQuote: () => Promise.reject(new Error("not used")),
};

const preview: DerivativePreviewClient = {
  getTradingDiagnostics: (accountId) =>
    Promise.resolve({
      accountId,
      selectedAccountId: accountId,
      environment: "paper",
      authenticated: true,
      competingSession: false,
      marketDataAvailable: true,
      advisoryAssetPermissions: ["STK"],
    }),
  previewDerivativeCombo: (request) =>
    Promise.resolve({
      accountId: request.accountId,
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
    accountId: "U1234567",
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
  const service = new DerivativePreviewService(discovery, preview, () => now, 60_000);
  const first = await service.previewVertical(request());
  const changed = await service.previewVertical(request({ limit: 38 }));

  assert.equal(first.account.maskedId, "U***567");
  assert.equal(first.submitted, false);
  assert.equal(first.whatIf.initialMargin?.change, 3220);
  assert.equal(first.order.legs[0].contract.identity.strike, 26400);
  assert.notEqual(first.previewId, changed.previewId);
  assert.equal(
    await service.validatePreview(first.previewId, {
      accountId: "U1234567",
      environment: "paper",
    }),
    first
  );
});

void test("preview validation rejects account/environment mismatch and expiry", async () => {
  let now = new Date("2026-07-29T12:00:00.000Z");
  const service = new DerivativePreviewService(discovery, preview, () => now, 60_000);
  const result = await service.previewVertical(request());
  await assert.rejects(
    () => service.validatePreview(result.previewId, { accountId: "U999", environment: "paper" }),
    /account or environment/
  );
  now = new Date("2026-07-29T12:01:00.000Z");
  await assert.rejects(
    () =>
      service.validatePreview(result.previewId, {
        accountId: "U1234567",
        environment: "paper",
      }),
    /expired/
  );
});

void test("file preview store supports separate processes without persisting full account IDs", async () => {
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
    assert.equal(
      (
        await reader.validatePreview(result.previewId, {
          accountId: "U1234567",
          environment: "paper",
        })
      ).previewId,
      result.previewId
    );
    const [filename] = await readdir(directory);
    assert.ok(filename);
    assert.doesNotMatch(await readFile(join(directory, filename), "utf8"), /U1234567/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("account masking covers short paper fixtures", () => {
  assert.equal(maskAccountId("DU123456"), "D***456");
  assert.equal(maskAccountId("DU12"), "D***");
  assert.equal(maskAccountId("U1"), "U***");
});
