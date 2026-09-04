import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

void test("shared gateway commands import without loading the Schwab keychain", async () => {
  const source = `
    import Module from "node:module";
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (String(request).includes("keytar")) {
        throw new Error("shared gateway import loaded keytar");
      }
      return Reflect.apply(originalLoad, this, [request, parent, isMain]);
    };
    await import("./src/cli/shared.ts");
  `;

  const result = await execFileAsync(
    process.execPath,
    ["--conditions=tsx", "--import", "tsx", "--input-type=module", "--eval", source],
    { cwd: repoRoot, env: process.env }
  );

  assert.equal(result.stderr, "");
});
