import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { addEquityCommands, type EquityCommandDependencies } from "#src/cli/equityOrders.js";
import { chooseBroker } from "#src/cli/shared.js";
import type { EquityPreviewDto, EquitySubmissionDto } from "#src/equities/equityOrderService.js";

const intent = {
  contract: {
    conid: 265598,
    assetClass: "STK",
    symbol: "AAPL",
    exchange: "SMART",
    primaryExchange: "NASDAQ",
    currency: "USD",
  },
  side: "BUY",
  quantity: 10,
  limit: 250,
  tif: "DAY",
  session: "REGULAR",
  orderType: "LMT",
} as unknown as EquityPreviewDto["order"];

const preview: EquityPreviewDto = {
  previewId: "a".repeat(64),
  createdAt: "2026-09-15T00:00:00.000Z",
  expiresAt: "2026-09-15T00:05:00.000Z",
  environment: "paper",
  account: { maskedId: "U***567", environment: "paper" },
  order: intent,
  whatIf: {
    accepted: true,
    submitted: false,
    commission: 1.25,
    initialMargin: { change: 1250, after: 5000, before: 3750 },
    maintenanceMargin: null,
    warnings: [],
    rejectionReasons: [],
    advisoryAssetPermissions: [],
  } as unknown as EquityPreviewDto["whatIf"],
  submitted: false,
};

const submission: EquitySubmissionDto = {
  previewId: "a".repeat(64),
  environment: "paper",
  account: { maskedId: "U***567", environment: "paper" },
  order: intent,
  operation: {
    operationId: "op-1",
    kind: "single",
    action: "create",
    state: "completed",
    createdAt: "2026-09-15T00:00:00.000Z",
    latestTransitionAt: "2026-09-15T00:00:01.000Z",
    pendingWarning: null,
    reconciliation: null,
    children: [],
    result: {
      kind: "accepted",
      warningCount: 0,
      orders: [{ status: "Submitted", orderId: "DU1234567-99" }],
    },
  } as unknown as EquitySubmissionDto["operation"],
  recovered: false,
};

function program(dependencies: EquityCommandDependencies = {}): Command {
  const command = new Command();
  command.exitOverride();
  addEquityCommands(command, () => "ibkr", dependencies);
  return command;
}

function orders(overrides: Record<string, unknown> = {}) {
  return {
    preview: () => Promise.resolve(preview),
    submit: () => Promise.resolve(submission),
    ...overrides,
  } as unknown as Awaited<ReturnType<NonNullable<EquityCommandDependencies["createEquityOrders"]>>>;
}

void test("equity preview states plainly that nothing was submitted", async () => {
  const lines: string[] = [];
  await program({
    createEquityOrders: () => Promise.resolve(orders()),
    log: (line) => lines.push(line),
  }).parseAsync(["node", "t", "equity", "preview", "AAPL", "BUY", "10", "--limit", "250"]);

  const output = lines.join("\n");
  assert.match(output, /BUY 10 AAPL limit 250/);
  assert.match(output, /NO ORDER WAS SUBMITTED\./);
  assert.match(output, /Account: U\*\*\*567/);
});

void test("equity preview passes validated terms through to the service", async () => {
  let received: unknown;
  await program({
    createEquityOrders: () =>
      Promise.resolve(
        orders({
          preview: (input: unknown) => {
            received = input;
            return Promise.resolve(preview);
          },
        })
      ),
    log: () => undefined,
  }).parseAsync([
    "node",
    "t",
    "equity",
    "preview",
    "aapl",
    "sell",
    "10",
    "--limit",
    "260.5",
    "--tif",
    "gtc",
    "--session",
    "overnight",
  ]);

  assert.deepEqual(received, {
    symbol: "AAPL",
    side: "SELL",
    quantity: 10,
    orderType: "LIMIT",
    limit: 260.5,
    tif: "GTC",
    session: "OVERNIGHT",
  });
});

void test("equity preview rejects fractional shares and bad enums", async () => {
  const run = (...args: string[]): Promise<unknown> =>
    program({
      createEquityOrders: () => Promise.resolve(orders()),
      log: () => undefined,
    }).parseAsync(["node", "t", "equity", "preview", ...args]);

  await assert.rejects(run("AAPL", "BUY", "1.5", "--limit", "250"), /whole number of shares/);
  await assert.rejects(run("AAPL", "BUY", "0", "--limit", "250"), /whole number of shares/);
  await assert.rejects(run("AAPL", "HOLD", "1", "--limit", "250"), /Expected BUY or SELL/);
  await assert.rejects(run("AAPL", "BUY", "1", "--limit", "0"), /Invalid limit price/);
});

void test("equity submit requires --confirm and an operator", async () => {
  const deps = {
    createEquityOrders: () => Promise.resolve(orders()),
    log: () => undefined,
  };
  const previousOperator = process.env["HUSKLY_EXT_OPERATOR"];
  delete process.env["HUSKLY_EXT_OPERATOR"];
  try {
    await assert.rejects(
      program(deps).parseAsync(["node", "t", "equity", "submit", "a".repeat(64)]),
      /requires --confirm/
    );
    await assert.rejects(
      program(deps).parseAsync(["node", "t", "equity", "submit", "a".repeat(64), "--confirm"]),
      /--operator or HUSKLY_EXT_OPERATOR is required/
    );
  } finally {
    if (previousOperator !== undefined) process.env["HUSKLY_EXT_OPERATOR"] = previousOperator;
  }
});

void test("equity submit JSON keeps gateway order payloads out of the output", async () => {
  const lines: string[] = [];
  await program({
    createEquityOrders: () => Promise.resolve(orders()),
    log: (line) => lines.push(line),
  }).parseAsync([
    "node",
    "t",
    "equity",
    "submit",
    "a".repeat(64),
    "--operator",
    "alice",
    "--confirm",
    "--json",
  ]);

  const raw = lines.join("\n");
  assert.equal(raw.includes("DU1234567-99"), false);
  const json = JSON.parse(raw) as { operation: { result: { orderCount: number } } };
  assert.equal(json.operation.result.orderCount, 1);
});

void test("equity commands refuse a broker that cannot serve them", async () => {
  // Use the real precedence rule so the --broker flag is actually honored.
  const command = new Command();
  command.exitOverride();
  addEquityCommands(command, (override, fallback) => chooseBroker(override, undefined, fallback), {
    log: () => undefined,
  });

  await assert.rejects(
    command.parseAsync([
      "node",
      "t",
      "equity",
      "preview",
      "AAPL",
      "BUY",
      "1",
      "--limit",
      "1",
      "--broker",
      "schwab",
    ]),
    /not implemented for broker 'schwab'/
  );
});
