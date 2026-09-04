import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  API_VERSION_HEADER,
  IbkrGatewayClient,
  SUPPORTED_API_VERSION,
  type CreateOrderOperationRequest,
} from "@huskly/ibkr-gateway-client";
import type { GatewayConfig } from "#src/gateway/gatewayConfig.js";
import {
  cliGatewayTransport,
  createGatewayTransport,
  mcpGatewayTransport,
  type GatewayTransportDependencies,
} from "#src/gateway/gatewayTransport.js";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";

function createGatewayResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      [API_VERSION_HEADER]: SUPPORTED_API_VERSION,
    },
    ...init,
  });
}

function createTransportFixture(overrides: Partial<GatewayTransportDependencies> = {}) {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const requests: { input: string; init: RequestInit }[] = [];
  const queuedResponses: (() => Promise<Response>)[] = [];
  const config: GatewayConfig = {
    gatewayUrl: "https://gateway.example",
    tokenUrl: "https://tokens.example/machine/token",
    clientId: "machine-client-id",
    clientSecret: "machine-client-secret",
  };

  const dependencies: GatewayTransportDependencies = {
    loadConfig: () => Promise.resolve(config),
    createTokenProvider: () => ({
      getToken(): Promise<string> {
        tokenCalls += 1;
        return Promise.resolve("bearer-token");
      },
    }),
    fetch: async (input, init) => {
      fetchCalls += 1;
      requests.push({ input, init });
      const next = queuedResponses.shift();
      if (next === undefined) {
        throw new Error("No queued gateway response");
      }
      return next();
    },
    ...overrides,
  };

  return {
    async create(runtime: "cli" | "mcp" = "cli") {
      return createGatewayTransport(runtime, dependencies);
    },
    requests,
    queueResponse(response: Response): void {
      queuedResponses.push(() => Promise.resolve(response));
    },
    queueFailure(error: Error): void {
      queuedResponses.push(() => Promise.reject(error));
    },
    get tokenCalls(): number {
      return tokenCalls;
    },
    get fetchCalls(): number {
      return fetchCalls;
    },
  };
}

const orderIntent = {
  kind: "single",
  contract: {
    conid: 7,
    assetClass: "OPT",
    underlying: "SPY",
    expiration: "2033-06-15",
    tradingClass: "SPY",
    exchange: "SMART",
    multiplier: 100,
    strike: 500,
    right: "C",
  },
  side: "BUY",
  quantity: 1,
  tif: "DAY",
  session: "REGULAR",
  extOperator: "",
  manualIndicator: false,
  orderType: "LMT",
  limit: 1.25,
} satisfies CreateOrderOperationRequest;

void test("pre-acquires the token, classifies token failures as authentication failures, and never reaches fetch", async () => {
  const transport = await createGatewayTransport("cli", {
    loadConfig: () =>
      Promise.resolve({
        gatewayUrl: "https://gateway.example",
        tokenUrl: "https://tokens.example/machine/token",
        clientId: "machine-client-id",
        clientSecret: "machine-client-secret",
      }),
    createTokenProvider: () => ({
      getToken(): Promise<string> {
        return Promise.reject(new Error("bearer-token client-secret acct-123"));
      },
    }),
  });

  await assert.rejects(
    transport.call("queryQuotes", (client) =>
      client.queryQuotes({ requests: [{ symbol: "SPY" }] })
    ),
    (error: unknown) =>
      error instanceof ConsumerError &&
      error.code === "authentication_failure" &&
      !/bearer-token|client-secret|acct-123/u.test(error.message)
  );
});

void test("sends one generated request per call and does not replay a 401 or 403 response", async () => {
  const fixture = createTransportFixture();
  fixture.queueResponse(
    createGatewayResponse(
      { error: { code: "forbidden", message: "do not leak this order payload" } },
      { status: 403 }
    )
  );

  const transport = await fixture.create();
  await assert.rejects(
    transport.call("createOrderOperation", (client) =>
      client.createOrderOperation(orderIntent, "key-1")
    ),
    (error: unknown) => error instanceof ConsumerError && error.code === "authorization_failure"
  );

  assert.equal(fixture.tokenCalls, 1);
  assert.equal(fixture.fetchCalls, 1);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0]?.input, "https://gateway.example/v1/order-operations");
  assert.doesNotMatch(JSON.stringify(transport), /client-secret|bearer-token|order payload/u);
});

