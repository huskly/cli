import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const fixturePath = path.join("test", "gateway", "removalInvariants.test.ts");

const forbiddenLiterals = [
  "@huskly/ibkr-client",
  "new IbkrClient",
  "buildOauthConfig",
  "IBIND_OAUTH1A_",
  "IBKR_KEYS_DIR",
  "IBKR_ACCOUNT_ID",
  "IBKR_TRANSACTION_CURRENCY",
  "CachedIbkrClient",
  "private_signature.pem",
  "private_encryption.pem",
  "dhparam.pem",
  "direct IBKR fallback",
] as const;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

function isScannedPath(file: string): boolean {
  if (file === fixturePath) return false;
  if (file.startsWith("src/")) return true;
  if (file.startsWith("docs/") && !file.startsWith("docs/superpowers/")) return true;
  if (file === "README.md" || file === "CLAUDE.md") return true;
  if (file === ".env.example" || file === ".gitignore") return true;
  if (file === "package.json" || file === "package-lock.json") return true;
  return false;
}

function findLiteralMatches(file: string, literal: string): string[] {
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  return source
    .split(/\r?\n/u)
    .flatMap((line, index) =>
      line.includes(literal) ? [`${file}:${String(index + 1)}:${line.trim()}`] : []
    );
}

describe("direct IBKR removal invariants", () => {
  it("keeps all forbidden literal fixtures only in this allowlisted test file", () => {
    const source = readFileSync(path.join(repoRoot, fixturePath), "utf8");
    for (const literal of forbiddenLiterals) {
      assert.equal(source.includes(literal), true, `Missing fixture literal ${literal}`);
    }
  });

  it("scans tracked source, config, package metadata, and docs for forbidden direct IBKR access", () => {
    const files = trackedFiles().filter(
      (file) => isScannedPath(file) && existsSync(path.join(repoRoot, file))
    );
    assert.notEqual(files.length, 0, "Invariant scan must cover tracked files");
    assert(files.includes("src/cli/shared.ts"), "Invariant scan must cover production source");
    assert(files.includes("package.json"), "Invariant scan must cover package metadata");
    assert(files.includes("README.md"), "Invariant scan must cover docs");
    assert(files.includes(".env.example"), "Invariant scan must cover config");

    const matches = files.flatMap((file) =>
      forbiddenLiterals.flatMap((literal) => findLiteralMatches(file, literal))
    );

    assert.deepEqual(matches, []);
  });

  it("keeps only the generated gateway client and npm lockfile", () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    assert.equal(packageJson.dependencies?.["@huskly/ibkr-gateway-client"], "0.5.0");
    assert.equal("@huskly/ibkr-client" in (packageJson.dependencies ?? {}), false);

    const packageLock = JSON.parse(
      readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")
    ) as {
      packages?: Record<string, { dependencies?: Record<string, string> }>;
    };
    const rootDependencies = packageLock.packages?.[""]?.dependencies ?? {};
    assert.equal(rootDependencies["@huskly/ibkr-gateway-client"], "0.5.0");
    assert.equal("@huskly/ibkr-client" in rootDependencies, false);
    assert.equal(trackedFiles().includes("yarn.lock"), false, "yarn.lock must stay absent");
  });
});
