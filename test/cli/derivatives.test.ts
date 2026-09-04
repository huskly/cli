import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Command } from "commander";
import { addDerivativeCommands, type DerivativeCommandDependencies } from "#src/cli/derivatives.js";
import type { TradingDiagnostics } from "#src/derivatives/derivativePreview.js";
import type { SpreadPreviewDto } from "#src/derivatives/derivativePreviewService.js";
import type {
  OrderLifecycleDto,
  SubmissionDto,
} from "#src/derivatives/derivativeExecutionService.js";
import type { OrderReconciliationView } from "#src/derivatives/derivativeExecution.js";

function program(dependencies: DerivativeCommandDependencies = {}): Command {
  const command = new Command();
  command.exitOverride();
  addDerivativeCommands(command, () => "ibkr", dependencies);
  return command;
}

function findCommand(root: Command, ...names: string[]): Command {
  let current = root;
  for (const name of names) {
    const next = current.commands.find((command) => command.name() === name);
    assert.ok(next, `Expected command ${names.join(" ")}`);
    current = next;
  }
  return current;
}

const previewId = "a".repeat(64);
const operation: SubmissionDto["operation"] = {
  operationId: "op-1",
  kind: "combo",
  action: "submission",
  parentOperationId: null,
  intentSchemaVersion: 1,
  intentHash: "hash",
  state: "warning_pending",
  correlations: [{ memberId: "root", parentMemberId: null, clientOrderId: "client-1" }],
  children: [
    {
      operationId: "child-1",
      action: "warning_acknowledgement",
      state: "accepted",
      createdAt: "2026-09-04T00:00:02.000Z",
      latestTransitionAt: "2026-09-04T00:00:03.000Z",
    },
  ],
  pendingWarning: { sequence: 1, replyId: "reply-1" },
  reconciliation: {
    observedAt: "2026-09-04T00:00:04.000Z",
    status: "incomplete",
    reason: "uncertain",
  },
  result: {
    kind: "warning",
    orders: [
      {
        memberId: "root",
        parentMemberId: null,
        orderId: "777",
        parentOrderId: null,
        clientOrderId: "client-1",
        status: "WARNING_PENDING",
      },
    ],
    warningCount: 1,
  },
  createdAt: "2026-09-04T00:00:00.000Z",
  latestTransitionAt: "2026-09-04T00:00:01.000Z",
};
const submission: SubmissionDto = {
  state: "warning",
  previewId,
  operationId: "op-1",
  operation,
  account: { maskedId: "U***567", environment: "paper" },
  orderId: "777",
  clientOrderId: "client-1",
  status: "WARNING_PENDING",
  updatedAt: "2026-09-04T00:00:01.000Z",
  warnings: [{ replyId: "reply-1", messages: ["secret-body"], messageIds: ["m1"], known: true }],
  rejectionReasons: [],
};
const lifecycle: OrderLifecycleDto = {
  state: "warning",
  previewId,
  operationId: "op-1",
  operation,
  account: { maskedId: "U***567", environment: "paper" },
  updatedAt: "2026-09-04T00:00:01.000Z",
  warnings: [{ replyId: "reply-1", messages: ["secret-body"], messageIds: ["m1"], known: true }],
  rejectionReasons: [],
  verifiedAgainstPreview: true,
  orderId: "777",
  clientOrderId: "client-1",
  status: "WARNING_PENDING",
  quantity: 2,
  filledQuantity: 1,
  remainingQuantity: 1,
  averagePrice: 1.25,
  limitPrice: 1.5,
  commissionAndFees: 0.12,
  legs: [
    { conid: 101, ratio: 1 },
    { conid: 102, ratio: -1 },
  ],
};
const reconciliation: OrderReconciliationView = operation;
const diagnostics: TradingDiagnostics = {
  accountId: "DU1234567",
  maskedAccountDisplay: "U***567",
  environment: "paper",
  authenticated: true,
  competingSession: false,
  marketDataAvailable: true,
  advisoryAssetPermissions: ["futures-options"],
  state: "ready",
  readReady: true,
  newMutationReady: true,
  recoveryMutationReady: true,
  lockOwned: true,
  accountVerified: true,
  connected: true,
  lastTickleAt: "2026-09-04T00:00:00.000Z",
  nextRenewalAt: "2026-09-04T00:05:00.000Z",
  lastBrokerRequestAt: "2026-09-04T00:00:01.000Z",
  readQueueDepth: 0,
  pendingWarnings: 1,
  reconciliationRequiredOperations: 2,
};
const spreadPreview: SpreadPreviewDto = {
  previewId,
  createdAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-09-04T00:05:00.000Z",
  account: { maskedId: "U***567", environment: "paper" },
  order: {
    kind: "put-credit",
    gateway: {
      legs: [
        {
          contract: {
            identity: {
              assetClass: "FOP",
              underlying: "NQ",
              expiration: "2026-09-18",
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
              expiration: "2026-09-18",
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
      quantity: 2,
      tif: "DAY",
      session: "REGULAR",
      priceEffect: "CREDIT",
      orderType: "LMT",
      limit: 1.5,
    },
    legs: [
      {
        side: "LONG",
        ratio: 1,
        contract: {
          identity: {
            assetClass: "FOP",
            underlying: "NQ",
            expiration: "2026-09-18",
            strike: 26400,
            right: "PUT",
            tradingClass: "QN3",
            exchange: "CME",
            multiplier: 20,
          },
          brokerReference: { broker: "ibkr", contractId: "101" },
        },
      },
      {
        side: "SHORT",
        ratio: -1,
        contract: {
          identity: {
            assetClass: "FOP",
            underlying: "NQ",
            expiration: "2026-09-18",
            strike: 26600,
            right: "PUT",
            tradingClass: "QN3",
            exchange: "CME",
            multiplier: 20,
          },
          brokerReference: { broker: "ibkr", contractId: "102" },
        },
      },
    ],
    quantity: 2,
    priceEffect: "CREDIT",
    limit: 1.5,
    tif: "DAY",
    session: "REGULAR",
  },
  whatIf: {
    accepted: true,
    submitted: false,
    commission: 0.5,
    initialMargin: null,
    maintenanceMargin: null,
    warnings: ["known warning"],
    rejectionReasons: [],
    advisoryAssetPermissions: ["futures-options"],
  },
  submitted: false,
};

void test("task 9 command surface removes account inputs and old acknowledgment path", async () => {
  const root = program();
  assert.equal(
    findCommand(root, "spread", "submit").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "spread", "recover").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "order", "show").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "order", "watch").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "order", "acknowledge").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "order", "reconcile").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "order", "cancel").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "broker", "doctor").options.some((option) => option.long === "--account"),
    false
  );
  assert.equal(
    findCommand(root, "spread").commands.some((command) => command.name() === "acknowledge"),
    false
  );
  assert.equal(
    findCommand(root, "order", "acknowledge").options.some((option) => option.long === "--reply"),
    true
  );
  const source = await readFile(new URL("../../src/cli/derivatives.ts", import.meta.url), "utf8");
  assert.equal(source.includes("IBKR_ACCOUNT_ID"), false);
});

