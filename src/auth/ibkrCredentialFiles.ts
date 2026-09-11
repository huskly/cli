import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  loadGatewayConfig,
  resolveGatewayConfigPath,
  type GatewayConfig,
  type GatewayConfigLoaderOptions,
  type GatewayRuntime,
} from "#src/gateway/gatewayConfig.js";

interface CredentialFileStats {
  readonly uid: number;
  readonly mode: number;
  isDirectory(): boolean;
}

export interface CredentialFileHandle {
  writeFile(data: string, options?: { encoding?: BufferEncoding }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface CredentialFileOperations {
  lstat(path: string): Promise<CredentialFileStats>;
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  open(path: string, flags: number, mode?: number): Promise<CredentialFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nodeOperations: CredentialFileOperations = {
  lstat,
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  chmod,
  open: async (path, flags, mode) => open(path, flags, mode),
  rename,
  unlink,
};

export interface IbkrCredentialFileOptions extends Omit<GatewayConfigLoaderOptions, "runtime"> {
  readonly fs?: CredentialFileOperations;
  readonly tempName?: () => string;
}

export interface CredentialFileInspection {
  readonly paths: Record<GatewayRuntime, string>;
  readonly currentClientIds: Partial<Record<GatewayRuntime, string>>;
  readonly anyExists: boolean;
}

export interface IbkrCredentialFileConfigs {
  readonly cli: GatewayConfig;
  readonly mcp: GatewayConfig;
}

interface Target {
  readonly runtime: GatewayRuntime;
  readonly path: string;
  readonly directory: string;
}

interface StagedFile {
  readonly path: string;
  readonly target: string;
  readonly directory: string;
}

export async function inspectIbkrCredentialFiles(
  options: IbkrCredentialFileOptions = {}
): Promise<CredentialFileInspection> {
  const targets = credentialTargets(options);
  const currentClientIds: Partial<Record<GatewayRuntime, string>> = {};
  let anyExists = false;

  await assertSafeDirectories(targets, options, false);

  for (const target of targets) {
    if (!(await pathExists(target.path, options.fs ?? nodeOperations))) {
      continue;
    }
    const config = await loadGatewayConfig({ ...options, runtime: target.runtime });
    currentClientIds[target.runtime] = config.clientId;
    anyExists = true;
  }

  return {
    paths: { cli: targets[0].path, mcp: targets[1].path },
    currentClientIds,
    anyExists,
  };
}

export async function installIbkrCredentialFiles(
  configs: IbkrCredentialFileConfigs,
  options: IbkrCredentialFileOptions = {}
): Promise<void> {
  const fs = options.fs ?? nodeOperations;
  const tempName = options.tempName ?? (() => randomUUID());
  const targets = credentialTargets(options);
  const staged: StagedFile[] = [];

  await assertSafeDirectories(targets, options, true);
  await assertSafeExistingTargets(targets, options);

  try {
    for (const target of targets) {
      const config = target.runtime === "cli" ? configs.cli : configs.mcp;
      const tempPath = `${target.path}.tmp-${tempName()}`;
      const handle = await fs.open(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      );
      staged.push({ path: tempPath, target: target.path, directory: target.directory });
      try {
        await handle.writeFile(`${JSON.stringify(config)}\n`, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
    }

    for (const stagedFile of staged) {
      await fs.rename(stagedFile.path, stagedFile.target);
      await syncDirectory(stagedFile.directory, fs);
    }
  } catch (error: unknown) {
    await Promise.all(staged.map((stagedFile) => unlinkQuietly(fs, stagedFile.path)));
    throw error;
  }
}

function credentialTargets(options: IbkrCredentialFileOptions): [Target, Target] {
  const cli = resolveGatewayConfigPath({ ...options, runtime: "cli" });
  const mcp = resolveGatewayConfigPath({ ...options, runtime: "mcp" });
  return [
    { runtime: "cli", path: cli, directory: dirname(cli) },
    { runtime: "mcp", path: mcp, directory: dirname(mcp) },
  ];
}

async function assertSafeDirectories(
  targets: readonly Target[],
  options: IbkrCredentialFileOptions,
  createMissing: boolean
): Promise<void> {
  const fs = options.fs ?? nodeOperations;
  const uid = requiredUid(options.uid);
  const checked = new Set<string>();

  for (const target of targets) {
    if (checked.has(target.directory)) continue;
    checked.add(target.directory);

    const before = await maybeLstat(fs, target.directory);
    if (before === undefined) {
      if (!createMissing) continue;
      await fs.mkdir(target.directory, { recursive: true, mode: 0o700 });
      await fs.chmod(target.directory, 0o700);
    }

    const stat = await fs.lstat(target.directory);
    if (!stat.isDirectory()) {
      throw new Error(`Gateway config directory at ${target.directory} must be a real directory`);
    }
    if (stat.uid !== uid) {
      throw new Error(
        `Gateway config directory at ${target.directory} must be owned by uid ${String(uid)}`
      );
    }
    if ((stat.mode & 0o7777) !== 0o700) {
      throw new Error(`Gateway config directory at ${target.directory} must have mode 0700`);
    }
  }
}

async function assertSafeExistingTargets(
  targets: readonly Target[],
  options: IbkrCredentialFileOptions
): Promise<void> {
  const fs = options.fs ?? nodeOperations;
  for (const target of targets) {
    if (!(await pathExists(target.path, fs))) continue;
    await loadGatewayConfig({ ...options, runtime: target.runtime });
  }
}

async function syncDirectory(path: string, fs: CredentialFileOperations): Promise<void> {
  let handle: CredentialFileHandle | undefined;
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch (error: unknown) {
    if (!isNodeErrorWithCode(error, "EINVAL") && !isNodeErrorWithCode(error, "ENOTSUP")) {
      throw error;
    }
  } finally {
    await closeQuietly(handle);
  }
}

function requiredUid(uid: number | undefined): number {
  const currentUid = uid ?? process.getuid?.();
  if (currentUid === undefined) {
    throw new Error("Gateway config ownership checks require a current uid");
  }
  return currentUid;
}

async function pathExists(path: string, fs: CredentialFileOperations): Promise<boolean> {
  return (await maybeLstat(fs, path)) !== undefined;
}

async function maybeLstat(
  fs: CredentialFileOperations,
  path: string
): Promise<CredentialFileStats | undefined> {
  try {
    return await fs.lstat(path);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function closeQuietly(handle: CredentialFileHandle | undefined): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // Cleanup must not replace the original failure.
  }
}

async function unlinkQuietly(fs: CredentialFileOperations, path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (error: unknown) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      // Cleanup must not replace the original failure.
    }
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
