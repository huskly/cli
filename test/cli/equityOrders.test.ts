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

function warnedSubmission(
  pendingWarning: EquitySubmissionDto["operation"]["pendingWarning"] = {
    sequence: 1,
    replyId: "reply-1",
    known: true,
  }
): EquitySubmissionDto {
  return {
    ...submission,
    operation: {
      ...submission.operation,
      state: "warning_pending",
      pendingWarning,
      result: { kind: "warning", warningCount: 1, orders: [] },
    },
  };
}

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

void test("equity submit acknowledges every broker warning and renders the final operation", async () => {
  const lines: string[] = [];
  const warningSubmission = warnedSubmission();
  const acknowledgements: unknown[] = [];

  await program({
    createEquityOrders: () =>
      Promise.resolve(orders({ submit: () => Promise.resolve(warningSubmission) })),
    createExecutionService: () =>
      Promise.resolve({
        acknowledgeWarning: (input: unknown) => {
          acknowledgements.push(input);
          const sequence = acknowledgements.length + 1;
          return Promise.resolve({
            operation:
              acknowledgements.length === 1
                ? {
                    ...warningSubmission.operation,
                    pendingWarning: { sequence, replyId: `reply-${String(sequence)}`, known: true },
                  }
                : {
                    ...submission.operation,
                    state: "accepted",
                    action: "submission",
                  },
          });
        },
      }),
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
  ]);

  assert.deepEqual(acknowledgements, [
    { operationId: "op-1", replyId: "reply-1", confirm: true },
    { operationId: "op-1", replyId: "reply-2", confirm: true },
  ]);
  const output = lines.join("\n");
  assert.match(output, /State: accepted/u);
  assert.match(output, /Broker warnings acknowledged automatically: 2/u);
  assert.doesNotMatch(output, /Pending warning/u);
});

void test("equity submit rejects a repeated broker warning reply", async () => {
  const warningSubmission = warnedSubmission();

  await assert.rejects(
    program({
      createEquityOrders: () =>
        Promise.resolve(orders({ submit: () => Promise.resolve(warningSubmission) })),
      createExecutionService: () =>
        Promise.resolve({
          acknowledgeWarning: () => Promise.resolve({ operation: warningSubmission.operation }),
        }),
      log: () => undefined,
    }).parseAsync([
      "node",
      "t",
      "equity",
      "submit",
      "a".repeat(64),
      "--operator",
      "alice",
      "--confirm",
    ]),
    /repeated warning reply/u
  );
});

void test("equity submit rejects warning state without a reply", async () => {
  await assert.rejects(
    program({
      createEquityOrders: () =>
        Promise.resolve(orders({ submit: () => Promise.resolve(warnedSubmission(null)) })),
      log: () => undefined,
    }).parseAsync([
      "node",
      "t",
      "equity",
      "submit",
      "a".repeat(64),
      "--operator",
      "alice",
      "--confirm",
    ]),
    /without a warning reply/u
  );
});

void test("equity submit surfaces warning acknowledgement failures", async () => {
  await assert.rejects(
    program({
      createEquityOrders: () =>
        Promise.resolve(orders({ submit: () => Promise.resolve(warnedSubmission()) })),
      createExecutionService: () =>
        Promise.resolve({
          acknowledgeWarning: () => Promise.reject(new Error("acknowledgement failed")),
        }),
      log: () => undefined,
    }).parseAsync([
      "node",
      "t",
      "equity",
      "submit",
      "a".repeat(64),
      "--operator",
      "alice",
      "--confirm",
    ]),
    /acknowledgement failed/u
  );
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

void test("equity preview with --limit alone defaults to LIMIT order type", async () => {
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
  }).parseAsync(["node", "t", "equity", "preview", "AAPL", "BUY", "10", "--limit", "250"]);

  assert.deepEqual(received, {
    symbol: "AAPL",
    side: "BUY",
    quantity: 10,
    orderType: "LIMIT",
    limit: 250,
    tif: "DAY",
    session: "REGULAR",
  });
});

void test("equity preview with explicit --order-type LIMIT --limit passes LIMIT terms", async () => {
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
    "AAPL",
    "BUY",
    "10",
    "--order-type",
    "LIMIT",
    "--limit",
    "250",
  ]);

  assert.deepEqual(received, {
    symbol: "AAPL",
    side: "BUY",
    quantity: 10,
    orderType: "LIMIT",
    limit: 250,
    tif: "DAY",
    session: "REGULAR",
  });
});

void test("equity preview with --order-type STOP --stop-price passes STOP terms", async () => {
  const stopIntent = {
    contract: intent.contract,
    side: "BUY",
    quantity: 10,
    stopPrice: 240,
    tif: "DAY",
    session: "REGULAR",
    orderType: "STP",
  } as unknown as EquityPreviewDto["order"];
  const stopPreview = { ...preview, order: stopIntent };
  let received: unknown;
  await program({
    createEquityOrders: () =>
      Promise.resolve(
        orders({
          preview: (input: unknown) => {
            received = input;
            return Promise.resolve(stopPreview);
          },
        })
      ),
    log: () => undefined,
  }).parseAsync([
    "node",
    "t",
    "equity",
    "preview",
    "AAPL",
    "BUY",
    "10",
    "--order-type",
    "STOP",
    "--stop-price",
    "240",
  ]);

  assert.deepEqual(received, {
    symbol: "AAPL",
    side: "BUY",
    quantity: 10,
    orderType: "STOP",
    stopPrice: 240,
    tif: "DAY",
    session: "REGULAR",
  });
});