void test("every mutation command requires explicit confirmation before service setup", async () => {
  let executionFactoryCalls = 0;
  const root = program({
    createExecutionService: () => {
      executionFactoryCalls++;
      return Promise.reject(new Error("should not initialize execution service"));
    },
  });

  await assert.rejects(
    () => root.parseAsync(["node", "test", "spread", "submit", previewId, "--operator", "tester"]),
    /requires --confirm/
  );
  await assert.rejects(
    () => root.parseAsync(["node", "test", "order", "acknowledge", "op-1", "--reply", "reply-1"]),
    /requires --confirm/
  );
  await assert.rejects(
    () => root.parseAsync(["node", "test", "order", "reconcile", "op-1"]),
    /requires --confirm/
  );
  await assert.rejects(
    () => root.parseAsync(["node", "test", "order", "cancel", "op-1"]),
    /requires --confirm/
  );
  assert.equal(executionFactoryCalls, 0);
});

void test("spread preview safe JSON omits gateway payload internals and broker references", async () => {
  const lines: string[] = [];
  await program({
    createPreviewService: () =>
      Promise.resolve({
        previewVertical: () => Promise.resolve(spreadPreview),
        getTradingDiagnostics: () => Promise.resolve(diagnostics),
      }),
    log: (line) => lines.push(line),
  }).parseAsync([
    "node",
    "test",
    "spread",
    "preview",
    "put-credit",
    "NQ",
    "--expiry",
    "2026-09-18",
    "--long",
    "26400",
    "--short",
    "26600",
    "--credit",
    "1.5",
    "--json",
  ]);

  const json = JSON.parse(lines.join("\n")) as Record<string, unknown>;
  assert.equal(json["previewId"], previewId);
  assert.equal(JSON.stringify(json).includes('"gateway"'), false);
  assert.equal(JSON.stringify(json).includes("brokerReference"), false);
  assert.equal(JSON.stringify(json).includes("101"), false);
});

