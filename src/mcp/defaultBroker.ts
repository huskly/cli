import { resolveBroker } from "#src/cli/shared.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import { logger } from "#src/logger.js";

let cached: BrokerName | undefined;

/**
 * Server-wide default broker, read once from HUSKLY_MCP_DEFAULT_BROKER.
 * Falls back to "schwab" if the env var is unset or invalid, rather than
 * crashing the server over a misconfigured startup env var, but logs a
 * warning (to stderr) so an invalid value isn't silently ignored.
 */
export function defaultBroker(): BrokerName {
  if (cached !== undefined) return cached;
  try {
    cached = resolveBroker(process.env["HUSKLY_MCP_DEFAULT_BROKER"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`${message} Falling back to 'schwab'.`);
    cached = "schwab";
  }
  return cached;
}

/** Resolves the broker for a single tool call: an explicit param wins, else the server-wide default. */
export function resolveToolBroker(broker: string | undefined): BrokerName {
  return broker !== undefined ? resolveBroker(broker) : defaultBroker();
}
