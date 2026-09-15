import assert from "node:assert/strict";
import test from "node:test";
import { setCacheEnabled } from "#src/cache.js";
import {
  collectSchwabDiagnostics,
  renderSchwabDiagnostics,
  type SchwabDiagnosticsSource,
} from "#src/cli/schwabDiagnostics.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

function source(overrides: Partial<SchwabDiagnosticsSource> = {}): SchwabDiagnosticsSource {
  return {
    getAccessToken: () => Promise.resolve("token"),
    fetchAccountNumbers: () => Promise.resolve([{ accountNumber: "51234493" }]),
    ...overrides,
  };
}

void test("schwab diagnostics report auth, cache, and account health together", async () => {
  setCacheEnabled(false);
  const result = await collectSchwabDiagnostics(source());
  assert.equal(result.broker, "schwab");
  assert.equal(result.auth.authenticated, true);
  assert.equal(result.cache.enabled, false);
  assert.equal(result.account.accessible, true);
  assert.equal(result.account.count, 1);
});

void test("schwab diagnostics mask the account number", async () => {
  setCacheEnabled(false);
  const result = await collectSchwabDiagnostics(source());
  assert.equal(result.account.maskedId, "5***493");
  assert.equal(JSON.stringify(result).includes("51234493"), false);
});

void test("an unauthenticated session is a finding, not a thrown error", async () => {
  setCacheEnabled(false);
  const result = await collectSchwabDiagnostics(
    source({ getAccessToken: () => Promise.resolve(null) })
  );
  assert.equal(result.auth.authenticated, false);
  assert.equal(result.account.accessible, false);
  assert.equal(result.account.error, "Not authenticated.");
  assert.match(stripAnsi(renderSchwabDiagnostics(result)), /Fix: huskly-cli auth login/);
});

void test("a failing account read is reported without hiding the other checks", async () => {
  setCacheEnabled(false);
  const result = await collectSchwabDiagnostics(
    source({ fetchAccountNumbers: () => Promise.reject(new Error("Schwab 403")) })
  );
  assert.equal(result.auth.authenticated, true);
  assert.equal(result.account.accessible, false);
  assert.equal(result.account.error, "Schwab 403");
  assert.match(stripAnsi(renderSchwabDiagnostics(result)), /Problem: Schwab 403/);
});

void test("a disabled cache renders as disabled rather than broken", async () => {
  setCacheEnabled(false);
  const output = stripAnsi(renderSchwabDiagnostics(await collectSchwabDiagnostics(source())));
  assert.match(output, /Cache: disabled with --no-cache/);
  assert.doesNotMatch(output, /unreachable/);
});
