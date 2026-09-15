import assert from "node:assert/strict";
import test from "node:test";
import { executeCommand, parseArgs } from "#src/cli/repl.js";

/** Commander reports usage errors on stderr; keep the test output readable. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    return await run();
  } finally {
    process.stderr.write = original;
  }
}

void test("quoted arguments survive so padded option symbols stay one argument", () => {
  assert.deepEqual(parseArgs('quote "AAPL  261218C00330000"'), ["quote", "AAPL  261218C00330000"]);
  assert.deepEqual(parseArgs("quote SPY QQQ"), ["quote", "SPY", "QQQ"]);
  assert.deepEqual(parseArgs("  "), []);
});

void test("exit and quit end the session", async () => {
  assert.equal(await executeCommand({}, "exit"), "exit");
  assert.equal(await executeCommand({}, "quit"), "exit");
  assert.equal(await executeCommand({}, "  EXIT  "), "exit");
});

void test("a blank line does nothing", async () => {
  assert.equal(await executeCommand({}, ""), "continue");
  assert.equal(await executeCommand({}, "   "), "continue");
});

void test("an unknown command reports the error and keeps the session alive", async () => {
  assert.equal(await quietly(() => executeCommand({}, "badcommand")), "continue");
});

void test("a usage error keeps the session alive", async () => {
  assert.equal(
    await quietly(() => executeCommand({ broker: "ibkr" }, "equity preview AAPL BUY 10")),
    "continue"
  );
});

void test("help keeps the session alive", async () => {
  assert.equal(await quietly(() => executeCommand({}, "help quote")), "continue");
});
