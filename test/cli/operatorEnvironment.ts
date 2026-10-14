import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run `action` with no ambient `HUSKLY_EXT_OPERATOR`, from an empty directory
 * that holds `envFile` as `.env` when given.
 */
export async function withOperatorEnvironment(
  envFile: string | undefined,
  action: () => Promise<void>
): Promise<void> {
  const previousOperator = process.env["HUSKLY_EXT_OPERATOR"];
  const previousDirectory = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "huskly-operator-"));
  delete process.env["HUSKLY_EXT_OPERATOR"];
  try {
    if (envFile !== undefined) await writeFile(join(directory, ".env"), envFile);
    process.chdir(directory);
    await action();
  } finally {
    process.chdir(previousDirectory);
    if (previousOperator !== undefined) process.env["HUSKLY_EXT_OPERATOR"] = previousOperator;
    await rm(directory, { recursive: true, force: true });
  }
}
