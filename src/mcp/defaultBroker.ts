import { resolveBroker, apiClient } from "#src/cli/shared.js";
import type { BrokerClient, BrokerName } from "#src/brokers/brokerClient.js";
import { createIbkrGatewayReadApi, IbkrBrokerAdapter } from "#src/brokers/ibkrBrokerAdapter.js";
import { SchwabBrokerAdapter } from "#src/brokers/schwabBrokerAdapter.js";
import { mcpGatewayTransport, type GatewayTransport } from "#src/gateway/gatewayTransport.js";
import { logger } from "#src/logger.js";

let cached: BrokerName | undefined;

export interface McpBrokerClientDependencies {
  readonly resolveGatewayTransport?: () => Promise<GatewayTransport>;
  readonly createSchwabClient?: () => Promise<BrokerClient>;
}

export function createMcpBrokerClientResolver(
  dependencies: McpBrokerClientDependencies = {}
): (broker: BrokerName) => Promise<BrokerClient> {
  const clients = new Map<BrokerName, Promise<BrokerClient>>();
  return (broker: BrokerName): Promise<BrokerClient> => {
    const existing = clients.get(broker);
    if (existing !== undefined) {
      return existing;
    }

    const promise =
      broker === "ibkr"
        ? (dependencies.resolveGatewayTransport ?? mcpGatewayTransport)().then(
            (transport) => new IbkrBrokerAdapter(createIbkrGatewayReadApi(transport))
          )
        : (
            dependencies.createSchwabClient ??
            (() => apiClient().then((client) => new SchwabBrokerAdapter(client)))
          )();

    const resetOnFailure = promise.catch((error: unknown) => {
      clients.delete(broker);
      throw error;
    });
    clients.set(broker, resetOnFailure);
    return resetOnFailure;
  };
}

const resolveMcpBrokerClient = createMcpBrokerClientResolver();

export function mcpBrokerClient(broker: BrokerName): Promise<BrokerClient> {
  return resolveMcpBrokerClient(broker);
}

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
