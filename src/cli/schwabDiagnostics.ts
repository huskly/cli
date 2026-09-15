import chalk from "chalk";
import { isCacheEnabled, probeCache, redisUrl } from "#src/cache.js";
import { maskAccountId } from "#src/derivatives/derivativePreviewService.js";

export interface SchwabDiagnostics {
  readonly broker: "schwab";
  readonly auth: {
    readonly authenticated: boolean;
    readonly tokenAvailable: boolean;
  };
  readonly cache: {
    readonly enabled: boolean;
    readonly reachable: boolean;
    readonly url: string;
  };
  readonly account: {
    readonly accessible: boolean;
    readonly count: number | null;
    readonly maskedId: string | null;
    readonly error: string | null;
  };
}

/** The Schwab reads a diagnostic needs; kept narrow so tests can supply a fake. */
export interface SchwabDiagnosticsSource {
  getAccessToken(): Promise<string | null>;
  fetchAccountNumbers(): Promise<readonly { accountNumber: string }[]>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Collect Schwab health facts.
 *
 * @remarks
 * Every check is independent and non-fatal. A diagnostic that throws on the
 * first problem hides the others, which is the opposite of what it is for.
 */
export async function collectSchwabDiagnostics(
  source: SchwabDiagnosticsSource
): Promise<SchwabDiagnostics> {
  const token = await source.getAccessToken().catch(() => null);
  const cacheEnabled = isCacheEnabled();

  let accessible = false;
  let count: number | null = null;
  let maskedId: string | null = null;
  let error: string | null = null;
  if (token !== null) {
    try {
      const accounts = await source.fetchAccountNumbers();
      accessible = true;
      count = accounts.length;
      const first = accounts[0];
      maskedId = first === undefined ? null : maskAccountId(first.accountNumber);
    } catch (caught) {
      error = message(caught);
    }
  } else {
    error = "Not authenticated.";
  }

  return {
    broker: "schwab",
    auth: { authenticated: token !== null, tokenAvailable: token !== null },
    cache: {
      enabled: cacheEnabled,
      reachable: cacheEnabled ? await probeCache() : false,
      url: redisUrl(),
    },
    account: { accessible, count, maskedId, error },
  };
}

function mark(ok: boolean): string {
  return ok ? chalk.green("✓") : chalk.red("✗");
}

export function renderSchwabDiagnostics(result: SchwabDiagnostics): string {
  const lines = [
    `Broker: schwab`,
    `${mark(result.auth.authenticated)} Authenticated: ${String(result.auth.authenticated)}`,
    result.cache.enabled
      ? `${mark(result.cache.reachable)} Cache: ${result.cache.reachable ? "reachable" : "unreachable"} at ${result.cache.url}`
      : `${chalk.yellow("-")} Cache: disabled with --no-cache`,
    `${mark(result.account.accessible)} Account access: ${result.account.accessible ? "ok" : "unavailable"}`,
    `  Accounts: ${result.account.count === null ? "-" : String(result.account.count)}  Primary: ${result.account.maskedId ?? "-"}`,
  ];
  if (result.account.error !== null) {
    lines.push(chalk.red(`  Problem: ${result.account.error}`));
  }
  if (!result.auth.authenticated) {
    lines.push(chalk.dim("  Fix: huskly-cli auth login"));
  }
  if (result.cache.enabled && !result.cache.reachable) {
    lines.push(chalk.dim("  Fix: start Redis, or rerun with --no-cache"));
  }
  return lines.join("\n");
}
