import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { requireOperator } from "#src/cli/shared.js";
import { withOperatorEnvironment } from "./operatorEnvironment.js";

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

void test("requireOperator prefers the flag, then the environment, then .env", async () => {
  await withOperatorEnvironment("HUSKLY_EXT_OPERATOR=from-file\n", () => {
    assert.equal(requireOperator(undefined), "from-file");
    process.env["HUSKLY_EXT_OPERATOR"] = "from-env";
    assert.equal(requireOperator(undefined), "from-env");
    assert.equal(requireOperator("from-flag"), "from-flag");
    return Promise.resolve();
  });
  await withOperatorEnvironment(undefined, () => {
    assert.throws(() => requireOperator(undefined), /HUSKLY_EXT_OPERATOR is required/);
    return Promise.resolve();
  });
});
