import { IbkrClient, buildOauthConfig } from "@huskly/ibkr-client";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import type { DerivativeDiscoveryClient } from "./derivativeDiscovery.js";
import { IbkrDerivativeAdapter } from "./ibkrDerivativeAdapter.js";

export interface DerivativeDiscoveryFactories {
  ibkr(): Promise<DerivativeDiscoveryClient>;
}

/** Build a memoized capability resolver without widening the shared BrokerClient. */
export function createDerivativeDiscoveryResolver(factories: DerivativeDiscoveryFactories) {
  const clients = new Map<BrokerName, Promise<DerivativeDiscoveryClient>>();
  return (broker: BrokerName): Promise<DerivativeDiscoveryClient> => {
    if (broker !== "ibkr") {
      return Promise.reject(
        new Error(`Derivative discovery is not implemented for broker '${broker}' yet.`)
      );
    }
    const existing = clients.get(broker);
    if (existing) return existing;
    const client = factories.ibkr();
    clients.set(broker, client);
    return client;
  };
}

const resolveDerivativeDiscovery = createDerivativeDiscoveryResolver({
  ibkr: async () => {
    const client = new IbkrClient(buildOauthConfig());
    await client.init();
    return new IbkrDerivativeAdapter(client);
  },
});

/** Resolve a reusable broker-specific derivative discovery capability. */
export function derivativeDiscoveryClient(broker: BrokerName): Promise<DerivativeDiscoveryClient> {
  return resolveDerivativeDiscovery(broker);
}
