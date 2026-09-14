import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import { FileExecutionStateStore } from "../../src/derivatives/derivativeExecutionService.js";
import type {
  CanonicalEquityIntent,
  EquityGatewayClient,
  EquityTradingDiagnostics,
} from "../../src/equities/equityOrder.js";
import {
  EquityOrderService,
  FileEquityPreviewStore,
  FileEquitySubmissionStore,
  InMemoryEquityPreviewStore,
  InMemoryEquitySubmissionStore,
  type EquityPreviewStore,
  type EquitySubmissionStore,
} from "../../src/equities/equityOrderService.js";

const contract = {
  conid: 8314,
  assetClass: "STK",
  symbol: "IBIT",
  exchange: "SMART",
  primaryExchange: "NASDAQ",
  currency: "USD",
} as const;
const operation = {
  operationId: "operation-1",
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
  createdAt: "2026-09-14T12:00:00.000Z",
  latestTransitionAt: "2026-09-14T12:00:01.000Z",
} as OrderOperation;

class Gateway implements EquityGatewayClient {
  public diagnostics: EquityTradingDiagnostics = {
    environment: "paper",
    accountVerified: true,
    newMutationReady: true,
  };
  public accepted = true;
  public resolveCalls: string[] = [];
  public previewCalls: CanonicalEquityIntent[] = [];
  public createCalls: { intent: CanonicalEquityIntent; key: string; operator: string }[] = [];
  public lookupCalls: string[] = [];
  public created = Promise.resolve();
  public releaseCreate: (() => void) | undefined;

  public getTradingDiagnostics() {
    return Promise.resolve(this.diagnostics);
  }
  public resolveContract(symbol: string) {
    this.resolveCalls.push(symbol);
    return Promise.resolve({ ...contract, symbol });
  }
  public preview(intent: CanonicalEquityIntent) {
    this.previewCalls.push(intent);
    return Promise.resolve({
      environment: this.diagnostics.environment,
      accepted: this.accepted,
      submitted: false as const,
      commission: 1,
      initialMargin: null,
      maintenanceMargin: null,
      warnings: [],
      rejectionReasons: this.accepted ? [] : ["rejected"],
      advisoryAssetPermissions: [],
    });
  }
  public async create(intent: CanonicalEquityIntent, key: string, operator: string) {
    this.createCalls.push({ intent, key, operator });
    await this.created;
    return operation;
  }
  public async lookup(key: string) {
    this.lookupCalls.push(key);
    await this.created;
    return operation;
  }
}

function service(
  gateway = new Gateway(),
  previews: EquityPreviewStore = new InMemoryEquityPreviewStore(),
  submissions: EquitySubmissionStore = new InMemoryEquitySubmissionStore(),
  now = () => new Date("2026-09-14T12:00:00.000Z")
) {
  return {
    gateway,
    previews,
    submissions,
    value: new EquityOrderService(
      gateway,
      previews,
      submissions,
      now,
      60_000,
      () => "00000000-0000-4000-8000-000000000001",
      () => "00000000-0000-4000-8000-000000000002"
    ),
  };
}

async function preview(value: EquityOrderService) {
  return value.preview({ symbol: " ibit ", side: "BUY", quantity: 2, limit: 52.25 });
}

test("preview resolves one exact contract and stores canonical defaults without submitting", async () => {
  const fx = service();
  const result = await preview(fx.value);
  assert.deepEqual(fx.gateway.resolveCalls, ["IBIT"]);
  assert.equal(fx.gateway.createCalls.length, 0);
  assert.equal(result.submitted, false);
  assert.equal(result.environment, "paper");
  assert.deepEqual(result.order, {
    contract,
    side: "BUY",
    quantity: 2,
    tif: "DAY",
    session: "REGULAR",
    orderType: "LMT",
    limit: 52.25,
  });
  assert.match(result.previewId, /^[a-f0-9]{64}$/);
  assert.equal((await fx.previews.load(result.previewId))?.schemaVersion, 1);
});

test("rejected What-If remains visible but cannot be submitted", async () => {
  const fx = service();
  fx.gateway.accepted = false;
  const result = await preview(fx.value);
  assert.equal(result.whatIf.accepted, false);
  await assert.rejects(
    fx.value.submit({ previewId: result.previewId, operator: "operator-7", confirm: true }),
    /rejected/u
  );
  assert.equal(fx.gateway.createCalls.length, 0);
});

