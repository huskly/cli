import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { addEquityCommands } from "#src/cli/equityOrders.js";
import type { EquityModificationDto } from "#src/equities/equityOrderModification.js";
const result = {
  modificationId: "mod-1",
  orderId: "1234",
  ownerOperationId: "op-1",
  state: "accepted",
  before: {
    symbol: "AAPL",
    conid: 1,
    side: "BUY",
    orderType: "LMT",
    limit: 250,
    stopPrice: null,
    quantity: 10,
    filledQuantity: 0,
    tif: "DAY",
    session: "REGULAR",
  },
  requested: { limit: 251 },
  submitted: {
    symbol: "AAPL",
    conid: 1,
    side: "BUY",
    orderType: "LMT",
    limit: 251,
    stopPrice: null,
    quantity: 10,
    tif: "DAY",
    session: "REGULAR",
  },
  pendingWarning: null,
  reconciliation: null,
  result: null,
  createdAt: "now",
  latestTransitionAt: "now",
  acknowledgedWarnings: 0,
} as EquityModificationDto;
test("modify command parses changes and renders before and after", async () => {
  let received: unknown;
  const lines: string[] = [];
  const program = new Command();
  program.exitOverride();
  addEquityCommands(program, () => "ibkr", {
    createModificationService: () =>
      Promise.resolve({
        modify: (value) => {
          received = value;
          return Promise.resolve(result);
        },
      }),
    log: (line) => lines.push(line),
  });
  await program.parseAsync([
    "node",
    "test",
    "equity",
    "modify",
    "1234",
    "--limit",
    "251",
    "--operator",
    "alice",
    "--confirm",
  ]);
  assert.deepEqual(received, {
    orderId: "1234",
    changes: { limit: 251 },
    operator: "alice",
    confirm: true,
  });
  assert.match(lines[0] ?? "", /Before: BUY 10 AAPL limit 250/);
  assert.match(lines[0] ?? "", /After: BUY 10 AAPL limit 251/);
  assert.match(lines[0] ?? "", /Owner operation: op-1/);
});
test("modify JSON uses the same DTO and Schwab is refused", async () => {
  const lines: string[] = [];
  const program = new Command();
  program.exitOverride();
  addEquityCommands(program, (override) => (override === "schwab" ? "schwab" : "ibkr"), {
    createModificationService: () => Promise.resolve({ modify: () => Promise.resolve(result) }),
    log: (line) => lines.push(line),
  });
  await program.parseAsync([
    "node",
    "test",
    "equity",
    "modify",
    "1234",
    "--quantity",
    "12",
    "--operator",
    "alice",
    "--confirm",
    "--json",
  ]);
  assert.equal((JSON.parse(lines[0] ?? "{}") as EquityModificationDto).modificationId, "mod-1");
  await assert.rejects(
    program.parseAsync([
      "node",
      "test",
      "equity",
      "modify",
      "1234",
      "--limit",
      "251",
      "--operator",
      "alice",
      "--confirm",
      "--broker",
      "schwab",
    ]),
    /not supported for broker 'schwab'/
  );
});

test("modify prints unknown when no live before terms were available", async () => {
  const lines: string[] = [];
  const program = new Command();
  program.exitOverride();
  addEquityCommands(program, () => "ibkr", {
    createModificationService: () =>
      Promise.resolve({
        modify: () =>
          Promise.resolve({
            ...result,
            before: null,
            submitted: null,
            state: "rejected_before_submission",
          }),
      }),
    log: (line) => lines.push(line),
  });
  await program.parseAsync([
    "node",
    "test",
    "equity",
    "modify",
    "1234",
    "--limit",
    "251",
    "--operator",
    "alice",
    "--confirm",
  ]);
  assert.match(lines[0] ?? "", /Before: unknown/);
  assert.match(lines[0] ?? "", /After: not submitted/);
  assert.match(lines[0] ?? "", /State: rejected_before_submission/);
});

test("modification show, reconcile, and decline use the shared service", async () => {
  const events: string[] = [];
  const lines: string[] = [];
  const program = new Command();
  program.exitOverride();
  addEquityCommands(program, () => "ibkr", {
    createModificationService: () =>
      Promise.resolve({
        modify: () => Promise.resolve(result),
        get: (id) => {
          events.push(`get:${id}`);
          return Promise.resolve(result);
        },
        reconcile: (id, confirm) => {
          events.push(`reconcile:${id}:${String(confirm)}`);
          return Promise.resolve({
            ...result,
            state: "not_applied",
            reconciliation: {
              observedAt: "2026-10-08T01:00:00Z",
              status: "matched",
              reason: "before_terms_match",
            },
          });
        },
        decline: (id, confirm) => {
          events.push(`decline:${id}:${String(confirm)}`);
          return Promise.resolve({ ...result, state: "warning_declined" });
        },
      }),
    log: (line) => lines.push(line),
  });
  await program.parseAsync(["node", "test", "equity", "modification", "show", "mod-1", "--json"]);
  await program.parseAsync([
    "node",
    "test",
    "equity",
    "modification",
    "reconcile",
    "mod-1",
    "--confirm",
  ]);
  await program.parseAsync([
    "node",
    "test",
    "equity",
    "modification",
    "decline",
    "mod-1",
    "--confirm",
    "--json",
  ]);
  assert.deepEqual(events, ["get:mod-1", "reconcile:mod-1:true", "decline:mod-1:true"]);
  assert.equal((JSON.parse(lines[0] ?? "{}") as EquityModificationDto).modificationId, "mod-1");
  assert.match(lines[1] ?? "", /not_applied/);
  assert.equal((JSON.parse(lines[2] ?? "{}") as EquityModificationDto).state, "warning_declined");
  await assert.rejects(
    program.parseAsync(["node", "test", "equity", "modification", "reconcile", "mod-1"]),
    /requires --confirm/
  );
  await assert.rejects(
    program.parseAsync(["node", "test", "equity", "modification", "decline", "mod-1"]),
    /requires --confirm/
  );
});

test("unknown outcome text gives the reconciliation command", async () => {
  const lines: string[] = [];
  const program = new Command();
  program.exitOverride();
  addEquityCommands(program, () => "ibkr", {
    createModificationService: () =>
      Promise.resolve({ modify: () => Promise.resolve({ ...result, state: "unknown_outcome" }) }),
    log: (line) => lines.push(line),
  });
  await program.parseAsync([
    "node",
    "test",
    "equity",
    "modify",
    "1234",
    "--limit",
    "251",
    "--operator",
    "alice",
    "--confirm",
  ]);
  assert.match(lines[0] ?? "", /equity modification reconcile mod-1/);
});