void test("maps stable gateway failures and preserves successful recovery-required evidence", async () => {
  const fixture = createTransportFixture();
  const transport = await fixture.create();

  fixture.queueResponse(
    createGatewayResponse(
      { error: { code: "broker_unavailable", message: "Broker says acct-123 is down" } },
      { status: 503 }
    )
  );
  await assert.rejects(
    transport.call("queryQuotes", (client) =>
      client.queryQuotes({ requests: [{ symbol: "SPY" }] })
    ),
    (error: unknown) =>
      error instanceof ConsumerError &&
      error.code === "broker_data_unavailable" &&
      !error.message.includes("acct-123")
  );

  fixture.queueResponse(
    createGatewayResponse(
      { error: { code: "mutation_unavailable", message: "No mutation" } },
      {
        status: 503,
        headers: { [API_VERSION_HEADER]: SUPPORTED_API_VERSION, "retry-after": "120" },
      }
    )
  );
  await assert.rejects(
    transport.call("createOrderOperation", (client) =>
      client.createOrderOperation(orderIntent, "key-2")
    ),
    (error: unknown) =>
      error instanceof ConsumerError &&
      error.code === "mutation_unavailable" &&
      error.retryAfterSeconds === 120
  );

  fixture.queueResponse(
    createGatewayResponse(
      { error: { code: "idempotency_conflict", message: "conflict" } },
      { status: 409 }
    )
  );
  await assert.rejects(
    transport.call("createOrderOperation", (client) =>
      client.createOrderOperation(orderIntent, "key-3")
    ),
    (error: unknown) => error instanceof ConsumerError && error.code === "idempotency_conflict"
  );

  fixture.queueResponse(
    createGatewayResponse({
      operationId: "op-1",
      kind: "single",
      action: "submission",
      parentOperationId: null,
      intentSchemaVersion: 1,
      intentHash: "hash-1",
      state: "reconciliation_required",
      correlations: [],
      children: [],
      pendingWarning: null,
      reconciliation: {
        observedAt: "2026-09-04T00:00:00.000Z",
        status: "incomplete",
        reason: "private broker detail",
      },
      result: {
        kind: "recovery_required",
        orders: [],
        warningCount: 0,
        reasonCategories: ["broker"],
      },
      createdAt: "2026-09-04T00:00:00.000Z",
      latestTransitionAt: "2026-09-04T00:00:01.000Z",
    })
  );
  const recovery = await transport.call("createOrderOperation", (client) =>
    client.createOrderOperation(orderIntent, "key-4")
  );
  assert.equal(recovery.result?.kind, "recovery_required");
  assert.equal(recovery.reconciliation?.status, "incomplete");
  assert.deepEqual(recovery.result.reasonCategories, ["broker"]);
});

void test("maps version and transport failures to fixed consumer errors", async () => {
  const fixture = createTransportFixture();
  fixture.queueResponse(
    new Response(JSON.stringify({ status: "live", version: SUPPORTED_API_VERSION }), {
      status: 200,
      headers: { "content-type": "application/json", [API_VERSION_HEADER]: "0.4.0" },
    })
  );
  const transport = await fixture.create();
  await assert.rejects(
    transport.call("getLiveness", (client) => client.getLiveness()),
    (error: unknown) => error instanceof ConsumerError && error.code === "api_version_mismatch"
  );

  const broken = createTransportFixture();
  broken.queueFailure(new TypeError("gateway.example leaked order payload"));
  const brokenTransport = await broken.create();
  await assert.rejects(
    brokenTransport.call("getLiveness", (client) => client.getLiveness()),
    (error: unknown) =>
      error instanceof ConsumerError &&
      error.code === "gateway_transport_failure" &&
      !/order payload|gateway\.example/u.test(error.message)
  );
});

