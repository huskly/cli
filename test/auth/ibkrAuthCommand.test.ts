import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  API_VERSION_HEADER,
  MIN_CLIENT_API_VERSION_HEADER,
  SUPPORTED_API_VERSION,
} from "@huskly/ibkr-gateway-client";
import { runIbkrAuthCommand } from "#src/auth/ibkrAuthCommand.js";
import type { IbkrProvisioningResponse } from "#src/auth/ibkrProvisioningClient.js";
import type {
  CredentialFileInspection,
  IbkrCredentialFileConfigs,
} from "#src/auth/ibkrCredentialFiles.js";
import type { GatewayRuntime } from "#src/gateway/gatewayConfig.js";

const execFileAsync = promisify(execFile);
const secretFixture = "SHOULD_NOT_APPEAR_TOKEN_OR_SECRET";
const cliClientId = "mc_AAAAAAAAAAAAAAAAAAAAAAAA";
const mcpClientId = "mc_BBBBBBBBBBBBBBBBBBBBBBBB";
const cliSecret = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const mcpSecret = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

const inspectionWithoutFiles: CredentialFileInspection = {
  paths: { cli: "/safe/cli.json", mcp: "/safe/mcp.json" },
  currentClientIds: {},
  anyExists: false,
};

const inspectionWithFiles: CredentialFileInspection = {
  paths: { cli: "/safe/cli.json", mcp: "/safe/mcp.json" },
  currentClientIds: { cli: cliClientId, mcp: mcpClientId },
  anyExists: true,
};

const provisioned: IbkrProvisioningResponse = {
  gatewayUrl: "https://gateway.example",
  tokenUrl: "https://huskly.finance/api/v1/machine/token",
  credentials: {
    cli: { clientId: cliClientId, clientSecret: cliSecret },
    mcp: { clientId: mcpClientId, clientSecret: mcpSecret },
  },
};

function createDependencies(
  overrides: {
    readonly inspection?: CredentialFileInspection;
    readonly firstSession?: string | null;
    readonly secondSession?: string | null;
    readonly promptAnswer?: string;
    readonly interactive?: boolean;
    readonly failInspect?: boolean;
    readonly failProvision?: boolean;
    readonly failInstall?: boolean;
    readonly failValidationRuntime?: GatewayRuntime;
  } = {}
) {
  const events: string[] = [];
  const output: string[] = [];
  const promptMessages: string[] = [];
  const installed: IbkrCredentialFileConfigs[] = [];
  let loginCalls = 0;
  let sessionCalls = 0;

  return {
    events,
    output,
    promptMessages,
    installed,
    get loginCalls() {
      return loginCalls;
    },
    dependencies: {
      auth: {
        getSessionToken: () => {
          events.push("session");
          sessionCalls += 1;
          const token =
            sessionCalls === 1
              ? Object.hasOwn(overrides, "firstSession")
                ? (overrides.firstSession ?? null)
                : "session-fixture"
              : Object.hasOwn(overrides, "secondSession")
                ? (overrides.secondSession ?? null)
                : "session-after-login";
          return Promise.resolve(token);
        },
        ensureAuthenticated: () => {
          events.push("login");
          loginCalls += 1;
          return Promise.resolve();
        },
      },
      inspectCredentialFiles: () => {
        events.push("inspect");
        if (overrides.failInspect === true) {
          return Promise.reject(new Error(`preflight failed ${secretFixture}`));
        }
        return Promise.resolve(overrides.inspection ?? inspectionWithoutFiles);
      },
      provisionCredentials: (input: {
        readonly sessionToken: string;
        readonly currentClientIds: Readonly<Record<GatewayRuntime, string | undefined>>;
      }) => {
        events.push("provision");
        assert.equal(input.sessionToken.startsWith("session"), true);
        if (overrides.failProvision === true) {
          return Promise.reject(new Error(`provision failed ${secretFixture}`));
        }
        return Promise.resolve(provisioned);
      },
      installCredentialFiles: (configs: IbkrCredentialFileConfigs) => {
        events.push("install");
        installed.push(configs);
        if (overrides.failInstall === true) {
          return Promise.reject(new Error(`install failed ${secretFixture}`));
        }
        return Promise.resolve();
      },
      validateCredential: (runtime: GatewayRuntime) => {
        events.push(`validate:${runtime}`);
        if (overrides.failValidationRuntime === runtime) {
          return Promise.reject(new Error(`validation failed ${secretFixture}`));
        }
        return Promise.resolve();
      },
      prompt: (message: string) => {
        promptMessages.push(message);
        return Promise.resolve(overrides.promptAnswer ?? "yes");
      },
      isInteractive: () => overrides.interactive ?? false,
      writeLine: (message: string) => {
        output.push(message);
        if (message === "IBKR gateway credentials are ready.") {
          events.push("success");
        }
      },
    },
  };
}

function assertNoSecrets(text: string): void {
  assert.doesNotMatch(text, /SHOULD_NOT_APPEAR|CCCCCCCC|DDDDDDDD|session-fixture/u);
}

