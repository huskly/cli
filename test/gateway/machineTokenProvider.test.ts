import assert from "node:assert/strict";
import test from "node:test";
import {
  createMachineTokenProvider,
  type MachineTokenProviderOptions,
} from "#src/gateway/machineTokenProvider.js";

const validTokenResponse = {
  access_token: "token-1",
  token_type: "Bearer",
  expires_in: 300,
  scope: "ibkr:read-only",
} as const;

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function createProvider(overrides: Partial<MachineTokenProviderOptions> = {}) {
  let now = 0;
  const delays: number[] = [];
  const requests: { input: string; init: RequestInit }[] = [];
  const fetchCalls: (() => Promise<Response>)[] = [];

  const provider = createMachineTokenProvider({
    tokenUrl: "https://huskly.finance/api/v1/machine/token",
    clientId: "machine-client-id",
    clientSecret: "machine-client-secret",
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ input: href, init: init ?? {} });
      const next = fetchCalls.shift();
      if (next === undefined) {
        throw new Error("No queued token response");
      }
      return next();
    },
    now: () => now,
    delay: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  });

  return {
    provider,
    requests,
    delays,
    queueResponse(response: Response): void {
      fetchCalls.push(() => Promise.resolve(response));
    },
    queueFailure(error: Error): void {
      fetchCalls.push(() => Promise.reject(error));
    },
    setNow(value: number): void {
      now = value;
    },
  };
}

void test("reuses tokens before the 60-second refresh boundary, refreshes at the boundary, and shares one exchange across concurrent callers", async () => {
  const fixture = createProvider();
  fixture.queueResponse(createJsonResponse(validTokenResponse));
  fixture.queueResponse(
    createJsonResponse({
      ...validTokenResponse,
      access_token: "token-2",
    })
  );

  assert.equal(await fixture.provider.getToken(), "token-1");
  assert.equal(fixture.requests.length, 1);

  fixture.setNow(239_999);
  const reused = await Promise.all([
    fixture.provider.getToken(),
    fixture.provider.getToken(),
    fixture.provider.getToken(),
  ]);
  assert.deepEqual(reused, ["token-1", "token-1", "token-1"]);
  assert.equal(fixture.requests.length, 1);

  fixture.setNow(240_000);
  const refreshed = await Promise.all([
    fixture.provider.getToken(),
    fixture.provider.getToken(),
    fixture.provider.getToken(),
  ]);
  assert.deepEqual(refreshed, ["token-2", "token-2", "token-2"]);
  assert.equal(fixture.requests.length, 2);
});

void test("sends a redirect-blocked Basic request with no credentials in the URL or body", async () => {
  const fixture = createProvider();
  fixture.queueResponse(createJsonResponse(validTokenResponse));

  await fixture.provider.getToken();

  const request = fixture.requests[0];
  assert.ok(request);
  assert.equal(request.input, "https://huskly.finance/api/v1/machine/token");
  assert.equal(request.init.redirect, "error");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, undefined);

  const headers = new Headers(request.init.headers);
  assert.equal(
    headers.get("authorization"),
    `Basic ${Buffer.from("machine-client-id:machine-client-secret").toString("base64")}`
  );
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("content-type"), null);
  assert.equal(new URL(request.input).username, "");
  assert.equal(new URL(request.input).password, "");
});

void test("retries only transport failures, HTTP 429, and HTTP 5xx exactly three total attempts with [100, 200] delays", async () => {
  for (const mode of ["transport", "429", "503"] as const) {
    const fixture = createProvider();
    if (mode === "transport") {
      fixture.queueFailure(new TypeError("network down"));
      fixture.queueFailure(new TypeError("still down"));
    } else if (mode === "429") {
      fixture.queueResponse(createJsonResponse({ error: "busy" }, { status: 429 }));
      fixture.queueResponse(createJsonResponse({ error: "busy" }, { status: 429 }));
    } else {
      fixture.queueResponse(createJsonResponse({ error: "bad gateway" }, { status: 503 }));
      fixture.queueResponse(createJsonResponse({ error: "bad gateway" }, { status: 503 }));
    }
    fixture.queueResponse(createJsonResponse(validTokenResponse));

    assert.equal(await fixture.provider.getToken(), "token-1");
    assert.equal(fixture.requests.length, 3, mode);
    assert.deepEqual(fixture.delays, [100, 200], mode);
  }
});

void test("does not retry HTTP 4xx responses other than 429 or schema failures", async () => {
  const unauthorized = createProvider();
  unauthorized.queueResponse(createJsonResponse({ error: "nope" }, { status: 401 }));
  await assert.rejects(() => unauthorized.provider.getToken(), /token exchange failed/i);
  assert.equal(unauthorized.requests.length, 1);
  assert.deepEqual(unauthorized.delays, []);

  const invalidSchema = createProvider();
  invalidSchema.queueResponse(
    createJsonResponse({
      access_token: "token-1",
      token_type: "Bearer",
      expires_in: 300,
      scope: "ibkr:read-only",
      extra: true,
    })
  );
  await assert.rejects(() => invalidSchema.provider.getToken(), /token response/i);
  assert.equal(invalidSchema.requests.length, 1);
  assert.deepEqual(invalidSchema.delays, []);
});

void test("accepts fallback only while the old token remains unexpired", async () => {
  const fixture = createProvider();
  fixture.queueResponse(createJsonResponse(validTokenResponse));
  assert.equal(await fixture.provider.getToken(), "token-1");

  fixture.setNow(240_000);
  fixture.queueFailure(new TypeError("timeout-1"));
  fixture.queueFailure(new TypeError("timeout-2"));
  fixture.queueFailure(new TypeError("timeout-3"));
  assert.equal(await fixture.provider.getToken(), "token-1");
  assert.deepEqual(fixture.delays, [100, 200]);

  fixture.setNow(300_000);
  fixture.queueFailure(new TypeError("timeout-4"));
  fixture.queueFailure(new TypeError("timeout-5"));
  fixture.queueFailure(new TypeError("timeout-6"));
  await assert.rejects(() => fixture.provider.getToken(), /token exchange failed/i);
});

void test("rejects invalid token shapes, invalid expiry data, and oversized tokens", async () => {
  for (const body of [
    null,
    [],
    {},
    { ...validTokenResponse, token_type: "bearer" },
    { ...validTokenResponse, expires_in: 60 },
    { ...validTokenResponse, expires_in: 1.5 },
    { ...validTokenResponse, scope: "" },
    { ...validTokenResponse, access_token: "x".repeat(8_193) },
  ]) {
    const fixture = createProvider();
    fixture.queueResponse(createJsonResponse(body));
    await assert.rejects(() => fixture.provider.getToken(), /token response/i);
  }
});

void test("never serializes secrets or provider internals", () => {
  const fixture = createProvider();
  const serialized = JSON.stringify(fixture.provider);
  assert.equal(serialized, "{}");
  assert.doesNotMatch(serialized, /machine-client-id|machine-client-secret|token/i);
});