void test("creates separate lazy singleton transports for CLI and MCP with independent config files", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "gateway-transport-"));
  const configDir = join(tempHome, ".config", "huskly");
  await mkdir(configDir, { recursive: true });
  const cliConfigPath = join(configDir, "cli.json");
  const mcpConfigPath = join(configDir, "mcp.json");
  await writeFile(
    cliConfigPath,
    JSON.stringify({
      gatewayUrl: "https://gateway-cli.example",
      tokenUrl: "https://tokens-cli.example/machine/token",
      clientId: "cli-client-id",
      clientSecret: "cli-client-secret",
    })
  );
  await chmod(cliConfigPath, 0o600);
  await writeFile(
    mcpConfigPath,
    JSON.stringify({
      gatewayUrl: "https://gateway-mcp.example",
      tokenUrl: "https://tokens-mcp.example/machine/token",
      clientId: "mcp-client-id",
      clientSecret: "mcp-client-secret",
    })
  );
  await chmod(mcpConfigPath, 0o600);

  const fetchRequests: { input: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  process.env["HUSKLY_IBKR_GATEWAY_CLI_CONFIG"] = cliConfigPath;
  process.env["HUSKLY_IBKR_GATEWAY_MCP_CONFIG"] = mcpConfigPath;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetchRequests.push({ input: url, init: init ?? {} });
    if (url === "https://tokens-cli.example/machine/token") {
      return Promise.resolve(
        createGatewayResponse({
          access_token: "cli-token",
          token_type: "Bearer",
          expires_in: 300,
          scope: "ibkr:read-only",
        })
      );
    }
    if (url === "https://tokens-mcp.example/machine/token") {
      return Promise.resolve(
        createGatewayResponse({
          access_token: "mcp-token",
          token_type: "Bearer",
          expires_in: 300,
          scope: "ibkr:read-only",
        })
      );
    }
    if (url === "https://gateway-cli.example/livez") {
      return Promise.resolve(
        createGatewayResponse({ status: "live", version: SUPPORTED_API_VERSION })
      );
    }
    if (url === "https://gateway-mcp.example/livez") {
      return Promise.resolve(
        createGatewayResponse({ status: "live", version: SUPPORTED_API_VERSION })
      );
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const cliTransport = await cliGatewayTransport();
    const cliTransportAgain = await cliGatewayTransport();
    const mcpTransport = await mcpGatewayTransport();
    const mcpTransportAgain = await mcpGatewayTransport();

    assert.equal(cliTransport, cliTransportAgain);
    assert.equal(mcpTransport, mcpTransportAgain);
    assert.notEqual(cliTransport, mcpTransport);
    assert.ok(cliTransport.client instanceof IbkrGatewayClient);
    assert.ok(mcpTransport.client instanceof IbkrGatewayClient);
    assert.notEqual(cliTransport.client, mcpTransport.client);

    await cliTransport.call("getLiveness", (client) => client.getLiveness());
    await mcpTransport.call("getLiveness", (client) => client.getLiveness());

    assert.deepEqual(
      fetchRequests.map((request) => request.input),
      [
        "https://tokens-cli.example/machine/token",
        "https://gateway-cli.example/livez",
        "https://tokens-mcp.example/machine/token",
        "https://gateway-mcp.example/livez",
      ]
    );

    const cliGatewayRequest = fetchRequests[1];
    const mcpGatewayRequest = fetchRequests[3];
    assert.ok(cliGatewayRequest);
    assert.ok(mcpGatewayRequest);
    assert.equal(
      new Headers(cliGatewayRequest.init.headers).get("authorization"),
      "Bearer cli-token"
    );
    assert.equal(
      new Headers(mcpGatewayRequest.init.headers).get("authorization"),
      "Bearer mcp-token"
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env["HUSKLY_IBKR_GATEWAY_CLI_CONFIG"];
    delete process.env["HUSKLY_IBKR_GATEWAY_MCP_CONFIG"];
  }
});
