import assert from "node:assert/strict";
import test from "node:test";
import { packageVersion } from "#src/cli/packageVersion.js";

test("packageVersion reads the real manifest version instead of a hardcoded string", () => {
  const version = packageVersion();
  assert.match(version, /^\d+\.\d+\.\d+/);
  assert.notEqual(version, "1.0.0");
});

test("packageVersion rejects a manifest without a version string", () => {
  const manifest = new URL("./fixtures/versionlessPackage.json", import.meta.url);
  assert.throws(() => packageVersion(manifest), /does not declare a version string/);
});
