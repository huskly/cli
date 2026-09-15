import assert from "node:assert/strict";
import test from "node:test";
import { chooseBroker, requireSchwab, resolveBroker } from "#src/cli/shared.js";

void test("a subcommand broker flag beats the global flag and the fallback", () => {
  assert.equal(chooseBroker("schwab", "ibkr", "ibkr"), "schwab");
  assert.equal(chooseBroker("ibkr", "schwab", "schwab"), "ibkr");
});

void test("the global broker flag applies when the subcommand gives none", () => {
  assert.equal(chooseBroker(undefined, "schwab", "ibkr"), "schwab");
  assert.equal(chooseBroker(undefined, "ibkr", "schwab"), "ibkr");
});

void test("gateway-only commands fall back to ibkr, not the global schwab default", () => {
  assert.equal(chooseBroker(undefined, undefined, "ibkr"), "ibkr");
  assert.equal(chooseBroker(undefined, undefined, "schwab"), "schwab");
});

void test("broker resolution normalizes case and rejects unknown brokers", () => {
  assert.equal(chooseBroker("IBKR", undefined, "schwab"), "ibkr");
  assert.equal(resolveBroker("Schwab"), "schwab");
  assert.throws(() => chooseBroker("etrade", undefined, "schwab"), /Invalid --broker 'etrade'/);
});

void test("the Schwab guard names the command and the broker that was used", () => {
  assert.throws(() => {
    requireSchwab("ibkr", "vix");
  }, /The 'vix' command is only available for --broker schwab \(got 'ibkr'\)/);
  assert.doesNotThrow(() => {
    requireSchwab("schwab", "vix");
  });
});
