import assert from "node:assert/strict";
import test from "node:test";
import { provisionIbkrCredentials } from "#src/auth/ibkrProvisioningClient.js";

const validClientId = "mc_ABCDEFGHIJKLMNOPQRSTUVWX";
const validMcpClientId = "mc_abcdefghijklmnopqrstuvwx";
const validSecret = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
const otherSecret = "abcdefghijklmnopqABCDEFGHIJKLMNOPQRSTUVWXYZ";

const validResponse = {
  gatewayUrl: "https://gateway.example",
  tokenUrl: "https://finance.example/api/v1/machine/token",
  credentials: {
    cli: { clientId: validClientId, clientSecret: validSecret },
    mcp: { clientId: validMcpClientId, clientSecret: otherSecret },
  },
} as const;

interface Fixture {
  readonly requests: { url: string; init: RequestInit }[];
  fetch: typeof fetch;
  queueResponse(response: Response): void;
  queueFailure(error: Error): void;
}

function createFixture(): Fixture {
  const requests: { url: string; init: RequestInit }[] = [];
  const responses: (() => Promise<Response>)[] = [];
  return {
    requests,
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, init: init ?? {} });
      const next = responses.shift();
      if (next === undefined) {
        throw new Error("No queued provisioning response");
      }
      return next();
    },
    queueResponse(response: Response): void {
      responses.push(() => Promise.resolve(response));
    },
    queueFailure(error: Error): void {
      responses.push(() => Promise.reject(error));
    },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function callProvisioning(fixture: Fixture) {
  return provisionIbkrCredentials(
    {
      baseUrl: "https://finance.example",
      sessionToken: "session-fixture",
      currentClientIds: { cli: undefined, mcp: undefined },
    },
    { fetch: fixture.fetch }
  );
}

void test("sends one non-redirecting first-use request with empty runtime credential objects", async () => {
  const fixture = createFixture();
  fixture.queueResponse(jsonResponse(validResponse));

  const result = await callProvisioning(fixture);

  assert.equal(fixture.requests.length, 1);
  const request = fixture.requests[0];
  assert.ok(request);
  assert.equal(request.url, "https://finance.example/api/v1/cli/ibkr-credentials/rotate");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "error");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer session-fixture");
  assert.equal(new Headers(request.init.headers).get("accept"), "application/json");
  assert.equal(new Headers(request.init.headers).get("content-type"), "application/json");
  assert.ok(typeof request.init.body === "string");
  assert.deepEqual(JSON.parse(request.init.body), { credentials: { cli: {}, mcp: {} } });
  assert.match(result.credentials.cli.clientId, /^mc_[A-Za-z0-9_-]{24}$/u);
  assert.deepEqual(result, validResponse);
});

void test("sends existing client IDs as currentClientId fields", async () => {
  const fixture = createFixture();
  fixture.queueResponse(jsonResponse(validResponse));

  await provisionIbkrCredentials(
    {
      baseUrl: "https://finance.example",
      sessionToken: "session-fixture",
      currentClientIds: { cli: validClientId, mcp: validMcpClientId },
    },
    { fetch: fixture.fetch }
  );

  const body = fixture.requests[0]?.init.body;
  assert.ok(typeof body === "string");
  assert.deepEqual(JSON.parse(body), {
    credentials: {
      cli: { currentClientId: validClientId },
      mcp: { currentClientId: validMcpClientId },
    },
  });
});

void test("maps provisioning status codes to fixed messages and ignores response text", async () => {
  for (const [status, pattern] of [
    [401, /authentication required/iu],
    [403, /not authorized/iu],
    [400, /request rejected/iu],
    [422, /request rejected/iu],
    [500, /service failure/iu],
  ] as const) {
    const fixture = createFixture();
    fixture.queueResponse(
      jsonResponse({ secret: validSecret, detail: "private server detail" }, { status })
    );
    await assert.rejects(
      () => callProvisioning(fixture),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, pattern);
        assert.doesNotMatch(error.message, /private|secret|ABCDEFGHIJKLMNOPQRSTUVWXYZ/u);
        return true;
      }
    );
  }
});

void test("converts redirect and network failures to a fixed service failure", async () => {
  const fixture = createFixture();
  fixture.queueFailure(new TypeError(`network failed with ${validSecret}`));

  await assert.rejects(
    () => callProvisioning(fixture),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /service failure/iu);
      assert.doesNotMatch(error.message, /network failed|ABCDEFGHIJKLMNOPQRSTUVWXYZ/u);
      return true;
    }
  );
});

