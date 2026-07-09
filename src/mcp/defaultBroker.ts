import { resolveBroker } from "#src/cli/shared.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";

/**
 * Server-wide default broker, read once from HUSKLY_MCP_DEFAULT_BROKER.
 * Falls back to "schwab" if the env var is unset or invalid, rather than
 * crashing the server over a misconfigured startup env var.
 */
export function defaultBroker(): BrokerName {
  try {
    return resolveBroker(process.env["HUSKLY_MCP_DEFAULT_BROKER"]);
  } catch {
    return "schwab";
  }
}

/** Resolves the broker for a single tool call: an explicit param wins, else the server-wide default. */
export function resolveToolBroker(broker: string | undefined): BrokerName {
  return broker !== undefined ? resolveBroker(broker) : defaultBroker();
}
