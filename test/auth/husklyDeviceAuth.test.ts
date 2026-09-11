import assert from "node:assert/strict";
import test from "node:test";
import { HusklyDeviceAuth, HUSKLY_BASE_URL } from "#src/auth/husklyDeviceAuth.js";

function createKeytar(stored: string | null) {
  const calls: string[] = [];
  return {
    calls,
    keytar: {
      getPassword: () => {
        calls.push("get");
        return Promise.resolve(stored);
      },
      setPassword: () => {
        calls.push("set");
        return Promise.resolve();
      },
      deletePassword: () => {
        calls.push("delete");
        return Promise.resolve(true);
      },
    },
  };
}

void test("exports the canonical huskly API origin", () => {
  assert.equal(HUSKLY_BASE_URL, "https://huskly.finance");
});

void test("getSessionToken returns a stored future session token without Schwab token exchange", async () => {
  const fixture = createKeytar(
    JSON.stringify({ sessionToken: "session-token-fixture", expiresAt: "2999-01-01T00:00:00.000Z" })
  );
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("/api/v1/cli/token must not be called");
  };
  try {
    const auth = new HusklyDeviceAuth("https://example.invalid", { keytar: fixture.keytar });
    assert.equal(await auth.getSessionToken(), "session-token-fixture");
    assert.deepEqual(fixture.calls, ["get"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

void test("getSessionToken returns null for missing, malformed, and expired sessions", async () => {
  const cases: readonly [string, string | null, string[]][] = [
    ["missing", null, ["get"]],
    ["malformed json", "{", ["get", "delete"]],
    [
      "malformed shape",
      JSON.stringify({ sessionToken: 1, expiresAt: "2999-01-01T00:00:00.000Z" }),
      ["get", "delete"],
    ],
    [
      "invalid date",
      JSON.stringify({ sessionToken: "session-token-fixture", expiresAt: "invalid" }),
      ["get", "delete"],
    ],
    [
      "empty token",
      JSON.stringify({ sessionToken: "", expiresAt: "2999-01-01T00:00:00.000Z" }),
      ["get", "delete"],
    ],
    [
      "invalid token shape",
      JSON.stringify({
        sessionToken: "session token with spaces",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      ["get", "delete"],
    ],
    [
      "expired",
      JSON.stringify({ sessionToken: "expired-session", expiresAt: "2000-01-01T00:00:00.000Z" }),
      ["get"],
    ],
  ];

  for (const [, stored, expectedCalls] of cases) {
    const fixture = createKeytar(stored);
    const auth = new HusklyDeviceAuth("https://example.invalid", { keytar: fixture.keytar });
    assert.equal(await auth.getSessionToken(), null);
    assert.deepEqual(fixture.calls, expectedCalls);
  }
});