void test("orchestrates preflight, session reuse, provisioning, installation, validation, and success", async () => {
  const fixture = createDependencies();

  await runIbkrAuthCommand({ replace: false }, fixture.dependencies);

  assert.deepEqual(fixture.events, [
    "inspect",
    "session",
    "provision",
    "install",
    "validate:cli",
    "validate:mcp",
    "success",
  ]);
});

void test("logs in once when the stored session is missing and continues with the new session", async () => {
  const fixture = createDependencies({ firstSession: null, secondSession: "session-after-login" });

  await runIbkrAuthCommand({ replace: false }, fixture.dependencies);

  assert.equal(fixture.loginCalls, 1);
  assert.deepEqual(fixture.events.slice(0, 4), ["inspect", "session", "login", "session"]);
  assert.ok(fixture.events.includes("provision"));
});

void test("prompts once on an interactive replacement and warns about immediate revocation", async () => {
  const fixture = createDependencies({ inspection: inspectionWithFiles, interactive: true });

  await runIbkrAuthCommand({ replace: false }, fixture.dependencies);

  assert.equal(fixture.promptMessages.length, 1);
  assert.match(fixture.promptMessages[0] ?? "", /immediately revokes/iu);
  assert.match(fixture.promptMessages[0] ?? "", /\/safe\/cli\.json/u);
});

void test("accepts only y and yes for replacement approval", async () => {
  for (const answer of ["y", "Y", " yes ", "YES"]) {
    const fixture = createDependencies({
      inspection: inspectionWithFiles,
      interactive: true,
      promptAnswer: answer,
    });
    await runIbkrAuthCommand({ replace: false }, fixture.dependencies);
    assert.ok(fixture.events.includes("provision"));
  }

  for (const answer of ["", "n", "true", "yeah", "ok"]) {
    const fixture = createDependencies({
      inspection: inspectionWithFiles,
      interactive: true,
      promptAnswer: answer,
    });
    await assert.rejects(
      () => runIbkrAuthCommand({ replace: false }, fixture.dependencies),
      /declined/iu
    );
    assert.deepEqual(fixture.events, ["inspect"]);
  }
});

void test("requires --replace non-interactively before provisioning when files exist", async () => {
  const fixture = createDependencies({ inspection: inspectionWithFiles, interactive: false });

  await assert.rejects(
    () => runIbkrAuthCommand({ replace: false }, fixture.dependencies),
    /--replace/iu
  );

  assert.deepEqual(fixture.events, ["inspect"]);
});

void test("--replace skips the prompt", async () => {
  const fixture = createDependencies({ inspection: inspectionWithFiles, interactive: true });

  await runIbkrAuthCommand({ replace: true }, fixture.dependencies);

  assert.equal(fixture.promptMessages.length, 0);
  assert.ok(fixture.events.includes("provision"));
});

void test("preflight failure stops before login and provisioning", async () => {
  const fixture = createDependencies({ failInspect: true });

  await assert.rejects(() => runIbkrAuthCommand({ replace: false }, fixture.dependencies));

  assert.deepEqual(fixture.events, ["inspect"]);
});

void test("provisioning failure leaves files untouched", async () => {
  const fixture = createDependencies({ failProvision: true });

  await assert.rejects(() => runIbkrAuthCommand({ replace: false }, fixture.dependencies));

  assert.deepEqual(fixture.events, ["inspect", "session", "provision"]);
  assert.equal(fixture.installed.length, 0);
});

void test("installation failure reports that remote rotation succeeded without leaking secrets", async () => {
  const fixture = createDependencies({ failInstall: true });

  await assert.rejects(
    () => runIbkrAuthCommand({ replace: false }, fixture.dependencies),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /remote rotation succeeded/iu);
      assert.match(error.message, /old credentials were revoked and must not be restored/iu);
      assert.match(error.message, /rerun `huskly-cli auth ibkr --replace`/iu);
      assertNoSecrets(error.message);
      return true;
    }
  );
  assert.deepEqual(fixture.events, ["inspect", "session", "provision", "install"]);
});

void test("validation failures leave new files installed and report the failing runtime", async () => {
  for (const runtime of ["cli", "mcp"] as const) {
    const fixture = createDependencies({ failValidationRuntime: runtime });
    await assert.rejects(
      () => runIbkrAuthCommand({ replace: false }, fixture.dependencies),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(runtime, "iu"));
        assert.match(error.message, /installed/iu);
        assert.match(error.message, /remote rotation succeeded/iu);
        assert.match(error.message, /old credentials were revoked and must not be restored/iu);
        assert.match(error.message, /fix IBKR gateway readiness and retry validation/iu);
        assert.match(error.message, /rerun `huskly-cli auth ibkr --replace`/iu);
        assertNoSecrets(error.message);
        return true;
      }
    );
    assert.equal(fixture.installed.length, 1);
  }
});

void test("success output does not contain fixture credentials or tokens", async () => {
  const fixture = createDependencies();

  await runIbkrAuthCommand({ replace: false }, fixture.dependencies);

  assertNoSecrets(fixture.output.join("\n"));
});

