import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { addDerivativeCommands } from "./derivatives.js";

function program(): Command {
  const command = new Command();
  command.exitOverride();
  addDerivativeCommands(command, () => "ibkr");
  return command;
}

const previewId = "a".repeat(64);

void test("spread submission refuses to initialize a broker without explicit confirmation", async () => {
  await assert.rejects(
    () =>
      program().parseAsync([
        "node",
        "test",
        "spread",
        "submit",
        previewId,
        "--account",
        "DU1234567",
        "--operator",
        "tester",
      ]),
    /requires --confirm/
  );
});

void test("warning acknowledgment requires a fresh explicit confirmation", async () => {
  await assert.rejects(
    () =>
      program().parseAsync([
        "node",
        "test",
        "spread",
        "acknowledge",
        previewId,
        "reply-1",
        "--account",
        "DU1234567",
      ]),
    /requires --confirm/
  );
});

void test("cancellation refuses to initialize a broker without explicit confirmation", async () => {
  await assert.rejects(
    () =>
      program().parseAsync([
        "node",
        "test",
        "order",
        "cancel",
        "12345",
        "--account",
        "DU1234567",
        "--operator",
        "tester",
      ]),
    /requires --confirm/
  );
});
