import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGatewayConfig, type GatewayConfig } from "#src/gateway/gatewayConfig.js";

const validConfig: GatewayConfig = {
  gatewayUrl: "https://ibkr-gateway.example",
  tokenUrl: "https://huskly.finance/api/v1/machine/token",
  clientId: "machine-client-id",
  clientSecret: "machine-client-secret",
};

async function makeDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "huskly-gateway-config-"));
}

async function writeGatewayConfig(
  path: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  await writeFile(path, JSON.stringify(value), { mode });
  await chmod(path, mode);
}

function configPath(homeDirectory: string, runtime: "cli" | "mcp"): string {
  return join(
    homeDirectory,
    ".config",
    "huskly",
    runtime === "cli" ? "ibkr-gateway-cli.json" : "ibkr-gateway-mcp.json",
  );
}

async function expectConfigError(
  options: Parameters<typeof loadGatewayConfig>[0],
  pattern: RegExp,
): Promise<void> {
  await assert.rejects(
    () => loadGatewayConfig(options),
    (error: unknown) => error instanceof Error && pattern.test(error.message),
  );
}

function requiredUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error("process.getuid() is required for gateway config tests");
  }
  return uid;
}

void test("loads the CLI credential only from a private regular file", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway.json");

  try {
    await writeGatewayConfig(path, validConfig);

    const result = await loadGatewayConfig({
      runtime: "cli",
      env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
      homeDirectory: directory,
      uid: requiredUid(),
    });

    assert.deepEqual(result, validConfig);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("loads the MCP credential only from a private regular file", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway.json");

  try {
    await writeGatewayConfig(path, validConfig);

    const result = await loadGatewayConfig({
      runtime: "mcp",
      env: { HUSKLY_IBKR_GATEWAY_MCP_CONFIG: path },
      homeDirectory: directory,
      uid: requiredUid(),
    });

    assert.deepEqual(result, validConfig);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("uses the CLI default config path under the home directory", async () => {
  const directory = await makeDirectory();
  const path = configPath(directory, "cli");

  try {
    await mkdir(join(directory, ".config", "huskly"), { recursive: true });
    await writeGatewayConfig(path, validConfig);

    const result = await loadGatewayConfig({
      runtime: "cli",
      env: {},
      homeDirectory: directory,
      uid: requiredUid(),
    });

    assert.deepEqual(result, validConfig);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("uses the MCP default config path under the home directory", async () => {
  const directory = await makeDirectory();
  const path = configPath(directory, "mcp");

  try {
    await mkdir(join(directory, ".config", "huskly"), { recursive: true });
    await writeGatewayConfig(path, validConfig);

    const result = await loadGatewayConfig({
      runtime: "mcp",
      env: {},
      homeDirectory: directory,
      uid: requiredUid(),
    });

    assert.deepEqual(result, validConfig);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("uses only the runtime-specific override path", async () => {
  const directory = await makeDirectory();
  const cliPath = join(directory, "cli.json");
  const mcpPath = join(directory, "mcp.json");

  try {
    await writeGatewayConfig(cliPath, validConfig);
    await writeGatewayConfig(mcpPath, {
      ...validConfig,
      clientId: "mcp-client-id",
    });

    const cliResult = await loadGatewayConfig({
      runtime: "cli",
      env: {
        HUSKLY_IBKR_GATEWAY_CLI_CONFIG: cliPath,
        HUSKLY_IBKR_GATEWAY_MCP_CONFIG: mcpPath,
      },
      homeDirectory: directory,
      uid: requiredUid(),
    });
    const mcpResult = await loadGatewayConfig({
      runtime: "mcp",
      env: {
        HUSKLY_IBKR_GATEWAY_CLI_CONFIG: cliPath,
        HUSKLY_IBKR_GATEWAY_MCP_CONFIG: mcpPath,
      },
      homeDirectory: directory,
      uid: requiredUid(),
    });

    assert.equal(cliResult.clientId, validConfig.clientId);
    assert.equal(mcpResult.clientId, "mcp-client-id");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects malformed JSON", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway.json");

  try {
    await writeFile(path, '{"gatewayUrl":', { mode: 0o600 });
    await chmod(path, 0o600);

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /JSON/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects missing, unknown, empty, and unbounded fields", async () => {
  const directory = await makeDirectory();
  const missingPath = join(directory, "missing.json");
  const unknownPath = join(directory, "unknown.json");
  const emptyPath = join(directory, "empty.json");
  const unboundedPath = join(directory, "unbounded.json");

  try {
    await writeGatewayConfig(missingPath, {
      gatewayUrl: validConfig.gatewayUrl,
      tokenUrl: validConfig.tokenUrl,
      clientId: validConfig.clientId,
    });
    await writeGatewayConfig(unknownPath, {
      ...validConfig,
      extra: true,
    });
    await writeGatewayConfig(emptyPath, {
      ...validConfig,
      clientSecret: "   ",
    });
    await writeGatewayConfig(unboundedPath, {
      ...validConfig,
      clientSecret: "x".repeat(1025),
    });

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: missingPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /clientSecret|expected string/i,
    );
    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: unknownPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /unexpected|unknown/i,
    );
    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: emptyPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /clientSecret/,
    );
    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: unboundedPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /clientSecret/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects files larger than 16 KiB", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway.json");
  const oversized = `${"x".repeat(16_384)}
`;

  try {
    await writeFile(path, oversized, { mode: 0o600 });
    await chmod(path, 0o600);

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /16 KiB|16384/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects a config file owned by another user", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway.json");
  const uid = requiredUid();

  try {
    assert.notEqual(uid, undefined);
    await writeGatewayConfig(path, validConfig);

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
        homeDirectory: directory,
        uid: uid + 1,
      },
      /owner|uid/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects every permission mode except 0600", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway.json");

  try {
    await writeGatewayConfig(path, validConfig);

    for (let mode = 0; mode <= 0o7777; mode += 1) {
      await chmod(path, mode);
      if (mode === 0o600) {
        const result = await loadGatewayConfig({
          runtime: "cli",
          env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
          homeDirectory: directory,
          uid: requiredUid(),
        });
        assert.deepEqual(result, validConfig);
        continue;
      }

      await expectConfigError(
        {
          runtime: "cli",
          env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
          homeDirectory: directory,
          uid: requiredUid(),
        },
        /0600|mode|EACCES/i,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects a path that is not a regular file", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway-directory");

  try {
    await mkdir(path);

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /regular file/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects a symbolic link through the opened descriptor", async () => {
  const directory = await makeDirectory();
  const targetPath = join(directory, "gateway.json");
  const linkPath = join(directory, "gateway-link.json");

  try {
    await writeGatewayConfig(targetPath, validConfig);
    await symlink(targetPath, linkPath);

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: linkPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /symbolic link|symlink/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects non-HTTPS URLs by default", async () => {
  const directory = await makeDirectory();
  const path = join(directory, "gateway.json");

  try {
    await writeGatewayConfig(path, {
      ...validConfig,
      gatewayUrl: "http://gateway.example",
    });

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: path },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /HTTPS|https/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects URL credentials and fragments", async () => {
  const directory = await makeDirectory();
  const userPath = join(directory, "user.json");
  const passwordPath = join(directory, "password.json");
  const fragmentPath = join(directory, "fragment.json");

  try {
    await writeGatewayConfig(userPath, {
      ...validConfig,
      gatewayUrl: "https://user@gateway.example",
    });
    await writeGatewayConfig(passwordPath, {
      ...validConfig,
      tokenUrl: "https://user:secret@huskly.finance/api/v1/machine/token",
    });
    await writeGatewayConfig(fragmentPath, {
      ...validConfig,
      gatewayUrl: "https://gateway.example/#secret",
    });

    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: userPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /credentials|username|password/i,
    );
    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: passwordPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /credentials|username|password/i,
    );
    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: fragmentPath },
        homeDirectory: directory,
        uid: requiredUid(),
      },
      /fragment/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("allows only exact loopback HTTP URLs when enabled", async () => {
  const directory = await makeDirectory();
  const localhostPath = join(directory, "localhost.json");
  const ipv6Path = join(directory, "ipv6.json");
  const ipv4Path = join(directory, "ipv4.json");
  const rejectedPath = join(directory, "rejected.json");

  try {
    await writeGatewayConfig(localhostPath, {
      ...validConfig,
      gatewayUrl: "http://localhost:3000",
      tokenUrl: "http://localhost:4000/token",
    });
    await writeGatewayConfig(ipv6Path, {
      ...validConfig,
      gatewayUrl: "http://[::1]:3000",
      tokenUrl: "http://[::1]:4000/token",
    });
    await writeGatewayConfig(ipv4Path, {
      ...validConfig,
      gatewayUrl: "http://127.9.8.7:3000",
      tokenUrl: "http://127.0.0.1:4000/token",
    });
    await writeGatewayConfig(rejectedPath, {
      ...validConfig,
      gatewayUrl: "http://example.localhost.test",
    });

    assert.deepEqual(
      await loadGatewayConfig({
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: localhostPath },
        homeDirectory: directory,
        uid: requiredUid(),
        allowHttpLoopback: true,
      }),
      {
        ...validConfig,
        gatewayUrl: "http://localhost:3000",
        tokenUrl: "http://localhost:4000/token",
      },
    );
    assert.deepEqual(
      await loadGatewayConfig({
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: ipv6Path },
        homeDirectory: directory,
        uid: requiredUid(),
        allowHttpLoopback: true,
      }),
      {
        ...validConfig,
        gatewayUrl: "http://[::1]:3000",
        tokenUrl: "http://[::1]:4000/token",
      },
    );
    assert.deepEqual(
      await loadGatewayConfig({
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: ipv4Path },
        homeDirectory: directory,
        uid: requiredUid(),
        allowHttpLoopback: true,
      }),
      {
        ...validConfig,
        gatewayUrl: "http://127.9.8.7:3000",
        tokenUrl: "http://127.0.0.1:4000/token",
      },
    );
    await expectConfigError(
      {
        runtime: "cli",
        env: { HUSKLY_IBKR_GATEWAY_CLI_CONFIG: rejectedPath },
        homeDirectory: directory,
        uid: requiredUid(),
        allowHttpLoopback: true,
      },
      /loopback|HTTPS|https/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