void test("integrates provisioning, real installation, and real validation with routed fetch", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "huskly-ibkr-auth-"));
  await chmod(tempHome, 0o700);
  const cliPath = join(tempHome, "config", "ibkr-gateway-cli.json");
  const mcpPath = join(tempHome, "config", "ibkr-gateway-mcp.json");
  const previousFetch = globalThis.fetch;
  const previousCliPath = process.env["HUSKLY_IBKR_GATEWAY_CLI_CONFIG"];
  const previousMcpPath = process.env["HUSKLY_IBKR_GATEWAY_MCP_CONFIG"];
  process.env["HUSKLY_IBKR_GATEWAY_CLI_CONFIG"] = cliPath;
  process.env["HUSKLY_IBKR_GATEWAY_MCP_CONFIG"] = mcpPath;

  const requests: { url: string; method: string | undefined; authorization: string | null }[] = [];
  const jsonResponse = (body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        [API_VERSION_HEADER]: SUPPORTED_API_VERSION,
        [MIN_CLIENT_API_VERSION_HEADER]: SUPPORTED_API_VERSION,
        ...headers,
      },
    });

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    requests.push({ url, method: init?.method, authorization: headers.get("authorization") });

    if (url === "https://huskly.finance/api/v1/cli/ibkr-credentials/rotate") {
      assert.equal(init?.method, "POST");
      assert.equal(headers.get("authorization"), "Bearer session-integration-token");
      const requestBody = init.body;
      if (typeof requestBody !== "string") throw new TypeError("Expected a string request body");
      assert.deepEqual(JSON.parse(requestBody), { credentials: { cli: {}, mcp: {} } });
      return Promise.resolve(jsonResponse(provisioned));
    }

    if (url === provisioned.tokenUrl) {
      assert.equal(init?.method, "POST");
      assert.match(headers.get("authorization") ?? "", /^Basic /u);
      return Promise.resolve(
        jsonResponse(
          {
            access_token: `access-${String(requests.length)}`,
            token_type: "Bearer",
            expires_in: 300,
            scope: "ibkr:read-write",
          },
          { "content-type": "application/json" }
        )
      );
    }

    const parsed = new URL(url);
    if (url === `${provisioned.gatewayUrl}/livez`) {
      assert.equal(init?.method, "GET");
      assert.equal(headers.get("authorization")?.startsWith("Bearer access-"), true);
      return Promise.resolve(jsonResponse({ status: "live", version: SUPPORTED_API_VERSION }));
    }
    if (parsed.href === `${provisioned.gatewayUrl}/v1/diagnostics`) {
      assert.equal(init?.method, "GET");
      assert.equal(headers.get("authorization")?.startsWith("Bearer access-"), true);
      return Promise.resolve(
        jsonResponse({ authenticated: true, connected: true, accountVerified: true })
      );
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    await runIbkrAuthCommand(
      { replace: false },
      {
        auth: {
          getSessionToken: () => Promise.resolve("session-integration-token"),
          ensureAuthenticated: () => Promise.reject(new Error("login must not run")),
        },
        writeLine: () => undefined,
      }
    );

    const cliFile = JSON.parse(await readFile(cliPath, "utf8")) as unknown;
    const mcpFile = JSON.parse(await readFile(mcpPath, "utf8")) as unknown;
    assert.deepEqual(cliFile, {
      gatewayUrl: provisioned.gatewayUrl,
      tokenUrl: provisioned.tokenUrl,
      clientId: cliClientId,
      clientSecret: cliSecret,
    });
    assert.deepEqual(mcpFile, {
      gatewayUrl: provisioned.gatewayUrl,
      tokenUrl: provisioned.tokenUrl,
      clientId: mcpClientId,
      clientSecret: mcpSecret,
    });
    assert.equal((await stat(cliPath)).mode & 0o777, 0o600);
    assert.equal((await stat(mcpPath)).mode & 0o777, 0o600);

    assert.deepEqual(
      requests.map((request) => new URL(request.url).pathname),
      [
        "/api/v1/cli/ibkr-credentials/rotate",
        "/api/v1/machine/token",
        "/livez",
        "/v1/diagnostics",
        "/api/v1/machine/token",
        "/livez",
        "/v1/diagnostics",
      ]
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCliPath === undefined) {
      delete process.env["HUSKLY_IBKR_GATEWAY_CLI_CONFIG"];
    } else {
      process.env["HUSKLY_IBKR_GATEWAY_CLI_CONFIG"] = previousCliPath;
    }
    if (previousMcpPath === undefined) {
      delete process.env["HUSKLY_IBKR_GATEWAY_MCP_CONFIG"];
    } else {
      process.env["HUSKLY_IBKR_GATEWAY_MCP_CONFIG"] = previousMcpPath;
    }
  }
});

void test("registered CLI help lists IBKR auth and --replace without running side effects", async () => {
  const baseArgs = ["--conditions=tsx", "--import", "tsx", "src/cli/index.ts"];
  const authHelp = await execFileAsync(process.execPath, [...baseArgs, "auth", "--help"], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  assert.match(authHelp.stdout, /ibkr/u);

  const ibkrHelp = await execFileAsync(process.execPath, [...baseArgs, "auth", "ibkr", "--help"], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  assert.match(ibkrHelp.stdout, /--replace/u);
});
