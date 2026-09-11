import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectIbkrCredentialFiles,
  installIbkrCredentialFiles,
  type CredentialFileOperations,
} from "#src/auth/ibkrCredentialFiles.js";
import type { GatewayConfig } from "#src/gateway/gatewayConfig.js";

const cliConfig: GatewayConfig = {
  gatewayUrl: "https://ibkr-gateway.example",
  tokenUrl: "https://huskly.finance/api/v1/machine/token",
  clientId: "mc_AAAAAAAAAAAAAAAAAAAAAAAA",
  clientSecret: "cli-secret-synthetic",
};

const mcpConfig: GatewayConfig = {
  gatewayUrl: "https://ibkr-gateway.example",
  tokenUrl: "https://huskly.finance/api/v1/machine/token",
  clientId: "mc_BBBBBBBBBBBBBBBBBBBBBBBB",
  clientSecret: "mcp-secret-synthetic",
};

const configs = { cli: cliConfig, mcp: mcpConfig };

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "huskly-ibkr-credentials-"));
}

function requiredUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("process.getuid() is required for tests");
  return uid;
}

function paths(homeDirectory: string) {
  const directory = join(homeDirectory, ".config", "huskly");
  return {
    directory,
    cli: join(directory, "ibkr-gateway-cli.json"),
    mcp: join(directory, "ibkr-gateway-mcp.json"),
  };
}

async function writeConfig(path: string, value: unknown, mode = 0o600): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode });
  await chmod(path, mode);
}

async function makeConfigDirectory(homeDirectory: string, mode = 0o700): Promise<void> {
  await mkdir(paths(homeDirectory).directory, { recursive: true, mode });
  await chmod(paths(homeDirectory).directory, mode);
}

async function expectInspectionError(
  homeDirectory: string,
  uid: number,
  pattern: RegExp
): Promise<void> {
  await assert.rejects(
    () => inspectIbkrCredentialFiles({ homeDirectory, uid }),
    (error: unknown) => error instanceof Error && pattern.test(error.message)
  );
}

