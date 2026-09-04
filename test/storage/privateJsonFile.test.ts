import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  PrivateJsonFile,
  type PrivateJsonFilesystem,
  type PrivateJsonHandle,
  type PrivateJsonStats,
} from "#src/storage/privateJsonFile.js";

const schema = z.strictObject({
  schemaVersion: z.literal(1),
  value: z.string(),
});

function createSubject(directory: string, filename = "state.json") {
  return new PrivateJsonFile({ directory, filename, schema, maxBytes: 64 });
}

void test("creates a private 0700 directory and a 0600 file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-private-json-"));
  const targetDirectory = join(directory, "state");
  try {
    const file = createSubject(targetDirectory);
    await file.save({ schemaVersion: 1, value: "ok" });

    const directoryStat = await lstat(targetDirectory);
    const fileStat = await lstat(join(targetDirectory, "state.json"));
    assert.equal(directoryStat.mode & 0o777, 0o700);
    assert.equal(fileStat.mode & 0o777, 0o600);
    assert.deepEqual(await file.load(), { schemaVersion: 1, value: "ok" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("refuses symlink, non-regular, and loose existing targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-private-json-"));
  try {
    const target = join(directory, "state");
    await mkdir(target, { mode: 0o700 });

    await writeFile(join(target, "real.json"), JSON.stringify({ schemaVersion: 1, value: "ok" }), {
      mode: 0o600,
    });
    await symlink(join(target, "real.json"), join(target, "symlink.json"));
    await mkdir(join(target, "directory.json"), { mode: 0o700 });
    await writeFile(join(target, "loose.json"), JSON.stringify({ schemaVersion: 1, value: "ok" }), {
      mode: 0o644,
    });
    await chmod(join(target, "loose.json"), 0o644);

    await assert.rejects(
      () => createSubject(target, "symlink.json").load(),
      /symbolic link|symlink/i
    );
    await assert.rejects(() => createSubject(target, "directory.json").load(), /regular file/i);
    await assert.rejects(() => createSubject(target, "loose.json").load(), /0600|mode/i);
    await assert.rejects(
      () => createSubject(target, "symlink.json").save({ schemaVersion: 1, value: "x" }),
      /symbolic link|symlink/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("uses exclusive temp creation, fsyncs before rename, and fsyncs the directory after rename", async () => {
  const operations: string[] = [];
  const targetPath = "/secure/state.json";
  const tempPath = "/secure/.state.json.tmp-fixed";

  class FakeStats implements PrivateJsonStats {
    constructor(
      readonly kind: "file" | "directory",
      readonly mode: number,
      readonly size = 0
    ) {}
    isFile() {
      return this.kind === "file";
    }
    isDirectory() {
      return this.kind === "directory";
    }
  }

  class FakeHandle implements PrivateJsonHandle {
    data = "";
    constructor(
      readonly path: string,
      private readonly stats: FakeStats
    ) {}
    stat() {
      return Promise.resolve(this.stats);
    }
    read(_buffer: Buffer, _offset: number, _length: number, _position: number | null) {
      return Promise.resolve({ bytesRead: 0, buffer: Buffer.alloc(0) });
    }
    writeFile(data: string) {
      this.data = data;
      operations.push(`write:${this.path}`);
      return Promise.resolve();
    }
    chmod(mode: number) {
      operations.push(`chmod:${this.path}:${String(mode)}`);
      return Promise.resolve();
    }
    sync() {
      operations.push(`sync:${this.path}`);
      return Promise.resolve();
    }
    close() {
      operations.push(`close:${this.path}`);
      return Promise.resolve();
    }
  }

  const entries = new Map<string, FakeHandle>([
    ["/secure", new FakeHandle("/secure", new FakeStats("directory", 0o700))],
  ]);

  const fs: PrivateJsonFilesystem = {
    mkdir(path, options) {
      operations.push(`mkdir:${path}:${String(options.mode)}`);
      return Promise.resolve();
    },
    open(path, flags, mode) {
      operations.push(`open:${path}:${String(flags)}:${String(mode ?? "")}`);
      if (path === "/secure") {
        const handle = entries.get(path);
        if (handle === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return Promise.resolve(handle);
      }
      if (path === tempPath) {
        if ((flags & constants.O_EXCL) === 0) throw new Error("temp file must use O_EXCL");
        const handle = new FakeHandle(path, new FakeStats("file", 0o600));
        entries.set(path, handle);
        return Promise.resolve(handle);
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    rename(from, to) {
      operations.push(`rename:${from}:${to}`);
      const source = entries.get(from);
      if (source === undefined) throw new Error("missing temp");
      entries.set(
        to,
        new FakeHandle(to, new FakeStats("file", 0o600, Buffer.byteLength(source.data)))
      );
      entries.delete(from);
      return Promise.resolve();
    },
    unlink(path) {
      operations.push(`unlink:${path}`);
      entries.delete(path);
      return Promise.resolve();
    },
  };

  const file = new PrivateJsonFile({
    directory: "/secure",
    filename: "state.json",
    schema,
    fs,
    tempName: () => "fixed",
  });

  await file.save({ schemaVersion: 1, value: "ok" });

  assert.deepEqual(operations, [
    "mkdir:/secure:448",
    `open:/secure:${String(constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)}:`,
    "chmod:/secure:448",
    `open:${tempPath}:${String(constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW)}:384`,
    `write:${tempPath}`,
    `sync:${tempPath}`,
    `close:${tempPath}`,
    `open:${targetPath}:${String(constants.O_RDONLY | constants.O_NOFOLLOW)}:`,
    `rename:${tempPath}:${targetPath}`,
    "sync:/secure",
    "close:/secure",
  ]);
});

void test("cleans up the temp file when rename fails without hiding the write failure", async () => {
  const operations: string[] = [];

  class FakeStats implements PrivateJsonStats {
    constructor(
      readonly kind: "file" | "directory",
      readonly mode: number,
      readonly size = 0
    ) {}
    isFile() {
      return this.kind === "file";
    }
    isDirectory() {
      return this.kind === "directory";
    }
  }

  class FakeHandle implements PrivateJsonHandle {
    constructor(
      readonly path: string,
      private readonly stats: FakeStats
    ) {}
    stat() {
      return Promise.resolve(this.stats);
    }
    read(_buffer: Buffer, _offset: number, _length: number, _position: number | null) {
      return Promise.resolve({ bytesRead: 0, buffer: Buffer.alloc(0) });
    }
    writeFile(_data: string) {
      return Promise.resolve();
    }
    chmod(_mode: number) {
      return Promise.resolve();
    }
    sync() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }

  const fs: PrivateJsonFilesystem = {
    mkdir: () => Promise.resolve(),
    open(path) {
      operations.push(`open:${path}`);
      return Promise.resolve(
        new FakeHandle(
          path,
          new FakeStats(
            path === "/secure" ? "directory" : "file",
            path === "/secure" ? 0o700 : 0o600
          )
        )
      );
    },
    rename() {
      operations.push("rename");
      return Promise.reject(new Error("rename failed"));
    },
    unlink(path) {
      operations.push(`unlink:${path}`);
      return Promise.resolve();
    },
  };

  const file = new PrivateJsonFile({
    directory: "/secure",
    filename: "state.json",
    schema,
    fs,
    tempName: () => "cleanup",
  });

  await assert.rejects(() => file.save({ schemaVersion: 1, value: "ok" }), /rename failed/);
  assert.deepEqual(operations, [
    "open:/secure",
    "open:/secure/.state.json.tmp-cleanup",
    "open:/secure/state.json",
    "rename",
    "unlink:/secure/.state.json.tmp-cleanup",
  ]);
});

void test("enforces bounded reads and strict versioned schemas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-private-json-"));
  try {
    const target = join(directory, "state");
    await mkdir(target, { mode: 0o700 });
    await writeFile(
      join(target, "state.json"),
      JSON.stringify({ schemaVersion: 1, value: "x".repeat(80) }),
      {
        mode: 0o600,
      }
    );
    await chmod(join(target, "state.json"), 0o600);
    await assert.rejects(() => createSubject(target).load(), /64/);

    await writeFile(join(target, "state.json"), JSON.stringify({ value: "old" }), { mode: 0o600 });
    await chmod(join(target, "state.json"), 0o600);
    await assert.rejects(() => createSubject(target).load(), /schema|version|invalid/i);

    await writeFile(
      join(target, "state.json"),
      JSON.stringify({ schemaVersion: 1, value: "ok", extra: true }),
      {
        mode: 0o600,
      }
    );
    await chmod(join(target, "state.json"), 0o600);
    await assert.rejects(() => createSubject(target).load(), /schema|version|invalid|unexpected/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("compare-and-create reserves the final canonical file exactly once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huskly-private-create-"));
  try {
    const target = join(directory, "state");
    const left = createSubject(target);
    const right = createSubject(target);
    const created = await Promise.all([
      left.create({ schemaVersion: 1, value: "left" }),
      right.create({ schemaVersion: 1, value: "right" }),
    ]);
    assert.deepEqual([...created].sort(), [false, true]);
    const stored = await left.load();
    assert.ok(stored);
    assert.ok(stored.value === "left" || stored.value === "right");
    const stat = await lstat(join(target, "state.json"));
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
