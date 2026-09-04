import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ZodType } from "zod";

const DEFAULT_MAX_BYTES = 64 * 1024;

export interface PrivateJsonStats {
  readonly mode: number;
  readonly size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface PrivateJsonHandle {
  readonly path: string;
  stat(): Promise<PrivateJsonStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null
  ): Promise<{ bytesRead: number; buffer: Buffer }>;
  writeFile(data: string, options?: { encoding?: BufferEncoding }): Promise<void>;
  chmod(mode: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface PrivateJsonFilesystem {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<void>;
  open(path: string, flags: number, mode?: number): Promise<PrivateJsonHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nodeFilesystem: PrivateJsonFilesystem = {
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  open: async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    return {
      path,
      stat: () => handle.stat(),
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      writeFile: (data, options) => handle.writeFile(data, options),
      chmod: (nextMode) => handle.chmod(nextMode),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  rename,
  unlink,
};

export interface PrivateJsonFileOptions<T> {
  readonly directory: string;
  readonly filename: string;
  readonly schema: ZodType<T>;
  readonly maxBytes?: number;
  readonly fs?: PrivateJsonFilesystem;
  readonly tempName?: () => string;
}

export class PrivateJsonFile<T> {
  private readonly directory: string;
  private readonly filename: string;
  private readonly path: string;
  private readonly schema: ZodType<T>;
  private readonly maxBytes: number;
  private readonly fs: PrivateJsonFilesystem;
  private readonly tempName: () => string;

  constructor(options: PrivateJsonFileOptions<T>) {
    if (basename(options.filename) !== options.filename) {
      throw new Error("Private JSON filename must not contain path separators");
    }
    this.directory = options.directory;
    this.filename = options.filename;
    this.path = join(options.directory, options.filename);
    this.schema = options.schema;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fs = options.fs ?? nodeFilesystem;
    this.tempName = options.tempName ?? (() => `${String(process.pid)}-${randomUUID()}`);
  }

  async create(value: T): Promise<boolean> {
    const parsed = this.schema.parse(value);
    const source = JSON.stringify(parsed);
    if (Buffer.byteLength(source, "utf8") > this.maxBytes) {
      throw new Error(
        `Private JSON file at ${this.path} must be at most ${String(this.maxBytes)} bytes`
      );
    }

    await this.fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryHandle = await this.openDirectory();
    await directoryHandle.chmod(0o700);
    let handle: PrivateJsonHandle | undefined;
    let created = false;

    try {
      try {
        handle = await this.fs.open(
          this.path,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600
        );
        created = true;
      } catch (error: unknown) {
        if (isNodeErrorWithCode(error, "EEXIST")) {
          await this.assertSafeExistingTarget();
          return false;
        }
        throw error;
      }
      await handle.writeFile(source, { encoding: "utf8" });
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await directoryHandle.sync();
      return true;
    } catch (error: unknown) {
      await closeQuietly(handle);
      if (created) await unlinkQuietly(this.fs, this.path);
      throw error;
    } finally {
      await closeQuietly(directoryHandle);
    }
  }

  async save(value: T): Promise<void> {
    await this.fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryHandle = await this.openDirectory();
    await directoryHandle.chmod(0o700);
    const tempPath = join(this.directory, `.${this.filename}.tmp-${this.tempName()}`);
    let tempHandle: PrivateJsonHandle | undefined;

    try {
      tempHandle = await this.fs.open(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      );
      await tempHandle.writeFile(JSON.stringify(value), { encoding: "utf8" });
      await tempHandle.sync();
      await tempHandle.close();
      tempHandle = undefined;
      await this.assertSafeExistingTarget();
      await this.fs.rename(tempPath, this.path);
      await directoryHandle.sync();
    } catch (error: unknown) {
      await closeQuietly(tempHandle);
      await unlinkQuietly(this.fs, tempPath);
      throw error;
    } finally {
      await closeQuietly(directoryHandle);
    }
  }

  async load(): Promise<T | undefined> {
    const handle = await this.openExistingFile();
    if (handle === undefined) {
      return undefined;
    }

    try {
      const stat = await handle.stat();
      this.assertPrivateRegularFile(stat, this.path);
      const source = await readBoundedUtf8(handle, this.maxBytes, this.path);
      const parsed = parsePrivateJson(source, this.schema, this.path);
      return parsed;
    } finally {
      await closeQuietly(handle);
    }
  }

  async delete(): Promise<void> {
    const handle = await this.openExistingFile();
    if (handle === undefined) {
      return;
    }

    try {
      const stat = await handle.stat();
      this.assertPrivateRegularFile(stat, this.path);
    } finally {
      await closeQuietly(handle);
    }

    try {
      await this.fs.unlink(this.path);
    } catch (error: unknown) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }
    }
  }

  private async openDirectory(): Promise<PrivateJsonHandle> {
    const handle = await this.fs.open(
      this.directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    const stat = await handle.stat();
    if (!stat.isDirectory()) {
      await closeQuietly(handle);
      throw new Error(`Private JSON directory at ${this.directory} must be a directory`);
    }
    return handle;
  }

  private async openExistingFile(): Promise<PrivateJsonHandle | undefined> {
    try {
      return await this.fs.open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return undefined;
      }
      if (isNodeErrorWithCode(error, "ELOOP")) {
        throw new Error(`Private JSON file at ${this.path} must not be a symbolic link`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  private async assertSafeExistingTarget(): Promise<void> {
    const handle = await this.openExistingFile();
    if (handle === undefined) {
      return;
    }

    try {
      this.assertPrivateRegularFile(await handle.stat(), this.path);
    } finally {
      await closeQuietly(handle);
    }
  }

  private assertPrivateRegularFile(stat: PrivateJsonStats, path: string): void {
    if (!stat.isFile()) {
      throw new Error(`Private JSON file at ${path} must be a regular file`);
    }
    if ((stat.mode & 0o7777) != 0o600) {
      throw new Error(`Private JSON file at ${path} must have mode 0600`);
    }
  }
}

async function readBoundedUtf8(
  handle: PrivateJsonHandle,
  maxBytes: number,
  path: string
): Promise<string> {
  const buffer = Buffer.alloc(maxBytes + 1);
  let totalBytes = 0;

  while (totalBytes < buffer.length) {
    const { bytesRead } = await handle.read(buffer, totalBytes, buffer.length - totalBytes, null);
    if (bytesRead === 0) {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, totalBytes));
    }
    totalBytes += bytesRead;
  }

  throw new Error(`Private JSON file at ${path} must be at most ${String(maxBytes)} bytes`);
}

function parsePrivateJson<T>(source: string, schema: ZodType<T>, path: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error(`Private JSON file at ${path} must contain valid JSON`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Private JSON file at ${path} is invalid: ${result.error.issues.map((issue) => issue.message).join("; ")}`
    );
  }
  return result.data;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function closeQuietly(handle: PrivateJsonHandle | undefined): Promise<void> {
  if (handle === undefined) {
    return;
  }
  try {
    await handle.close();
  } catch {
    // Cleanup must not replace the write or read failure.
  }
}

async function unlinkQuietly(fs: PrivateJsonFilesystem, path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (error: unknown) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      // Cleanup must not replace the write failure.
    }
  }
}
