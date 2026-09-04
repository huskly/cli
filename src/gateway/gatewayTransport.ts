import { AsyncLocalStorage } from "node:async_hooks";
import {
  IbkrGatewayClient,
  type IbkrGatewayClientOptions,
  type FetchLike,
} from "@huskly/ibkr-gateway-client";
import {
  ConsumerError,
  createAuthenticationFailureError,
  toConsumerError,
} from "#src/gateway/gatewayErrors.js";
import {
  loadGatewayConfig,
  type GatewayConfig,
  type GatewayConfigLoaderOptions,
  type GatewayRuntime,
} from "#src/gateway/gatewayConfig.js";
import {
  createMachineTokenProvider,
  type MachineTokenProvider,
} from "#src/gateway/machineTokenProvider.js";

export interface GatewayTransport {
  readonly client: IbkrGatewayClient;
  call<T>(operation: string, invoke: (client: IbkrGatewayClient) => Promise<T>): Promise<T>;
}

export interface GatewayTransportDependencies {
  readonly loadConfig?: (options: GatewayConfigLoaderOptions) => Promise<GatewayConfig>;
  readonly createTokenProvider?: (config: GatewayConfig) => MachineTokenProvider;
  readonly createClient?: (options: IbkrGatewayClientOptions) => IbkrGatewayClient;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

interface GatewayResponseMetadata {
  retryAfterSeconds: number | undefined;
}

interface GatewayCallDependencies {
  readonly client: IbkrGatewayClient;
  readonly tokenProvider: MachineTokenProvider;
  readonly tokenStore: AsyncLocalStorage<string>;
  readonly responseMetadataStore: AsyncLocalStorage<GatewayResponseMetadata>;
}

let cliTransportPromise: Promise<GatewayTransport> | undefined;
let mcpTransportPromise: Promise<GatewayTransport> | undefined;

export async function createGatewayTransport(
  runtime: GatewayRuntime,
  dependencies: GatewayTransportDependencies = {}
): Promise<GatewayTransport> {
  const loadConfigImpl = dependencies.loadConfig ?? loadGatewayConfig;
  const config = await loadConfigImpl({ runtime });
  const tokenProvider =
    dependencies.createTokenProvider ??
    ((nextConfig: GatewayConfig) =>
      createMachineTokenProvider({
        tokenUrl: nextConfig.tokenUrl,
        clientId: nextConfig.clientId,
        clientSecret: nextConfig.clientSecret,
      }));
  const provider = tokenProvider(config);

  const tokenStore = new AsyncLocalStorage<string>();
  const responseMetadataStore = new AsyncLocalStorage<GatewayResponseMetadata>();
  const createClient =
    dependencies.createClient ??
    ((options: IbkrGatewayClientOptions) => new IbkrGatewayClient(options));
  const wrappedFetch = wrapGatewayFetch(
    dependencies.fetch,
    responseMetadataStore,
    dependencies.now
  );
  const clientOptions: IbkrGatewayClientOptions =
    wrappedFetch === undefined
      ? {
          baseUrl: config.gatewayUrl,
          token: () => readPreparedToken(tokenStore),
        }
      : {
          baseUrl: config.gatewayUrl,
          token: () => readPreparedToken(tokenStore),
          fetch: wrappedFetch,
        };
  const client = createClient(clientOptions);

  return {
    client,
    call<T>(operation: string, invoke: (nextClient: IbkrGatewayClient) => Promise<T>): Promise<T> {
      return callGateway(operation, invoke, {
        client,
        tokenProvider: provider,
        tokenStore,
        responseMetadataStore,
      });
    },
  };
}

export function cliGatewayTransport(): Promise<GatewayTransport> {
  return (cliTransportPromise ??= createGatewayTransport("cli").catch((error: unknown) => {
    cliTransportPromise = undefined;
    throw error;
  }));
}

export function mcpGatewayTransport(): Promise<GatewayTransport> {
  return (mcpTransportPromise ??= createGatewayTransport("mcp").catch((error: unknown) => {
    mcpTransportPromise = undefined;
    throw error;
  }));
}

export async function callGateway<T>(
  operation: string,
  invoke: (client: IbkrGatewayClient) => Promise<T>,
  dependencies: GatewayCallDependencies
): Promise<T> {
  let token: string;

  try {
    token = await dependencies.tokenProvider.getToken();
  } catch {
    throw createAuthenticationFailureError(operation);
  }

  return dependencies.tokenStore.run(token, () =>
    dependencies.responseMetadataStore.run({ retryAfterSeconds: undefined }, async () => {
      try {
        return await invoke(dependencies.client);
      } catch (error: unknown) {
        if (error instanceof ConsumerError) {
          throw error;
        }
        throw toConsumerError(
          operation,
          error,
          metadataFromStore(dependencies.responseMetadataStore.getStore())
        );
      }
    })
  );
}

function readPreparedToken(tokenStore: AsyncLocalStorage<string>): string {
  const token = tokenStore.getStore();
  if (token === undefined) {
    throw new Error("Gateway access token is not prepared");
  }
  return token;
}

function wrapGatewayFetch(
  fetcher: FetchLike | undefined,
  responseMetadataStore: AsyncLocalStorage<GatewayResponseMetadata>,
  now: (() => number) | undefined
): FetchLike | undefined {
  if (fetcher === undefined && typeof globalThis.fetch !== "function") {
    return undefined;
  }

  const activeFetch = fetcher ?? globalThis.fetch;

  return async (input, init) => {
    const response = await activeFetch(input, init);
    const metadata = responseMetadataStore.getStore();
    if (metadata !== undefined) {
      metadata.retryAfterSeconds = parseRetryAfter(
        response.headers.get("retry-after"),
        now ?? Date.now
      );
    }
    return response;
  };
}

function metadataFromStore(metadata: GatewayResponseMetadata | undefined) {
  return {
    status: undefined,
    gatewayCode: undefined,
    retryAfterSeconds: metadata?.retryAfterSeconds,
  };
}

function parseRetryAfter(value: string | null, now: () => number): number | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    return Number(trimmed);
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((retryAt - now()) / 1000));
}