void test("submission output uses preview and operation ids with safe human and JSON views", async () => {
  const humanLines: string[] = [];
  const jsonLines: string[] = [];
  let submitCalls = 0;
  const dependencies: DerivativeCommandDependencies = {
    createExecutionService: () =>
      Promise.resolve({
        submit: ({ previewId: value, operator, confirm }) => {
          submitCalls++;
          assert.equal(value, previewId);
          assert.equal(operator, "tester");
          assert.equal(confirm, true);
          return Promise.resolve(submission);
        },
        recover: () => Promise.resolve(submission),
        getStatus: () => Promise.resolve(lifecycle),
        watch: () => Promise.resolve(lifecycle),
        acknowledgeWarning: () => Promise.resolve(lifecycle),
        reconcile: () => Promise.resolve(reconciliation),
        cancel: () => Promise.resolve(lifecycle),
      }),
  };

  await program({ ...dependencies, log: (line) => humanLines.push(line) }).parseAsync([
    "node",
    "test",
    "spread",
    "submit",
    previewId,
    "--operator",
    "tester",
    "--confirm",
  ]);
  await program({ ...dependencies, log: (line) => jsonLines.push(line) }).parseAsync([
    "node",
    "test",
    "spread",
    "submit",
    previewId,
    "--operator",
    "tester",
    "--confirm",
    "--json",
  ]);

  assert.equal(submitCalls, 2);
  const human = humanLines.join("\n");
  assert.match(human, /Preview: a{64}/);
  assert.match(human, /Operation: op-1/);
  assert.match(human, /Pending warning: reply reply-1/);
  assert.doesNotMatch(human, /777/);
  assert.doesNotMatch(human, /client-1/);
  assert.doesNotMatch(human, /secret-body/);

  const json = JSON.parse(jsonLines.join("\n")) as Record<string, unknown>;
  assert.equal(json["previewId"], previewId);
  assert.equal((json["account"] as { maskedId: string }).maskedId, "U***567");
  assert.equal((json["operation"] as { operationId: string }).operationId, "op-1");
  assert.equal(JSON.stringify(json).includes("777"), false);
  assert.equal(JSON.stringify(json).includes("client-1"), false);
  assert.equal(JSON.stringify(json).includes("secret-body"), false);
});

void test("operation commands use gateway operation ids and make one service call per command", async () => {
  const calls: { name: string; input: unknown }[] = [];
  const execution = {
    submit: () => Promise.resolve(submission),
    recover: ({ previewId: value }: { previewId: string }) => {
      calls.push({ name: "recover", input: value });
      return Promise.resolve(submission);
    },
    getStatus: (operationId: string) => {
      calls.push({ name: "show", input: operationId });
      return Promise.resolve(lifecycle);
    },
    watch: (input: { operationId: string; timeoutMs: number; pollMs: number }) => {
      calls.push({ name: "watch", input });
      return Promise.resolve(lifecycle);
    },
    acknowledgeWarning: (input: { operationId: string; replyId: string; confirm: true }) => {
      calls.push({ name: "acknowledge", input });
      return Promise.resolve(lifecycle);
    },
    reconcile: (operationId: string) => {
      calls.push({ name: "reconcile", input: operationId });
      return Promise.resolve(reconciliation);
    },
    cancel: (input: { operationId: string; confirm: true }) => {
      calls.push({ name: "cancel", input });
      return Promise.resolve(lifecycle);
    },
  };
  const root = program({
    createExecutionService: () => Promise.resolve(execution),
    log: () => undefined,
  });
  await root.parseAsync(["node", "test", "spread", "recover", previewId]);
  await root.parseAsync(["node", "test", "order", "show", "op-1"]);
  await root.parseAsync([
    "node",
    "test",
    "order",
    "watch",
    "op-1",
    "--timeout",
    "7",
    "--poll",
    "3",
  ]);
  await root.parseAsync([
    "node",
    "test",
    "order",
    "acknowledge",
    "op-1",
    "--reply",
    "reply-1",
    "--confirm",
  ]);
  await root.parseAsync(["node", "test", "order", "reconcile", "op-1", "--confirm"]);
  await root.parseAsync(["node", "test", "order", "cancel", "op-1", "--confirm"]);
  assert.deepEqual(calls, [
    { name: "recover", input: previewId },
    { name: "show", input: "op-1" },
    { name: "watch", input: { operationId: "op-1", timeoutMs: 7000, pollMs: 3000 } },
    { name: "acknowledge", input: { operationId: "op-1", replyId: "reply-1", confirm: true } },
    { name: "reconcile", input: "op-1" },
    { name: "cancel", input: { operationId: "op-1", confirm: true } },
  ]);
});

void test("broker doctor uses gateway diagnostics and only safe account display", async () => {
  const humanLines: string[] = [];
  const jsonLines: string[] = [];
  const dependencies: DerivativeCommandDependencies = {
    createPreviewService: () =>
      Promise.resolve({
        previewVertical: () => Promise.resolve(spreadPreview),
        getTradingDiagnostics: () => Promise.resolve(diagnostics),
      }),
  };

  await program({ ...dependencies, log: (line) => humanLines.push(line) }).parseAsync([
    "node",
    "test",
    "broker",
    "doctor",
  ]);
  await program({ ...dependencies, log: (line) => jsonLines.push(line) }).parseAsync([
    "node",
    "test",
    "broker",
    "doctor",
    "--json",
  ]);

  const human = humanLines.join("\n");
  assert.match(human, /Account: U\*\*\*567/);
  assert.doesNotMatch(human, /DU1234567/);
  const json = JSON.parse(jsonLines.join("\n")) as Record<string, unknown>;
  assert.equal((json["account"] as { maskedId: string }).maskedId, "U***567");
  assert.equal(JSON.stringify(json).includes("DU1234567"), false);
});
