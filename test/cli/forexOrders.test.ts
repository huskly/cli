import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { addForexCommands, type ForexCommandDependencies } from "#src/cli/forexOrders.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import type { ForexPreviewDto, ForexSubmissionDto } from "#src/forex/forexOrderService.js";

const intent: ForexPreviewDto["order"] = {
  contract: {
    conid: 15016059,
    assetClass: "CASH",
    symbol: "USD",
    currency: "JPY",
    localSymbol: "USD.JPY",
    exchange: "IDEALPRO",
  },
  side: "BUY",
  quantity: 25000,
  tif: "DAY",
  orderType: "LMT",
  limit: 147.255,
};

const preview: ForexPreviewDto = {
  previewId: "b".repeat(64),
  createdAt: "2026-09-25T00:00:00.000Z",
  expiresAt: "2026-09-25T00:05:00.000Z",
  environment: "paper",
  account: { maskedId: "U***567", environment: "paper" },
  order: intent,
  whatIf: {
    accepted: true,
    submitted: false,
    commission: 2,
    initialMargin: { current: 1000, change: 900, after: 1900 },
    maintenanceMargin: null,
    warnings: ["This order will be directed to the IDEALPRO odd lot market"],
    rejectionReasons: [],
    advisoryAssetPermissions: [],
    currency: "USD",
  },
  submitted: false,
};

const submission = {
  previewId: "b".repeat(64),
  environment: "paper",
  account: { maskedId: "U***567", environment: "paper" },
  order: intent,
  operation: {
    operationId: "op-fx-1",
    kind: "single",
    action: "submission",
    state: "accepted",
    createdAt: "2026-09-25T00:00:00.000Z",
    latestTransitionAt: "2026-09-25T00:00:01.000Z",
    pendingWarning: null,
    reconciliation: null,
    children: [],
    result: {
      kind: "accepted",
      warningCount: 0,
      orders: [{ status: "WORKING", orderId: "99" }],
    },
  },
  recovered: false,
} as unknown as ForexSubmissionDto;

function program(
  dependencies: ForexCommandDependencies = {},
  broker: BrokerName = "ibkr"
): Command {
  const command = new Command();
  command.exitOverride();
  addForexCommands(
    command,
    (override, fallback) =>
      (override as BrokerName | undefined) ?? (broker === "ibkr" ? fallback : broker),
    dependencies
  );
  return command;
}

function orders(overrides: Record<string, unknown> = {}) {
  return {
    preview: () => Promise.resolve(preview),
    submit: () => Promise.resolve(submission),
    ...overrides,
  } as unknown as Awaited<ReturnType<NonNullable<ForexCommandDependencies["createForexOrders"]>>>;
}

void test("fx preview shows base-currency units, quote-currency price, and IBKR warnings", async () => {
  const lines: string[] = [];
  await program({
    createForexOrders: () => Promise.resolve(orders()),
    log: (line) => lines.push(line),
  }).parseAsync(["node", "t", "fx", "preview", "USD.JPY", "BUY", "25000", "--limit", "147.255"]);

  const output = lines.join("\n");
  assert.match(output, /BUY \$25,000 USD\.JPY limit ¥147\.255 {2}DAY/);
  assert.match(output, /Commission\/fees: \$2\.00/);
  assert.match(output, /Initial margin change: \$900\.00/);
  assert.match(output, /odd lot/);
  assert.match(output, /NO ORDER WAS SUBMITTED\./);
});

void test("fx preview passes validated terms to the service", async () => {
  let received: unknown;
  await program({
    createForexOrders: () =>
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
    "fx",
    "preview",
    "usd/jpy",
    "sell",
    "30000",
    "--limit",
    "147.2",
    "--tif",
    "gtc",
  ]);
  assert.deepEqual(received, {
    pair: "usd/jpy",
    side: "SELL",
    quantity: 30000,
    limit: 147.2,
    tif: "GTC",
  });
});

void test("fx preview refuses bad input before the service", async () => {
  let calls = 0;
  const run = (...args: string[]): Promise<unknown> =>
    program({
      createForexOrders: () => {
        calls += 1;
        return Promise.resolve(orders());
      },
      log: () => undefined,
    }).parseAsync(["node", "t", "fx", "preview", ...args]);

  await assert.rejects(
    run("USD.JPY", "BUY", "1.5", "--limit", "147"),
    /whole number of base-currency units/
  );
  await assert.rejects(run("USD.JPY", "BUY", "25000"), /require --limit/);
  await assert.rejects(run("USD.JPY", "BUY", "25000", "--limit", "0"), /Invalid limit price/);
  await assert.rejects(run("USD.JPY", "HOLD", "25000", "--limit", "147"), /Expected BUY or SELL/);
  await assert.rejects(
    run("USD.JPY", "BUY", "25000", "--limit", "147", "--tif", "IOC"),
    /Expected DAY or GTC/
  );
  assert.equal(calls, 0);
});

void test("fx commands refuse the Schwab broker", async () => {
  for (const args of [
    ["fx", "preview", "USD.JPY", "BUY", "25000", "--limit", "147", "--broker", "schwab"],
    ["fx", "submit", "b".repeat(64), "--confirm", "--operator", "alice", "--broker", "schwab"],
  ]) {
    await assert.rejects(
      program({
        createForexOrders: () => Promise.resolve(orders()),
        log: () => undefined,
      }).parseAsync(["node", "t", ...args]),
      /FX orders are available for IBKR only/
    );
  }
  await assert.rejects(
    program(
      { createForexOrders: () => Promise.resolve(orders()), log: () => undefined },
      "schwab"
    ).parseAsync(["node", "t", "fx", "preview", "USD.JPY", "BUY", "25000", "--limit", "147"]),
    /FX orders are available for IBKR only/
  );
});

void test("fx preview --json states a stable DTO", async () => {
  const lines: string[] = [];
  await program({
    createForexOrders: () => Promise.resolve(orders()),
    log: (line) => lines.push(line),
  }).parseAsync([
    "node",
    "t",
    "fx",
    "preview",
    "USD.JPY",
    "BUY",
    "25000",
    "--limit",
    "147.255",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(lines.join("\n")), {
    previewId: "b".repeat(64),
    createdAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-09-25T00:05:00.000Z",
    environment: "paper",
    account: { maskedId: "U***567", environment: "paper" },
    order: {
      pair: "USD.JPY",
      baseCurrency: "USD",
      quoteCurrency: "JPY",
      side: "BUY",
      quantity: 25000,
      orderType: "LMT",
      limit: 147.255,
      tif: "DAY",
    },
    whatIf: preview.whatIf,
    submitted: false,
  });
});

void test("fx submit requires --confirm and reports the operation", async () => {
  const lines: string[] = [];
  let received: unknown;
  const deps: ForexCommandDependencies = {
    createForexOrders: () =>
      Promise.resolve(
        orders({
          submit: (input: unknown) => {
            received = input;
            return Promise.resolve(submission);
          },
        })
      ),
    log: (line) => lines.push(line),
  };
  await assert.rejects(
    program(deps).parseAsync(["node", "t", "fx", "submit", "b".repeat(64), "--operator", "alice"]),
    /requires --confirm/
  );
  await program(deps).parseAsync([
    "node",
    "t",
    "fx",
    "submit",
    "b".repeat(64),
    "--operator",
    "alice",
    "--confirm",
  ]);
  assert.deepEqual(received, { previewId: "b".repeat(64), operator: "alice", confirm: true });
  const output = lines.join("\n");
  assert.match(output, /Submission: new/);
  assert.match(output, /BUY \$25,000 USD\.JPY limit ¥147\.255/);
});
