import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Command } from "commander";
import {
  addDerivativeCommands,
  renderVerticalSpread,
  type DerivativeCommandDependencies,
} from "#src/cli/derivatives.js";
import { BrokerDataUnavailableError, observe } from "#src/brokers/brokerClient.js";
import type {
  DerivativeQuote,
  DerivativeReferenceQuote,
} from "#src/derivatives/derivativeDiscovery.js";
import type { VerticalSpreadResearch } from "#src/derivatives/derivativeResearch.js";
import { buildVerticalSpread } from "#src/derivatives/verticalSpread.js";
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
  warnings: [
    { sequence: 1, replyId: "reply-1", messages: ["secret-body"], messageIds: ["m1"], known: true },
  ],
  rejectionReasons: [],
};
const lifecycle: OrderLifecycleDto = {
  state: "warning",
  previewId,
  operationId: "op-1",
  operation,
  account: { maskedId: "U***567", environment: "paper" },
  updatedAt: "2026-09-04T00:00:01.000Z",
  warnings: [
    { sequence: 1, replyId: "reply-1", messages: ["secret-body"], messageIds: ["m1"], known: true },
  ],
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
  const removedAccountEnv = ["IBKR", "ACCOUNT", "ID"].join("_");
  assert.equal(source.includes(removedAccountEnv), false);
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
  const output: string[] = [];
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
    log: (line) => output.push(line),
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
  await root.parseAsync(["node", "test", "order", "reconcile", "op-1", "--confirm", "--json"]);
  await root.parseAsync(["node", "test", "order", "cancel", "op-1", "--confirm"]);
  const reconciliationOutput = output.find((line) => line.trimStart().startsWith("{"));
  assert.ok(reconciliationOutput);
  const reconciliationView = JSON.parse(reconciliationOutput) as {
    operation: { operationId: string };
    observation: OrderReconciliationView["reconciliation"];
  };
  assert.equal(reconciliationView.operation.operationId, "op-1");
  assert.deepEqual(reconciliationView.observation, operation.reconciliation);
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

void test("CLI spread presentation labels the weakest partial leg evidence", () => {
  const quote = (strike: number, bid: number, ask: number): DerivativeQuote => ({
    contract: {
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
      brokerReference: { broker: "ibkr", contractId: String(strike) },
    },
    dataAvailability: "live",
    timestamp: null,
    bid,
    ask,
    last: null,
    mark: (bid + ask) / 2,
    delta: null,
    impliedVolatility: null,
    volume: null,
    openInterest: null,
  });
  const long = quote(26400, 291, 297);
  const short = quote(26600, 330.5, 337.5);
  const spread = buildVerticalSpread({
    kind: "put-credit",
    quantity: 1,
    longQuote: long,
    shortQuote: short,
  });
  const reference: DerivativeReferenceQuote = {
    brokerReference: { broker: "ibkr", contractId: "770561204" },
    symbol: "NQ",
    dataAvailability: "live",
    timestamp: null,
    bid: 27865,
    ask: 27866.5,
    last: 27865.5,
    mark: 27864.25,
  };
  const result: VerticalSpreadResearch = {
    referenceQuote: observe(reference, "available", "2026-09-04T00:02:00.000Z"),
    longQuote: observe(long, "partial", "2026-09-04T00:00:00.000Z"),
    shortQuote: observe(short, "available", "2026-09-04T00:01:00.000Z"),
    observation: observe(spread, "partial", "2026-09-04T00:00:00.000Z"),
    spread,
    pricingNotice: "Synthetic leg evidence.",
  };
  const rendered = renderVerticalSpread(result);
  assert.match(rendered, /Evidence: \[partial @ 2026-09-04T00:00:00.000Z\]/u);
  assert.match(rendered, /Long .*\[partial @/u);
  assert.match(rendered, /Reference .*\[available @/u);
});

void test("CLI lifecycle JSON keeps unavailable account and broker lifecycle facts null", async () => {
  const lines: string[] = [];
  const unavailable: OrderLifecycleDto = {
    ...lifecycle,
    account: { maskedId: null, environment: null },
    orderId: null,
    clientOrderId: null,
    status: null,
    quantity: null,
    filledQuantity: null,
    remainingQuantity: null,
    averagePrice: null,
    limitPrice: null,
    commissionAndFees: null,
  };
  const root = program({
    createExecutionService: () =>
      Promise.resolve({
        submit: () => Promise.resolve(submission),
        recover: () => Promise.resolve(submission),
        getStatus: () => Promise.resolve(unavailable),
        watch: () => Promise.resolve(unavailable),
        acknowledgeWarning: () => Promise.resolve(unavailable),
        reconcile: () => Promise.resolve(reconciliation),
        cancel: () => Promise.resolve(unavailable),
      }),
    log: (line) => lines.push(line),
  });
  await root.parseAsync(["node", "test", "order", "show", "op-1", "--json"]);
  const body = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  assert.deepEqual(body["account"], { maskedId: null, environment: null });
  assert.equal(body["quantity"], null);
  assert.equal(body["filledQuantity"], null);
  assert.equal(body["remainingQuantity"], null);
  assert.equal(JSON.stringify(body).includes('"orderId":"op-1"'), false);
});

void test("CLI spread quote preserves empty and unavailable leg failures", async () => {
  for (const error of [
    new Error("No exact market quote returned for the empty leg"),
    new BrokerDataUnavailableError("queryDerivativeQuotes"),
  ]) {
    const root = program({
      createResearchService: () =>
        Promise.resolve({
          discover: () => Promise.reject(new Error("unused")),
          chain: () => Promise.reject(new Error("unused")),
          quoteVertical: () => Promise.reject(error),
        }),
    });
    await assert.rejects(
      () =>
        root.parseAsync([
          "node",
          "test",
          "spread",
          "quote",
          "put-credit",
          "NQ",
          "--expiry",
          "2026-08-21",
          "--long",
          "26400",
          "--short",
          "26600",
          "--quantity",
          "1",
        ]),
      error.name === "BrokerDataUnavailableError" ? /Broker data is unavailable/u : /empty leg/u
    );
  }
});
