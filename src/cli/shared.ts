import { HusklyDeviceAuth } from "#src/auth/husklyDeviceAuth.js";
import { ensure } from "#src/helpers.js";
import { SchwabClient } from "@huskly/schwab-client";
import { CachedSchwabClient } from "#src/cachedSchwabClient.js";
import type { BrokerClient, BrokerName } from "#src/brokers/brokerClient.js";
import { SchwabBrokerAdapter } from "#src/brokers/schwabBrokerAdapter.js";
import { IbkrClient } from "#src/ibkr/ibkrClient.js";
import { buildOauthConfig } from "#src/ibkr/oauthConfig.js";
import * as asciichart from "asciichart";

export { asciichart };

/**
 * The full Schwab client used by Schwab-only commands (quote, chain, movers,
 * place-order, etc.). Authenticates via huskly.finance and wraps the client in
 * the Redis read-cache.
 */
export async function apiClient(): Promise<CachedSchwabClient> {
  const deviceAuth = new HusklyDeviceAuth();
  const accessToken = await deviceAuth.getAccessToken();
  const client = new SchwabClient(
    ensure(accessToken, "Not authenticated. Please run 'huskly login' to authenticate.")
  );
  return new CachedSchwabClient(client);
}

/**
 * Resolve a normalized {@link BrokerClient} for the shared commands
 * (`account`, `positions`). Schwab goes through the cached client; IBKR uses
 * its native OAuth 1.0a handshake and runs uncached.
 */
export async function brokerClient(broker: BrokerName): Promise<BrokerClient> {
  if (broker === "ibkr") {
    const client = new IbkrClient(buildOauthConfig());
    await client.init();
    return client;
  }
  return new SchwabBrokerAdapter(await apiClient());
}

/** Resolve the broker from a Commander option, validating the value. */
export function resolveBroker(value: string | undefined): BrokerName {
  const broker = (value ?? "schwab").toLowerCase();
  if (broker !== "ibkr" && broker !== "schwab") {
    throw new Error(`Invalid --broker '${broker}'. Expected 'ibkr' or 'schwab'.`);
  }
  return broker;
}

/** Guard for Schwab-only commands: throws a clear error under any other broker. */
export function requireSchwab(broker: BrokerName, command: string): void {
  if (broker !== "schwab") {
    throw new Error(
      `The '${command}' command is only available for --broker schwab (got '${broker}').`
    );
  }
}
