import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Read the published CLI version from the package manifest.
 *
 * @remarks
 * The manifest is the single source of truth. A hardcoded version string goes
 * stale on every release, so `--version` must read the real manifest instead.
 */
export function packageVersion(
  manifestUrl = new URL("../../package.json", import.meta.url)
): string {
  const parsed: unknown = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    parsed.version === ""
  ) {
    throw new Error("package.json does not declare a version string.");
  }
  return parsed.version;
}