test("submit loads every economic term from the preview and binds the operator", async () => {
  const fx = service();
  const result = await preview(fx.value);
  const submitted = await fx.value.submit({
    previewId: result.previewId,
    operator: "operator-7",
    confirm: true,
  });
  assert.equal(submitted.recovered, false);
  assert.equal(submitted.operation.operationId, "operation-1");
  assert.deepEqual(fx.gateway.createCalls, [
    {
      intent: result.order,
      key: "00000000-0000-4000-8000-000000000002",
      operator: "operator-7",
    },
  ]);
  await assert.rejects(
    fx.value.submit({ previewId: result.previewId, operator: "other", confirm: true }),
    /does not match/u
  );
});

test("confirmation expiry environment and content binding fail before a write", async () => {
  let current = new Date("2026-09-14T12:00:00.000Z");
  const fx = service(undefined, undefined, undefined, () => current);
  const result = await preview(fx.value);
  await assert.rejects(
    fx.value.submit({
      previewId: result.previewId,
      operator: "operator-7",
      confirm: false,
    }),
    /exactly true/u
  );
  fx.gateway.diagnostics = { ...fx.gateway.diagnostics, environment: "live" };
  await assert.rejects(
    fx.value.submit({ previewId: result.previewId, operator: "operator-7", confirm: true }),
    /environment/u
  );
  fx.gateway.diagnostics = { ...fx.gateway.diagnostics, environment: "paper" };
  current = new Date("2026-09-14T12:01:00.000Z");
  await assert.rejects(
    fx.value.submit({ previewId: result.previewId, operator: "operator-7", confirm: true }),
    /expired/u
  );
  assert.equal(fx.gateway.createCalls.length, 0);
});

test("hash corruption fails closed before diagnostics or a write", async () => {
  const base = service();
  const result = await preview(base.value);
  const stored = await base.previews.load(result.previewId);
  assert.ok(stored);
  const corrupt: EquityPreviewStore = {
    create: () => Promise.resolve(false),
    load: () =>
      Promise.resolve({
        ...stored,
        canonicalIntent: { ...stored.canonicalIntent, quantity: 3 },
      }),
    delete: () => Promise.resolve(),
  };
  const next = service(base.gateway, corrupt).value;
  await assert.rejects(
    next.submit({ previewId: result.previewId, operator: "operator-7", confirm: true }),
    /hash mismatch/u
  );
  assert.equal(base.gateway.createCalls.length, 0);
});

test("two service instances reserve once and make one network write", async () => {
  let release!: () => void;
  const gateway = new Gateway();
  gateway.created = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previews = new InMemoryEquityPreviewStore();
  const submissions = new InMemoryEquitySubmissionStore();
  const first = service(gateway, previews, submissions).value;
  const second = service(gateway, previews, submissions).value;
  const result = await preview(first);
  const input = { previewId: result.previewId, operator: "operator-7", confirm: true as const };
  const firstCall = first.submit(input);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const secondCall = second.submit(input);
  release();
  const values = await Promise.all([firstCall, secondCall]);
  assert.equal(gateway.createCalls.length, 1);
  assert.equal(gateway.lookupCalls.length, 0);
  assert.deepEqual(
    values.map((value) => value.operation.operationId),
    ["operation-1", "operation-1"]
  );
});

test("shared lifecycle storage indexes an equity operation for generic tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "huskly-equity-lifecycle-"));
  try {
    const gateway = new Gateway();
    const previews = new InMemoryEquityPreviewStore();
    const submissions = new FileEquitySubmissionStore(root);
    const value = service(gateway, previews, submissions).value;
    const result = await preview(value);
    await value.submit({
      previewId: result.previewId,
      operator: "operator-7",
      confirm: true,
    });
    const shared = await new FileExecutionStateStore(root).loadSubmissionByOperation("operation-1");
    assert.equal(shared?.operationKind, "single");
    assert.deepEqual(shared.canonicalIntent, result.order);
    assert.equal(shared.operation?.operationId, "operation-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file stores use private modes atomic create and strict schemas", async () => {
  const root = await mkdtemp(join(tmpdir(), "huskly-equity-"));
  const previewDirectory = join(root, "previews");
  const submissionDirectory = join(root, "submissions");
  try {
    const gateway = new Gateway();
    const previews = new FileEquityPreviewStore(previewDirectory);
    const submissions = new FileEquitySubmissionStore(submissionDirectory);
    const value = service(gateway, previews, submissions).value;
    const result = await preview(value);
    const stored = await previews.load(result.previewId);
    assert.ok(stored);
    assert.equal((await stat(previewDirectory)).mode & 0o777, 0o700);
    const path = join(previewDirectory, `${result.previewId}.json`);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await previews.create(stored), false);
    const source = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    source["schemaVersion"] = 2;
    await writeFile(path, JSON.stringify(source), { mode: 0o600 });
    await assert.rejects(previews.load(result.previewId), /validation|parse|JSON/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
