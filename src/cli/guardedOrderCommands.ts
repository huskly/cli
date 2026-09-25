import type { OrderOperation } from "@huskly/ibkr-gateway-client";

/** Every gateway-backed command declares the same broker flag and fallback. */
export const GATEWAY_BROKER_FLAG: readonly [string, string] = [
  "--broker <name>",
  "Broker to use: schwab or ibkr (default: ibkr)",
];

export interface WarningExecutionService {
  acknowledgeWarning(input: {
    readonly operationId: string;
    readonly replyId: string;
    readonly confirm: true;
  }): Promise<{ readonly operation: OrderOperation }>;
}

export function parseSide(value: string): "BUY" | "SELL" {
  const normalized = value.toUpperCase();
  if (normalized !== "BUY" && normalized !== "SELL") {
    throw new Error(`Invalid side '${value}'. Expected BUY or SELL.`);
  }
  return normalized;
}

export function parseTif(value: string): "DAY" | "GTC" {
  const normalized = value.toUpperCase();
  if (normalized !== "DAY" && normalized !== "GTC") {
    throw new Error(`Invalid TIF '${value}'. Expected DAY or GTC.`);
  }
  return normalized;
}

export function confirmed(value: boolean | undefined): true {
  if (value !== true) throw new Error("This operation requires --confirm.");
  return true;
}

export function output<T>(
  value: T,
  json: boolean | undefined,
  render: (result: T) => string,
  log: (line: string) => void
): void {
  log(json === true ? JSON.stringify(value, null, 2) : render(value));
}

/**
 * Acknowledge each broker warning of a new submission, one at a time.
 *
 * @remarks
 * `--confirm` on a submit command also confirms its broker warnings. A
 * repeated or endless warning sequence fails instead of looping.
 */
export async function acknowledgeWarnings<T extends { readonly operation: OrderOperation }>(
  result: T,
  createExecutionService: () => Promise<WarningExecutionService>
): Promise<{ readonly result: T; readonly count: number }> {
  let operation = result.operation;
  let count = 0;
  const handled = new Set<string>();
  let execution: WarningExecutionService | undefined;

  while (operation.state === "warning_pending") {
    const warning = operation.pendingWarning;
    if (warning === null) {
      throw new Error("Broker operation is warning_pending without a warning reply");
    }
    const identity = `${String(warning.sequence)}:${warning.replyId}`;
    if (handled.has(identity)) {
      throw new Error("Broker returned a repeated warning reply");
    }
    if (handled.size >= 32) {
      throw new Error("Broker returned too many sequential warnings");
    }
    handled.add(identity);
    execution ??= await createExecutionService();
    const acknowledged = await execution.acknowledgeWarning({
      operationId: operation.operationId,
      replyId: warning.replyId,
      confirm: true,
    });
    operation = acknowledged.operation;
    count += 1;
  }

  return { result: { ...result, operation }, count };
}