void test("rejects response bodies larger than 16 KiB and invalid JSON", async () => {
  const oversized = createFixture();
  oversized.queueResponse(new Response("x".repeat(16_385), { status: 200 }));
  await assert.rejects(() => callProvisioning(oversized), /response is invalid/iu);

  const invalidJson = createFixture();
  invalidJson.queueResponse(new Response("{", { status: 200 }));
  await assert.rejects(() => callProvisioning(invalidJson), /response is invalid/iu);
});

void test("rejects unknown keys at every response level and missing keys", async () => {
  const invalidBodies: unknown[] = [
    { ...validResponse, extra: true },
    { ...validResponse, credentials: { ...validResponse.credentials, extra: true } },
    {
      ...validResponse,
      credentials: {
        ...validResponse.credentials,
        cli: { ...validResponse.credentials.cli, extra: true },
      },
    },
    { tokenUrl: validResponse.tokenUrl, credentials: validResponse.credentials },
    { ...validResponse, credentials: { cli: validResponse.credentials.cli } },
    {
      ...validResponse,
      credentials: { ...validResponse.credentials, cli: { clientId: validClientId } },
    },
  ];

  for (const body of invalidBodies) {
    const fixture = createFixture();
    fixture.queueResponse(jsonResponse(body));
    await assert.rejects(() => callProvisioning(fixture), /response is invalid/iu);
  }
});

void test("rejects non-HTTPS URLs, URL credentials, and fragments in request and response URLs", async () => {
  for (const baseUrl of [
    "http://finance.example",
    "https://user:pass@finance.example",
    "https://finance.example/#fragment",
  ]) {
    const fixture = createFixture();
    await assert.rejects(
      () =>
        provisionIbkrCredentials(
          {
            baseUrl,
            sessionToken: "session-fixture",
            currentClientIds: { cli: undefined, mcp: undefined },
          },
          { fetch: fixture.fetch }
        ),
      /HTTPS|credentials|fragment/iu
    );
    assert.equal(fixture.requests.length, 0);
  }

  for (const body of [
    { ...validResponse, gatewayUrl: "http://gateway.example" },
    { ...validResponse, tokenUrl: "https://user:pass@finance.example/token" },
    { ...validResponse, gatewayUrl: "https://gateway.example/#secret" },
  ]) {
    const fixture = createFixture();
    fixture.queueResponse(jsonResponse(body));
    await assert.rejects(() => callProvisioning(fixture), /HTTPS|credentials|fragment/iu);
  }
});

void test("rejects malformed current client IDs and empty or oversized credential fields", async () => {
  const badRequest = createFixture();
  await assert.rejects(
    () =>
      provisionIbkrCredentials(
        {
          baseUrl: "https://finance.example",
          sessionToken: "session-fixture",
          currentClientIds: { cli: "bad-client", mcp: undefined },
        },
        { fetch: badRequest.fetch }
      ),
    /request rejected/iu
  );
  assert.equal(badRequest.requests.length, 0);

  for (const body of [
    {
      ...validResponse,
      credentials: {
        ...validResponse.credentials,
        cli: { clientId: "", clientSecret: validSecret },
      },
    },
    {
      ...validResponse,
      credentials: {
        ...validResponse.credentials,
        cli: { clientId: `mc_${"A".repeat(25)}`, clientSecret: validSecret },
      },
    },
    {
      ...validResponse,
      credentials: {
        ...validResponse.credentials,
        cli: { clientId: validClientId, clientSecret: "" },
      },
    },
    {
      ...validResponse,
      credentials: {
        ...validResponse.credentials,
        cli: { clientId: validClientId, clientSecret: "A".repeat(44) },
      },
    },
  ]) {
    const fixture = createFixture();
    fixture.queueResponse(jsonResponse(body));
    await assert.rejects(() => callProvisioning(fixture), /response is invalid/iu);
  }
});

void test("does not include accidental secrets from invalid success bodies in thrown messages", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    jsonResponse({
      ...validResponse,
      credentials: {
        ...validResponse.credentials,
        cli: { ...validResponse.credentials.cli, clientSecret: `${validSecret}extra` },
      },
    })
  );

  await assert.rejects(
    () => callProvisioning(fixture),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "IBKR credential provisioning response is invalid");
      assert.doesNotMatch(error.message, /ABCDEFGHIJKLMNOPQRSTUVWXYZ/u);
      return true;
    }
  );
});
