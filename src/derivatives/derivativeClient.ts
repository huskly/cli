import type { BrokerName } from "#src/brokers/brokerClient.js";
import {
  createGatewayMutationApi,
  GatewayMutationAdapter,
} from "#src/gateway/gatewayMutationAdapter.js";
import { cliGatewayTransport } from "#src/gateway/gatewayTransport.js";
import type { DerivativeDiscoveryClient } from "./derivativeDiscovery.js";
import type { DerivativeExecutionClient } from "./derivativeExecution.js";
import {
  createIbkrGatewayDerivativeReadApi,
  IbkrDerivativeAdapter,
} from "./ibkrDerivativeAdapter.js";
import type {
  DerivativeComboPreviewRequest,
  DerivativePreviewClient,
} from "./derivativePreview.js";

export interface DerivativeDiscoveryFactories {
  ibkr(): Promise<DerivativeDiscoveryClient>;
}

export function createDerivativeDiscoveryResolver(factories: DerivativeDiscoveryFactories) {
  const clients = new Map<BrokerName, Promise<DerivativeDiscoveryClient>>();
  return (broker: BrokerName): Promise<DerivativeDiscoveryClient> => {
    if (broker !== "ibkr") {
      return Promise.reject(
        new Error(`Derivative discovery is not implemented for broker '${broker}' yet.`)
      );
    }
    const existing = clients.get(broker);
    if (existing !== undefined) return existing;
    const client = factories.ibkr();
    clients.set(broker, client);
    return client;
  };
}

const resolveDerivativeDiscovery = createDerivativeDiscoveryResolver({
  ibkr: async () => {
    const transport = await cliGatewayTransport();
    return new IbkrDerivativeAdapter(createIbkrGatewayDerivativeReadApi(transport));
  },
});
let mutationPromise: Promise<GatewayMutationAdapter> | undefined;
function mutationClient(): Promise<GatewayMutationAdapter> {
  return (mutationPromise ??= cliGatewayTransport()
    .then((transport) => new GatewayMutationAdapter(createGatewayMutationApi(transport)))
    .catch((error: unknown) => {
      mutationPromise = undefined;
      throw error;
    }));
}

export function derivativeDiscoveryClient(broker: BrokerName): Promise<DerivativeDiscoveryClient> {
  return resolveDerivativeDiscovery(broker);
}

export async function derivativePreviewClient(
  broker: BrokerName
): Promise<DerivativePreviewClient> {
  if (broker !== "ibkr")
    throw new Error(`Derivative preview is not implemented for broker '${broker}' yet.`);
  const [discovery, mutation] = await Promise.all([
    resolveDerivativeDiscovery("ibkr"),
    mutationClient(),
  ]);
  const read = discovery as IbkrDerivativeAdapter;
  return {
    getTradingDiagnostics: () => read.getTradingDiagnostics(),
    previewDerivativeCombo: (request: DerivativeComboPreviewRequest) =>
      mutation.preview({
        ...request,
        legs: [
          { contract: request.legs[0].contract, ratio: 1 },
          { contract: request.legs[1].contract, ratio: -1 },
        ],
        orderType: "LMT",
      }),
  };
}

export async function derivativeExecutionClient(
  broker: BrokerName
): Promise<DerivativeExecutionClient> {
  if (broker !== "ibkr")
    throw new Error(`Derivative execution is not implemented for broker '${broker}' yet.`);
  return mutationClient();
}
