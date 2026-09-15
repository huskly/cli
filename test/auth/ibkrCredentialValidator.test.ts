import assert from "node:assert/strict";
import test from "node:test";
import {
  API_VERSION_HEADER,
  MIN_CLIENT_API_VERSION_HEADER,
  SUPPORTED_API_VERSION,
} from "@huskly/ibkr-gateway-client";
import { validateIbkrCredential } from "#src/auth/ibkrCredentialValidator.js";
import type { GatewayConfig } from "#src/gateway/gatewayConfig.js";

const config: GatewayConfig = {
  gatewayUrl: "https://gateway.example",
  tokenUrl: "https://tokens.example/api/v1/machine/token",
  clientId: "machine-client-id",
  clientSecret: "machine-client-secret",
};

const validTokenResponse = {
  access_token: "access-secret-token",
  token_type: "Bearer",
  expires_in: 300,
  scope: "ibkr:read-write",
} as const;

const validDiagnostics = {
  authenticated: true,
  connected: true,
  accountVerified: true,
  account: "acct-SECRET",
} as const;

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      [API_VERSION_HEADER]: SUPPORTED_API_VERSION,
      [MIN_CLIENT_API_VERSION_HEADER]: SUPPORTED_API_VERSION,
    },
    ...init,
  });
}

function createRawResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      [API_VERSION_HEADER]: SUPPORTED_API_VERSION,
      [MIN_CLIENT_API_VERSION_HEADER]: SUPPORTED_API_VERSION,
    },
    ...init,
  });
}

function createFixture() {
  const paths: string[] = [];
  const responses: (() => Promise<Response>)[] = [];

  return {
    paths,
    fetch: async (input: string | URL | Request): Promise<Response> => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      paths.push(new URL(href).pathname);
      const next = responses.shift();
      if (next === undefined) {
        throw new Error(
          "No queued response with access-secret-token machine-client-secret acct-SECRET"
        );
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

function queueSuccess(fixture: ReturnType<typeof createFixture>): void {
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(createJsonResponse({ status: "live", version: SUPPORTED_API_VERSION }));
  fixture.queueResponse(createJsonResponse(validDiagnostics));
}

async function assertRedactedFailure(
  promise: Promise<void>,
  expectedMessage: string
): Promise<Error> {
  let captured: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    captured = error;
  }

  assert.ok(captured instanceof Error);
  assert.equal(captured.message, expectedMessage);
  assert.doesNotMatch(
    captured.message,
    /machine-client-secret|access-secret-token|acct-SECRET|do not leak|raw transport message|full response body|getLiveness|getDiagnostics|Machine token/u
  );
  assert.doesNotMatch(
    captured.stack ?? "",
    /machine-client-secret|access-secret-token|acct-SECRET|do not leak|raw transport message|full response body/u
  );
  return captured;
}

void test("validates token scope, liveness, and diagnostics once for a ready CLI runtime", async () => {
  const fixture = createFixture();
  queueSuccess(fixture);

  await validateIbkrCredential("cli", config, { fetch: fixture.fetch });

  assert.deepEqual(fixture.paths, ["/api/v1/machine/token", "/livez", "/v1/diagnostics"]);
});

void test("rejects wrong token scope with a fixed redacted error and does not call the gateway", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(
      { ...validTokenResponse, scope: "ibkr:read-only", access_token: "access-secret-token" },
      { headers: { "content-type": "application/json" } }
    )
  );

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed token scope validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token"]);
});

void test("rejects token exchange failure with a fixed redacted error", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(
      { error: { message: "do not leak machine-client-secret access-secret-token" } },
      { status: 401, headers: { "content-type": "application/json" } }
    )
  );

  await assertRedactedFailure(
    validateIbkrCredential("mcp", config, { fetch: fixture.fetch }),
    "IBKR MCP credential failed token exchange validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token"]);
});

void test("rejects incompatible gateway API version with a fixed redacted error", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(
    createJsonResponse(
      { status: "live", version: "0.4.0", secret: "full response body acct-SECRET" },
      {
        headers: {
          "content-type": "application/json",
          [API_VERSION_HEADER]: "0.4.0",
          [MIN_CLIENT_API_VERSION_HEADER]: "0.4.0",
        },
      }
    )
  );

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway compatibility validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token", "/livez"]);
});

void test("rejects missing gateway API version with a fixed redacted error", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(
    createJsonResponse(
      { status: "live", version: SUPPORTED_API_VERSION, secret: "full response body acct-SECRET" },
      {
        headers: {
          "content-type": "application/json",
          [MIN_CLIENT_API_VERSION_HEADER]: SUPPORTED_API_VERSION,
        },
      }
    )
  );

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway compatibility validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token", "/livez"]);
});

void test("rejects a missing minimum client API version with a fixed redacted error", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(
    createJsonResponse(
      { status: "live", version: SUPPORTED_API_VERSION },
      {
        headers: {
          "content-type": "application/json",
          [API_VERSION_HEADER]: SUPPORTED_API_VERSION,
        },
      }
    )
  );

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway compatibility validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token", "/livez"]);
});

void test("rejects a minimum client API version above this client", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(
    createJsonResponse(
      { status: "live", version: "0.12.0" },
      {
        headers: {
          "content-type": "application/json",
          [API_VERSION_HEADER]: "0.12.0",
          [MIN_CLIENT_API_VERSION_HEADER]: "0.12.0",
        },
      }
    )
  );

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway compatibility validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token", "/livez"]);
});

void test("rejects failed liveness with a fixed redacted error and no retry", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(
    createJsonResponse(
      { error: { code: "internal_error", message: "do not leak full response body" } },
      { status: 500 }
    )
  );

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway liveness validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token", "/livez"]);
});

void test("rejects malformed diagnostics with a fixed redacted error", async () => {
  const fixture = createFixture();
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(createJsonResponse({ status: "live", version: SUPPORTED_API_VERSION }));
  fixture.queueResponse(createRawResponse("not json raw transport message access-secret-token"));

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway diagnostics validation"
  );
  assert.deepEqual(fixture.paths, ["/api/v1/machine/token", "/livez", "/v1/diagnostics"]);
});

void test("rejects diagnostics without authenticated true", async () => {
  const fixture = createFixture();
  queueSuccessWithDiagnostics(fixture, { ...validDiagnostics, authenticated: false });

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway authentication validation"
  );
});

void test("rejects diagnostics without connected true", async () => {
  const fixture = createFixture();
  queueSuccessWithDiagnostics(fixture, { ...validDiagnostics, connected: null });

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway connection validation"
  );
});

void test("rejects diagnostics without accountVerified true", async () => {
  const fixture = createFixture();
  queueSuccessWithDiagnostics(fixture, { ...validDiagnostics, accountVerified: false });

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway account validation"
  );
});

void test("rejects diagnostics missing readiness fields as malformed", async () => {
  const fixture = createFixture();
  queueSuccessWithDiagnostics(fixture, {
    authenticated: true,
    connected: true,
    account: "acct-SECRET",
  });

  await assertRedactedFailure(
    validateIbkrCredential("cli", config, { fetch: fixture.fetch }),
    "IBKR CLI credential failed gateway diagnostics validation"
  );
});

function queueSuccessWithDiagnostics(
  fixture: ReturnType<typeof createFixture>,
  diagnostics: unknown
): void {
  fixture.queueResponse(
    createJsonResponse(validTokenResponse, { headers: { "content-type": "application/json" } })
  );
  fixture.queueResponse(createJsonResponse({ status: "live", version: SUPPORTED_API_VERSION }));
  fixture.queueResponse(createJsonResponse(diagnostics));
}