void test("equity preview STOP renders stop price in human output", async () => {
  const stopIntent = {
    contract: intent.contract,
    side: "SELL",
    quantity: 5,
    stopPrice: 230.5,
    tif: "DAY",
    session: "REGULAR",
    orderType: "STP",
  } as unknown as EquityPreviewDto["order"];
  const stopPreview = { ...preview, order: stopIntent };
  const lines: string[] = [];
  await program({
    createEquityOrders: () =>
      Promise.resolve(orders({ preview: () => Promise.resolve(stopPreview) })),
    log: (line) => lines.push(line),
  }).parseAsync([
    "node",
    "t",
    "equity",
    "preview",
    "AAPL",
    "SELL",
    "5",
    "--order-type",
    "STOP",
    "--stop-price",
    "230.50",
  ]);

  const output = lines.join("\n");
  assert.match(output, /SELL 5 AAPL stop 230\.5/);
  assert.match(output, /NO ORDER WAS SUBMITTED\./);
});

void test("equity preview STOP JSON includes stopPrice, not limit", async () => {
  const stopIntent = {
    contract: intent.contract,
    side: "BUY",
    quantity: 3,
    stopPrice: 245,
    tif: "DAY",
    session: "REGULAR",
    orderType: "STP",
  } as unknown as EquityPreviewDto["order"];
  const stopPreview = { ...preview, order: stopIntent };
  const lines: string[] = [];
  await program({
    createEquityOrders: () =>
      Promise.resolve(orders({ preview: () => Promise.resolve(stopPreview) })),
    log: (line) => lines.push(line),
  }).parseAsync([
    "node",
    "t",
    "equity",
    "preview",
    "AAPL",
    "BUY",
    "3",
    "--order-type",
    "STOP",
    "--stop-price",
    "245",
    "--json",
  ]);

  const raw = lines.join("\n");
  const json = JSON.parse(raw) as { order: { orderType: string; stopPrice: number } };
  assert.equal(json.order.orderType, "STP");
  assert.equal(json.order.stopPrice, 245);
  assert.equal("limit" in json.order, false);
});

void test("equity preview rejects unknown order type before service initialization", async () => {
  let serviceInitialized = false;
  const run = (...args: string[]): Promise<unknown> =>
    program({
      createEquityOrders: () => {
        serviceInitialized = true;
        return Promise.resolve(orders());
      },
      log: () => undefined,
    }).parseAsync(["node", "t", "equity", "preview", ...args]);

  await assert.rejects(
    run("AAPL", "BUY", "1", "--order-type", "TRAILING", "--limit", "250"),
    /Unknown order type/
  );
  assert.equal(serviceInitialized, false);
});

void test("equity preview rejects missing price for each order type before service initialization", async () => {
  let serviceInitialized = false;
  const run = (...args: string[]): Promise<unknown> =>
    program({
      createEquityOrders: () => {
        serviceInitialized = true;
        return Promise.resolve(orders());
      },
      log: () => undefined,
    }).parseAsync(["node", "t", "equity", "preview", ...args]);

  // LIMIT without --limit
  await assert.rejects(run("AAPL", "BUY", "1", "--order-type", "LIMIT"), /require --limit/);
  // STOP without --stop-price
  await assert.rejects(run("AAPL", "BUY", "1", "--order-type", "STOP"), /require --stop-price/);
  // Bare call with no price at all
  await assert.rejects(run("AAPL", "BUY", "1"), /require --limit/);
  assert.equal(serviceInitialized, false);
});

void test("equity preview rejects mismatched price options before service initialization", async () => {
  let serviceInitialized = false;
  const run = (...args: string[]): Promise<unknown> =>
    program({
      createEquityOrders: () => {
        serviceInitialized = true;
        return Promise.resolve(orders());
      },
      log: () => undefined,
    }).parseAsync(["node", "t", "equity", "preview", ...args]);

  // LIMIT with --stop-price
  await assert.rejects(
    run("AAPL", "BUY", "1", "--order-type", "LIMIT", "--stop-price", "250"),
    /not valid for LIMIT/
  );
  // STOP with --limit
  await assert.rejects(
    run("AAPL", "BUY", "1", "--order-type", "STOP", "--limit", "250"),
    /not valid for STOP/
  );
  assert.equal(serviceInitialized, false);
});

void test("equity preview rejects zero, negative, and non-finite prices before service initialization", async () => {
  let serviceInitialized = false;
  const run = (...args: string[]): Promise<unknown> =>
    program({
      createEquityOrders: () => {
        serviceInitialized = true;
        return Promise.resolve(orders());
      },
      log: () => undefined,
    }).parseAsync(["node", "t", "equity", "preview", ...args]);

  await assert.rejects(run("AAPL", "BUY", "1", "--limit", "0"), /Invalid limit price/);
  await assert.rejects(run("AAPL", "BUY", "1", "--limit", "-5"), /Invalid limit price/);
  await assert.rejects(run("AAPL", "BUY", "1", "--limit", "Infinity"), /Invalid limit price/);
  await assert.rejects(run("AAPL", "BUY", "1", "--limit", "NaN"), /Invalid limit price/);
  await assert.rejects(
    run("AAPL", "BUY", "1", "--order-type", "STOP", "--stop-price", "0"),
    /Invalid stop price/
  );
  await assert.rejects(
    run("AAPL", "BUY", "1", "--order-type", "STOP", "--stop-price", "-10"),
    /Invalid stop price/
  );
  await assert.rejects(
    run("AAPL", "BUY", "1", "--order-type", "STOP", "--stop-price", "Infinity"),
    /Invalid stop price/
  );
  assert.equal(serviceInitialized, false);
});