void test("inspects missing credential files", async () => {
  const homeDirectory = await makeHome();
  try {
    assert.deepEqual(await inspectIbkrCredentialFiles({ homeDirectory, uid: requiredUid() }), {
      paths: { cli: paths(homeDirectory).cli, mcp: paths(homeDirectory).mcp },
      currentClientIds: {},
      anyExists: false,
    });
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

void test("inspects one valid credential file", async () => {
  const homeDirectory = await makeHome();
  try {
    await makeConfigDirectory(homeDirectory);
    await writeConfig(paths(homeDirectory).cli, cliConfig);

    assert.deepEqual(await inspectIbkrCredentialFiles({ homeDirectory, uid: requiredUid() }), {
      paths: { cli: paths(homeDirectory).cli, mcp: paths(homeDirectory).mcp },
      currentClientIds: { cli: cliConfig.clientId },
      anyExists: true,
    });
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

void test("inspects both valid credential files", async () => {
  const homeDirectory = await makeHome();
  try {
    await makeConfigDirectory(homeDirectory);
    await writeConfig(paths(homeDirectory).cli, cliConfig);
    await writeConfig(paths(homeDirectory).mcp, mcpConfig);

    assert.deepEqual(await inspectIbkrCredentialFiles({ homeDirectory, uid: requiredUid() }), {
      paths: {
        cli: join(homeDirectory, ".config", "huskly", "ibkr-gateway-cli.json"),
        mcp: join(homeDirectory, ".config", "huskly", "ibkr-gateway-mcp.json"),
      },
      currentClientIds: { cli: "mc_AAAAAAAAAAAAAAAAAAAAAAAA", mcp: "mc_BBBBBBBBBBBBBBBBBBBBBBBB" },
      anyExists: true,
    });
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

void test("inspection rejects malformed JSON, oversized files, symlinks, directories, wrong owners, and non-0600 modes", async () => {
  const uid = requiredUid();

  for (const [name, setup, pattern] of [
    [
      "malformed",
      async (home: string) => writeFile(paths(home).cli, "{", { mode: 0o600 }),
      /JSON/i,
    ],
    [
      "oversized",
      async (home: string) => writeFile(paths(home).cli, "x".repeat(16_385), { mode: 0o600 }),
      /16 KiB|16384/i,
    ],
    [
      "symlink",
      async (home: string) => {
        await writeConfig(join(home, "target.json"), cliConfig);
        await symlink(join(home, "target.json"), paths(home).cli);
      },
      /symbolic link|symlink/i,
    ],
    ["directory", async (home: string) => mkdir(paths(home).cli), /regular file/i],
    [
      "wrong owner",
      async (home: string) => writeConfig(paths(home).cli, cliConfig),
      /owned by uid|owner/i,
    ],
  ] as const) {
    const homeDirectory = await makeHome();
    try {
      await makeConfigDirectory(homeDirectory);
      await setup(homeDirectory);
      await expectInspectionError(homeDirectory, name === "wrong owner" ? uid + 1 : uid, pattern);
    } finally {
      await rm(homeDirectory, { recursive: true, force: true });
    }
  }

  const homeDirectory = await makeHome();
  try {
    await makeConfigDirectory(homeDirectory);
    await writeConfig(paths(homeDirectory).cli, cliConfig);
    for (let mode = 0; mode <= 0o7777; mode += 1) {
      await chmod(paths(homeDirectory).cli, mode);
      if (mode === 0o600) {
        assert.equal(
          (await inspectIbkrCredentialFiles({ homeDirectory, uid })).currentClientIds.cli,
          cliConfig.clientId
        );
      } else {
        await expectInspectionError(homeDirectory, uid, /0600|mode|EACCES/i);
      }
    }
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

void test("inspection rejects unsafe existing target directory", async () => {
  const homeDirectory = await makeHome();
  try {
    await makeConfigDirectory(homeDirectory, 0o755);
    await expectInspectionError(homeDirectory, requiredUid(), /0700|mode/i);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

void test("installs both private credential files", async () => {
  const homeDirectory = await makeHome();
  const targetPaths = paths(homeDirectory);
  try {
    await installIbkrCredentialFiles(configs, { homeDirectory, uid: requiredUid() });

    assert.equal((await stat(targetPaths.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(targetPaths.cli)).mode & 0o777, 0o600);
    assert.equal((await stat(targetPaths.mcp)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(targetPaths.cli, "utf8")), configs.cli);
    assert.deepEqual(JSON.parse(await readFile(targetPaths.mcp, "utf8")), configs.mcp);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

void test("installer stages, syncs, and closes both files before first rename", async () => {
  const homeDirectory = await makeHome();
  const targetPaths = paths(homeDirectory);
  try {
    await makeConfigDirectory(homeDirectory);
    const events: string[] = [];
    const fs: CredentialFileOperations = {
      lstat: (path) => lstat(path),
      mkdir: async (path, options) => {
        events.push(`mkdir:${path}:${options.mode.toString(8)}`);
        await mkdir(path, options);
      },
      chmod: async (path, mode) => {
        events.push(`chmod:${path}:${mode.toString(8)}`);
        await chmod(path, mode);
      },
      open: (path, flags, mode) => {
        events.push(`open:${path}:${String(flags)}:${mode?.toString(8) ?? ""}`);
        return Promise.resolve({
          writeFile: () => {
            events.push(`write:${path}`);
            return Promise.resolve();
          },
          sync: () => {
            events.push(`sync:${path}`);
            return Promise.resolve();
          },
          close: () => {
            events.push(`close:${path}`);
            return Promise.resolve();
          },
        });
      },
      rename: (from, to) => {
        events.push(`rename:${from}:${to}`);
        return Promise.resolve();
      },
      unlink: (path) => {
        events.push(`unlink:${path}`);
        return Promise.resolve();
      },
    };

    await installIbkrCredentialFiles(configs, {
      homeDirectory,
      uid: requiredUid(),
      fs,
      tempName: (() => {
        let index = 0;
        return () => `temp-${(index += 1).toString()}`;
      })(),
    });

    const firstRename = events.findIndex((event) => event.startsWith("rename:"));
    assert.ok(firstRename > 0);
    const closeEventsBeforeRename = events
      .slice(0, firstRename)
      .filter((event) => event.startsWith("close:"));
    assert.equal(closeEventsBeforeRename.length, 2);
    for (const event of events.filter(
      (item) => item.startsWith("open:") && item.includes(".tmp-")
    )) {
      const [, , flagsText, modeText] = event.split(":");
      const flags = Number(flagsText);
      assert.equal((flags & constants.O_CREAT) !== 0, true);
      assert.equal((flags & constants.O_EXCL) !== 0, true);
      assert.equal((flags & constants.O_WRONLY) !== 0, true);
      assert.equal((flags & constants.O_NOFOLLOW) !== 0, true);
      assert.equal(modeText, "600");
    }
    assert.ok(
      events.some((event) => event === `rename:${targetPaths.cli}.tmp-temp-1:${targetPaths.cli}`)
    );
    assert.ok(
      events.some((event) => event === `rename:${targetPaths.mcp}.tmp-temp-2:${targetPaths.mcp}`)
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

void test("installer cleans temporary files after second rename fails without restoring old target data", async () => {
  const homeDirectory = await makeHome();
  const targetPaths = paths(homeDirectory);
  try {
    await makeConfigDirectory(homeDirectory);
    await writeConfig(targetPaths.cli, { ...cliConfig, clientId: "old-cli" });
    await writeConfig(targetPaths.mcp, { ...mcpConfig, clientId: "old-mcp" });

    const unlinks: string[] = [];
    const fs: CredentialFileOperations = {
      lstat,
      mkdir: async (path, options) => {
        await mkdir(path, options);
      },
      chmod,
      open: async (path, flags, mode) => open(path, flags, mode),
      rename: async (from, to) => {
        if (to === targetPaths.mcp) throw new Error("synthetic second rename failure");
        await rename(from, to);
      },
      unlink: async (path) => {
        unlinks.push(path);
        await rm(path, { force: true });
      },
    };

    await assert.rejects(
      () =>
        installIbkrCredentialFiles(configs, {
          homeDirectory,
          uid: requiredUid(),
          fs,
          tempName: (() => {
            let index = 0;
            return () => `failure-${(index += 1).toString()}`;
          })(),
        }),
      /second rename failure/
    );

    assert.deepEqual(JSON.parse(await readFile(targetPaths.cli, "utf8")), configs.cli);
    assert.deepEqual(JSON.parse(await readFile(targetPaths.mcp, "utf8")), {
      ...mcpConfig,
      clientId: "old-mcp",
    });
    assert.ok(unlinks.includes(`${targetPaths.cli}.tmp-failure-1`));
    assert.ok(unlinks.includes(`${targetPaths.mcp}.tmp-failure-2`));
    assert.equal(await exists(`${targetPaths.mcp}.tmp-failure-2`), false);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    return !(error instanceof Error && "code" in error && error.code === "ENOENT");
  }
}
