import assert from "node:assert/strict";
import test from "node:test";
import { createProgram } from "#src/cli/program.js";

function names(interactive = false): string[] {
  return createProgram({ interactive }).commands.map((command) => command.name());
}

void test("the command table is built fresh on every call", () => {
  assert.notEqual(createProgram(), createProgram());
});

void test("the REPL and the CLI expose the same commands, minus a nested repl", () => {
  const cli = names();
  const repl = names(true);
  assert.ok(cli.includes("repl"));
  assert.equal(repl.includes("repl"), false);
  assert.deepEqual(
    cli.filter((name) => name !== "repl"),
    repl
  );
});

void test("every documented command group is registered", () => {
  const registered = names();
  for (const expected of [
    "auth",
    "quote",
    "search",
    "movers",
    "history",
    "chart",
    "vix",
    "expiries",
    "chain",
    "option",
    "spread",
    "order",
    "broker",
    "equity",
    "account",
    "user-preference",
    "positions",
    "transactions",
    "orders",
    "place-order",
    "place-option-order",
    "cancel-order",
    "repl",
  ]) {
    assert.ok(registered.includes(expected), `missing command: ${expected}`);
  }
});

void test("quote help documents the OSI option format", () => {
  const quote = createProgram().commands.find((command) => command.name() === "quote");
  assert.ok(quote !== undefined);
  const help = quote.helpInformation();
  assert.match(help, /OSI/);
  assert.match(help, /Equity tickers, or OSI option symbols under Schwab/);
});
