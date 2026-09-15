import assert from "node:assert/strict";
import test from "node:test";
import { handlePlaceOptionOrder } from "#src/cli/placeOptionOrder.js";
import type { GatewayOptionOrderDependencies } from "#src/cli/gatewayOptionOrder.js";
import type {
  OptionOrderService,
  OptionSubmissionDto,
  PlaceSingleOptionOrderInput,
} from "#src/options/optionOrderService.js";

const submission: OptionSubmissionDto = {
  orderRef: "a".repeat(64),
  account: { maskedId: "D***567", environment: "paper" },
  order: {
    contract: {
      conid: 775665501,
      assetClass: "OPT",
      underlying: "IBIT",
      expiration: "2026-10-02",
      tradingClass: "IBIT",
      exchange: "SMART",
      multiplier: 100,
      strike: 42,
      right: "P",
    },
    side: "SELL",
    quantity: 1,
    tif: "DAY",
    session: "REGULAR",
    orderType: "LMT",
    limit: 0.99,
  },
  operation: {
    operationId: "op-1",
    kind: "single",
    action: "submission",
    state: "accepted",
    createdAt: "2026-09-15T00:00:00.000Z",
    latestTransitionAt: "2026-09-15T00:00:01.000Z",
    pendingWarning: null,
    reconciliation: null,
    children: [],
    result: { kind: "accepted", warningCount: 0, orders: [] },
  } as unknown as OptionSubmissionDto["operation"],
  recovered: false,
};

interface Capture {
  placed?: PlaceSingleOptionOrderInput;
  recovered?: string;
  lines: string[];
}

function dependencies(capture: Capture): GatewayOptionOrderDependencies {
  return {
    createService: () =>
      Promise.resolve({
        place: (input: PlaceSingleOptionOrderInput) => {
          capture.placed = input;
          return Promise.resolve(submission);
        },
        recover: (orderRef: string) => {
          capture.recovered = orderRef;
          return Promise.resolve({ ...submission, recovered: true });
        },
      } as unknown as OptionOrderService),
    log: (line) => capture.lines.push(line),
  };
}

function run(
  capture: Capture,
  options: Record<string, unknown> = {},
  args: readonly string[] = ["IBIT", "2026-10-02", "42", "P", "1", "SELL_TO_OPEN"]
): Promise<void> {
  return handlePlaceOptionOrder(
    "ibkr",
    args[0] ?? "",
    args[1] ?? "",
    args[2] ?? "",
    args[3] ?? "",
    args[4] ?? "",
    args[5] ?? "",
    { type: "LIMIT", price: "0.99", operator: "alice", confirm: true, ...options },
    dependencies(capture)
  );
}

void test("an IBKR option order maps the shared arguments onto gateway terms", async () => {
  const capture: Capture = { lines: [] };
  await run(capture, {
    duration: "GOOD_TILL_CANCEL",
    session: "NORMAL",
    class: "ibit",
    exchange: "smart",
  });

  assert.deepEqual(capture.placed, {
    assetClass: "OPT",
    underlying: "IBIT",
    expiration: "2026-10-02",
    strike: 42,
    right: "PUT",
    side: "SELL",
    quantity: 1,
    limit: 0.99,
    tif: "GTC",
    session: "REGULAR",
    tradingClass: "IBIT",
    exchange: "SMART",
    operator: "alice",
    confirm: true,
  });
});

void test("an IBKR option order passes an unconfirmed request to the guard", async () => {
  const capture: Capture = { lines: [] };
  await run(capture, { confirm: undefined });
  assert.equal(capture.placed?.confirm, false);
});

void test("every buying instruction becomes a BUY and every selling one a SELL", async () => {
  const sides: string[] = [];
  for (const instruction of ["BUY_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_OPEN", "SELL_TO_CLOSE"]) {
    const capture: Capture = { lines: [] };
    await run(capture, {}, ["IBIT", "2026-10-02", "42", "CALL", "2", instruction]);
    sides.push(`${instruction}:${capture.placed?.side ?? "none"}`);
  }
  assert.deepEqual(sides, [
    "BUY_TO_OPEN:BUY",
    "BUY_TO_CLOSE:BUY",
    "SELL_TO_OPEN:SELL",
    "SELL_TO_CLOSE:SELL",
  ]);
});

void test("the gateway takes LIMIT orders only, with exact session and duration values", async () => {
  const capture: Capture = { lines: [] };
  await assert.rejects(run(capture, { type: "MARKET", price: undefined }), /only places LIMIT/);
  await assert.rejects(run(capture, { session: "AM" }), /Invalid session "AM"/);
  await assert.rejects(run(capture, { duration: "FILL_OR_KILL" }), /Invalid duration/);
});

void test("--recover reads back the stated order reference instead of submitting again", async () => {
  const capture: Capture = { lines: [] };
  await run(capture, { recover: "b".repeat(64) });

  assert.equal(capture.placed, undefined);
  assert.equal(capture.recovered, "b".repeat(64));
  assert.match(capture.lines.join("\n"), /Submission: recovered/);
});

void test("the human output states the account, the terms, and the operation", async () => {
  const capture: Capture = { lines: [] };
  await run(capture);

  const output = capture.lines.join("\n");
  assert.match(output, /Order reference: a{64}/);
  assert.match(output, /Account: D\*\*\*567 {2}Environment: paper/);
  assert.match(output, /SELL 1 IBIT 2026-10-02 42 P limit 0.99 {2}DAY REGULAR/);
  assert.match(output, /Est. credit: 99.00/);
  assert.match(output, /Operation: op-1/);
});

void test("--json emits the stable submission DTO", async () => {
  const capture: Capture = { lines: [] };
  await run(capture, { json: true });

  const parsed = JSON.parse(capture.lines.join("")) as { order: { side: string } };
  assert.equal(parsed.order.side, "SELL");
});
