import { IbkrClient, buildOauthConfig } from "@huskly/ibkr-client";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import { cliGatewayTransport } from "#src/gateway/gatewayTransport.js";
import type {
  DerivativeContract,
  DerivativeDiscoveryClient,
} from "./derivativeDiscovery.js";
import type { DerivativeExecutionClient } from "./derivativeExecution.js";
import type {
  DerivativeComboExecutionRequest,
  DerivativeOrderLifecycle,
  DerivativeOrderSubmissionResult,
} from "./derivativeExecution.js";
import {
  createIbkrGatewayDerivativeReadApi,
  IbkrDerivativeAdapter,
} from "./ibkrDerivativeAdapter.js";
import type {
  DerivativeComboPreviewRequest,
  DerivativeComboPreviewResult,
  DerivativePreviewClient,
  TradingDiagnostics,
} from "./derivativePreview.js";

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

let directIbkrPromise: Promise<IbkrClient> | undefined;

function directIbkrClient(): Promise<IbkrClient> {
  return (directIbkrPromise ??= (async () => {
    const client = new IbkrClient(buildOauthConfig());
    await client.init();
    return client;
  })().catch((error: unknown) => {
    directIbkrPromise = undefined;
    throw error;
  }));
}

const resolveDerivativeDiscovery = createDerivativeDiscoveryResolver({
  ibkr: async () => {
    const transport = await cliGatewayTransport();
    return new IbkrDerivativeAdapter(createIbkrGatewayDerivativeReadApi(transport));
  },
});


function toLegacyContract(contract: DerivativeContract) {
  const contractId = Number(contract.brokerReference?.contractId);
  if (contract.brokerReference?.broker !== "ibkr" || !Number.isSafeInteger(contractId) || contractId <= 0) {
    throw new Error("Derivative contract does not contain a valid IBKR broker reference");
  }
  return {
    conid: contractId,
    assetClass: contract.identity.assetClass,
    underlying: contract.identity.underlying,
    expiration: contract.identity.expiration,
    strike: contract.identity.strike,
    right: contract.identity.right === "CALL" ? "C" as const : "P" as const,
    tradingClass: contract.identity.tradingClass,
    exchange: contract.identity.exchange,
    multiplier: contract.identity.multiplier,
    ...(contract.identity.settlement === undefined
      ? {}
      : { settlement: contract.identity.settlement }),
    ...(contract.identity.exerciseStyle === undefined
      ? {}
      : { exerciseStyle: contract.identity.exerciseStyle }),
  };
}

function toLegacyLegs(request: DerivativeComboPreviewRequest | DerivativeComboExecutionRequest) {
  return [
    { contract: toLegacyContract(request.legs[0].contract), ratio: request.legs[0].ratio },
    { contract: toLegacyContract(request.legs[1].contract), ratio: request.legs[1].ratio },
  ] as const;
}

const derivativePreviewPromise = new Map<BrokerName, Promise<DerivativePreviewClient>>();
const derivativeExecutionPromise = new Map<BrokerName, Promise<DerivativeExecutionClient>>();

function legacyPreviewClient(): Promise<DerivativePreviewClient> {
  const existing = derivativePreviewPromise.get("ibkr");
  if (existing !== undefined) return existing;
  const created = (async () => {
    const [discovery, direct] = await Promise.all([
      resolveDerivativeDiscovery("ibkr"),
      directIbkrClient(),
    ]);
    return {
      getTradingDiagnostics: (): Promise<TradingDiagnostics> =>
        (discovery as IbkrDerivativeAdapter).getTradingDiagnostics(),
      previewDerivativeCombo: (request: DerivativeComboPreviewRequest): Promise<DerivativeComboPreviewResult> =>
        direct.previewDerivativeCombo({
          ...request,
          legs: [...toLegacyLegs(request)],
          orderType: "LMT",
        }),
    };
  })().catch((error: unknown) => {
    derivativePreviewPromise.delete("ibkr");
    throw error;
  });
  derivativePreviewPromise.set("ibkr", created);
  return created;
}

function legacyExecutionClient(): Promise<DerivativeExecutionClient> {
  const existing = derivativeExecutionPromise.get("ibkr");
  if (existing !== undefined) return existing;
  const created = directIbkrClient()
    .then((direct) => ({
      submitDerivativeCombo: (
        request: DerivativeComboExecutionRequest
      ): Promise<DerivativeOrderSubmissionResult> =>
        direct.submitDerivativeCombo({
          ...request,
          legs: [...toLegacyLegs(request)],
          orderType: "LMT",
        }),
      acknowledgeOrderWarning: (input: {
        replyId: string;
        confirmed: true;
      }): Promise<DerivativeOrderSubmissionResult> => direct.acknowledgeOrderWarning(input),
      getDerivativeOrderStatus: (
        accountId: string,
        orderId: string
      ): Promise<DerivativeOrderLifecycle> => direct.getDerivativeOrderStatus(accountId, orderId),
      cancelDerivativeOrder: async (input: {
        accountId: string;
        orderId: string;
        assetClass: DerivativeComboExecutionRequest["legs"][number]["contract"]["identity"]["assetClass"];
        extOperator: string;
        manualIndicator: boolean;
      }): Promise<void> => {
        await direct.cancelDerivativeOrder(input);
      },
    }))
    .catch((error: unknown) => {
      derivativeExecutionPromise.delete("ibkr");
      throw error;
    });
  derivativeExecutionPromise.set("ibkr", created);
  return created;
}

/** Resolve a reusable broker-specific derivative discovery capability. */
export function derivativeDiscoveryClient(broker: BrokerName): Promise<DerivativeDiscoveryClient> {
  return resolveDerivativeDiscovery(broker);
}

/** Resolve the explicit What-If capability; unsupported brokers fail closed. */
export async function derivativePreviewClient(
  broker: BrokerName
): Promise<DerivativePreviewClient> {
  if (broker !== "ibkr") {
    throw new Error(`Derivative preview is not implemented for broker '${broker}' yet.`);
  }
  return legacyPreviewClient();
}

/** Resolve the guarded live-execution capability; unsupported brokers fail closed. */
export async function derivativeExecutionClient(
  broker: BrokerName
): Promise<DerivativeExecutionClient> {
  if (broker !== "ibkr") {
    throw new Error(`Derivative execution is not implemented for broker '${broker}' yet.`);
  }
  return legacyExecutionClient();
}
