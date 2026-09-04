import type {
  GetDiagnosticsResponse,
  QueryDerivativeContractsRequest,
  QueryDerivativeContractsResponse,
  QueryDerivativeExpiriesRequest,
  QueryDerivativeExpiriesResponse,
  QueryDerivativeQuotesRequest,
  QueryDerivativeQuotesResponse,
  QueryDerivativeReferenceQuoteRequest,
  QueryDerivativeReferenceQuoteResponse,
  ResolveDerivativeContractRequest,
  ResolveDerivativeContractResponse,
} from "@huskly/ibkr-gateway-client";
import { z } from "zod";
import { observe, requireObservation, type Observation } from "#src/brokers/brokerClient.js";
import { parseGatewayResponse } from "#src/gateway/gatewayValidation.js";
import type { GatewayTransport } from "#src/gateway/gatewayTransport.js";
import type {
  DerivativeContract,
  DerivativeContractRequest,
  DerivativeDataAvailability,
  DerivativeDiscoveryClient,
  DerivativeExpiry,
  DerivativeExpiryRequest,
  DerivativeQuote,
  DerivativeReferenceQuote,
  DerivativeRight,
} from "./derivativeDiscovery.js";
import type { DerivativePreviewClient, TradingDiagnostics } from "./derivativePreview.js";

const readStatusSchema = z.enum(["available", "partial", "empty", "unavailable"]);
const derivativeAvailabilitySchema = z
  .enum(["live", "delayed", "frozen", "frozen-delayed", "unavailable"])
  .nullable();
const derivativeRightSchema = z.enum(["C", "P"]).nullable();
const derivativeAssetClassSchema = z.enum(["OPT", "FOP"]).nullable();
const brokerIdSchema = z.number().int().positive().nullable();

const diagnosticsSchema = z
  .object({
    version: z.string(),
    state: z.enum(["starting", "ready", "degraded", "draining", "stopped"]),
    readReady: z.boolean(),
    newMutationReady: z.boolean(),
    recoveryMutationReady: z.boolean(),
    lockOwned: z.boolean(),
    accountVerified: z.boolean(),
    account: z.string(),
    environment: z.enum(["paper", "live"]),
    authenticated: z.boolean().nullable(),
    connected: z.boolean().nullable(),
    competingSession: z.boolean().nullable(),
    lastTickleAt: z.string().nullable(),
    nextRenewalAt: z.string().nullable(),
    lastBrokerRequestAt: z.string().nullable(),
    readQueueDepth: z.number(),
    pendingWarnings: z.number(),
    reconciliationRequiredOperations: z.number(),
  })
  .strict() satisfies z.ZodType<GetDiagnosticsResponse>;

const derivativeExpirySchema = z
  .object({
    assetClass: derivativeAssetClassSchema,
    underlying: z.string().nullable(),
    expiration: z.string().nullable(),
    tradingClass: z.string().nullable(),
    exchange: z.string().nullable(),
    multiplier: z.number().nullable(),
  })
  .strict();

const derivativeContractSchema = z
  .object({
    brokerId: brokerIdSchema,
    symbol: z.string().nullable(),
    assetClass: derivativeAssetClassSchema,
    underlying: z.string().nullable(),
    expiration: z.string().nullable(),
    tradingClass: z.string().nullable(),
    exchange: z.string().nullable(),
    multiplier: z.number().nullable(),
    strike: z.number().nullable(),
    right: derivativeRightSchema,
    settlement: z.string().nullable(),
    exerciseStyle: z.string().nullable(),
  })
  .strict();

const derivativeQuoteSchema = z
  .object({
    brokerId: brokerIdSchema,
    symbol: z.string().nullable(),
    assetClass: derivativeAssetClassSchema,
    underlying: z.string().nullable(),
    expiration: z.string().nullable(),
    tradingClass: z.string().nullable(),
    exchange: z.string().nullable(),
    multiplier: z.number().nullable(),
    strike: z.number().nullable(),
    right: derivativeRightSchema,
    settlement: z.string().nullable(),
    exerciseStyle: z.string().nullable(),
    bid: z.number().nullable(),
    ask: z.number().nullable(),
    last: z.number().nullable(),
    close: z.number().nullable(),
    mark: z.number().nullable(),
    delta: z.number().nullable(),
    impliedVolatility: z.number().nullable(),
    volume: z.number().nullable(),
    openInterest: z.number().nullable(),
    availability: derivativeAvailabilitySchema,
    timestamp: z.string().nullable(),
  })
  .strict();

const derivativeReferenceContractSchema = z
  .object({
    brokerId: z.number().int().positive(),
    symbol: z.string().nullable(),
    assetClass: z.enum(["OPT", "FOP"]),
    underlying: z.string(),
    expiration: z.string(),
    tradingClass: z.string(),
    exchange: z.string(),
    multiplier: z.number(),
    strike: z.number(),
    right: z.enum(["C", "P"]),
    settlement: z.string(),
    exerciseStyle: z.string(),
  })
  .strict();

const derivativeReferenceQuoteSchema = z
  .object({
    brokerId: z.number().int().positive(),
    symbol: z.string(),
    bid: z.number().nullable(),
    ask: z.number().nullable(),
    last: z.number().nullable(),
    close: z.number().nullable(),
    mark: z.number().nullable(),
    availability: derivativeAvailabilitySchema,
    timestamp: z.string().nullable(),
  })
  .strict();

const derivativeExpiryResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    expiries: z.array(derivativeExpirySchema),
  })
  .strict() satisfies z.ZodType<QueryDerivativeExpiriesResponse>;

const derivativeContractsResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    contracts: z.array(derivativeContractSchema),
  })
  .strict() satisfies z.ZodType<QueryDerivativeContractsResponse>;

const derivativeContractResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    contract: derivativeContractSchema.nullable(),
  })
  .strict() satisfies z.ZodType<ResolveDerivativeContractResponse>;

const derivativeQuotesResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    quotes: z.array(derivativeQuoteSchema),
  })
  .strict() satisfies z.ZodType<QueryDerivativeQuotesResponse>;

const derivativeReferenceQuoteResponseSchema = z
  .object({
    observedAt: z.string(),
    status: readStatusSchema,
    derivativeContract: derivativeReferenceContractSchema,
    referenceQuote: derivativeReferenceQuoteSchema,
  })
  .strict() satisfies z.ZodType<QueryDerivativeReferenceQuoteResponse>;

export interface IbkrGatewayDerivativeReadApi {
  getDiagnostics(): Promise<GetDiagnosticsResponse>;
  queryDerivativeExpiries(
    body: QueryDerivativeExpiriesRequest
  ): Promise<QueryDerivativeExpiriesResponse>;
  queryDerivativeContracts(
    body: QueryDerivativeContractsRequest
  ): Promise<QueryDerivativeContractsResponse>;
  resolveDerivativeContract(
    body: ResolveDerivativeContractRequest
  ): Promise<ResolveDerivativeContractResponse>;
  queryDerivativeQuotes(body: QueryDerivativeQuotesRequest): Promise<QueryDerivativeQuotesResponse>;
  queryDerivativeReferenceQuote(
    body: QueryDerivativeReferenceQuoteRequest
  ): Promise<QueryDerivativeReferenceQuoteResponse>;
}

export function createIbkrGatewayDerivativeReadApi(
  transport: GatewayTransport
): IbkrGatewayDerivativeReadApi {
  return {
    getDiagnostics: () => transport.call("getDiagnostics", (client) => client.getDiagnostics()),
    queryDerivativeExpiries: (body) =>
      transport.call("queryDerivativeExpiries", (client) => client.queryDerivativeExpiries(body)),
    queryDerivativeContracts: (body) =>
      transport.call("queryDerivativeContracts", (client) => client.queryDerivativeContracts(body)),
    resolveDerivativeContract: (body) =>
      transport.call("resolveDerivativeContract", (client) =>
        client.resolveDerivativeContract(body)
      ),
    queryDerivativeQuotes: (body) =>
      transport.call("queryDerivativeQuotes", (client) => client.queryDerivativeQuotes(body)),
    queryDerivativeReferenceQuote: (body) =>
      transport.call("queryDerivativeReferenceQuote", (client) =>
        client.queryDerivativeReferenceQuote(body)
      ),
  };
}

function toGatewayRight(right: DerivativeRight): "C" | "P" {
  return right === "CALL" ? "C" : "P";
}

function fromGatewayRight(right: "C" | "P"): DerivativeRight {
  return right === "C" ? "CALL" : "PUT";
}

function mapDataAvailability(value: string | null): DerivativeDataAvailability {
  switch (value) {
    case "live":
    case "delayed":
    case "frozen":
    case "frozen-delayed":
    case "unavailable":
      return value;
    default:
      return "unavailable";
  }
}

function requireField<T>(value: T | null, message: string): T {
  if (value === null) {
    throw new Error(message);
  }
  return value;
}

function toExpiryQuery(request: DerivativeExpiryRequest): QueryDerivativeExpiriesRequest {
  return {
    assetClass: request.assetClass,
    underlying: request.underlying,
    from: request.from,
    to: request.to,
    right: request.right === undefined ? null : toGatewayRight(request.right),
    tradingClass: request.tradingClass ?? null,
    exchange: request.exchange ?? null,
  };
}

function toContractsQuery(request: DerivativeContractRequest): QueryDerivativeContractsRequest {
  return {
    assetClass: request.assetClass,
    underlying: request.underlying,
    expiration: request.expiration,
    right: request.right === undefined ? null : toGatewayRight(request.right),
    strike: request.strike ?? null,
    tradingClass: request.tradingClass ?? null,
    exchange: request.exchange ?? null,
  };
}

function toQuotesQuery(request: DerivativeContractRequest): QueryDerivativeQuotesRequest {
  return {
    assetClass: request.assetClass,
    underlying: request.underlying,
    expiration: request.expiration,
    right: request.right === undefined ? null : toGatewayRight(request.right),
    tradingClass: request.tradingClass ?? null,
    exchange: request.exchange ?? null,
  };
}

function toResolveQuery(
  request: DerivativeContractRequest & { right: DerivativeRight; strike: number }
): ResolveDerivativeContractRequest {
  return {
    by: "query",
    assetClass: request.assetClass,
    underlying: request.underlying,
    expiration: request.expiration,
    right: toGatewayRight(request.right),
    strike: request.strike,
    ...(request.exchange === undefined ? {} : { exchange: request.exchange }),
    ...(request.tradingClass === undefined ? {} : { tradingClass: request.tradingClass }),
  };
}

function normalizeExpiry(expiry: z.infer<typeof derivativeExpirySchema>): DerivativeExpiry {
  return {
    assetClass: requireField(
      expiry.assetClass,
      "Gateway returned an incomplete derivative expiry asset class"
    ),
    underlying: requireField(
      expiry.underlying,
      "Gateway returned an incomplete derivative expiry underlying"
    ),
    expiration: requireField(
      expiry.expiration,
      "Gateway returned an incomplete derivative expiry date"
    ),
    tradingClass: requireField(
      expiry.tradingClass,
      "Gateway returned an incomplete derivative expiry trading class"
    ),
    exchange: requireField(
      expiry.exchange,
      "Gateway returned an incomplete derivative expiry exchange"
    ),
    multiplier: requireField(
      expiry.multiplier,
      "Gateway returned an incomplete derivative expiry multiplier"
    ),
  };
}

function normalizeContract(contract: z.infer<typeof derivativeContractSchema>): DerivativeContract {
  return {
    identity: {
      assetClass: requireField(
        contract.assetClass,
        "Gateway returned an incomplete derivative contract asset class"
      ),
      underlying: requireField(
        contract.underlying,
        "Gateway returned an incomplete derivative contract underlying"
      ),
      expiration: requireField(
        contract.expiration,
        "Gateway returned an incomplete derivative contract expiration"
      ),
      strike: requireField(
        contract.strike,
        "Gateway returned an incomplete derivative contract strike"
      ),
      right: fromGatewayRight(
        requireField(contract.right, "Gateway returned an incomplete derivative contract right")
      ),
      tradingClass: requireField(
        contract.tradingClass,
        "Gateway returned an incomplete derivative contract trading class"
      ),
      exchange: requireField(
        contract.exchange,
        "Gateway returned an incomplete derivative contract exchange"
      ),
      multiplier: requireField(
        contract.multiplier,
        "Gateway returned an incomplete derivative contract multiplier"
      ),
      ...(contract.settlement === null ? {} : { settlement: contract.settlement }),
      ...(contract.exerciseStyle === null ? {} : { exerciseStyle: contract.exerciseStyle }),
    },
    ...(contract.brokerId === null
      ? {}
      : { brokerReference: { broker: "ibkr" as const, contractId: String(contract.brokerId) } }),
  };
}

function normalizeQuote(quote: z.infer<typeof derivativeQuoteSchema>): DerivativeQuote {
  return {
    contract: normalizeContract(quote),
    dataAvailability: mapDataAvailability(quote.availability),
    timestamp: quote.timestamp,
    bid: quote.bid,
    ask: quote.ask,
    last: quote.last,
    mark: quote.mark,
    delta: quote.delta,
    impliedVolatility: quote.impliedVolatility,
    volume: quote.volume,
    openInterest: quote.openInterest,
  };
}

function normalizeReferenceQuote(
  quote: z.infer<typeof derivativeReferenceQuoteSchema>
): DerivativeReferenceQuote {
  return {
    brokerReference: { broker: "ibkr", contractId: String(quote.brokerId) },
    symbol: quote.symbol,
    dataAvailability: mapDataAvailability(quote.availability),
    timestamp: quote.timestamp,
    bid: quote.bid,
    ask: quote.ask,
    last: quote.last,
    mark: quote.mark,
  };
}

function observeList<T>(
  value: T[],
  status: z.infer<typeof readStatusSchema>,
  observedAt: string
): Observation<T[]> {
  return observe(value, status, observedAt);
}

function normalizeDiagnostics(response: GetDiagnosticsResponse): TradingDiagnostics {
  const diagnostics = parseGatewayResponse("getDiagnostics", diagnosticsSchema, response);
  return {
    accountId: diagnostics.account,
    environment: diagnostics.environment,
    authenticated: diagnostics.authenticated === true,
    competingSession: diagnostics.competingSession === true,
    marketDataAvailable: diagnostics.connected,
    advisoryAssetPermissions: [],
    state: diagnostics.state,
    readReady: diagnostics.readReady,
    newMutationReady: diagnostics.newMutationReady,
    recoveryMutationReady: diagnostics.recoveryMutationReady,
    lockOwned: diagnostics.lockOwned,
    accountVerified: diagnostics.accountVerified,
    connected: diagnostics.connected,
    lastTickleAt: diagnostics.lastTickleAt,
    nextRenewalAt: diagnostics.nextRenewalAt,
    lastBrokerRequestAt: diagnostics.lastBrokerRequestAt,
    readQueueDepth: diagnostics.readQueueDepth,
    pendingWarnings: diagnostics.pendingWarnings,
    reconciliationRequiredOperations: diagnostics.reconciliationRequiredOperations,
  };
}

function toReferenceContractRequest(
  contract: DerivativeContract
): ResolveDerivativeContractRequest {
  return {
    by: "query",
    assetClass: contract.identity.assetClass,
    underlying: contract.identity.underlying,
    expiration: contract.identity.expiration,
    right: toGatewayRight(contract.identity.right),
    strike: contract.identity.strike,
    exchange: contract.identity.exchange,
    tradingClass: contract.identity.tradingClass,
  };
}

function isReferenceContractComplete(contract: DerivativeContract): boolean {
  return (
    contract.brokerReference?.broker === "ibkr" &&
    contract.identity.settlement !== undefined &&
    contract.identity.exerciseStyle !== undefined
  );
}

export class IbkrDerivativeAdapter
  implements DerivativeDiscoveryClient, Pick<DerivativePreviewClient, "getTradingDiagnostics">
{
  constructor(private readonly api: IbkrGatewayDerivativeReadApi) {}

  async getExpiries(request: DerivativeExpiryRequest): Promise<Observation<DerivativeExpiry[]>> {
    const response = parseGatewayResponse(
      "queryDerivativeExpiries",
      derivativeExpiryResponseSchema,
      await this.api.queryDerivativeExpiries(toExpiryQuery(request))
    );
    return observeList(
      response.expiries.map(normalizeExpiry),
      response.status,
      response.observedAt
    );
  }

  async getContracts(
    request: DerivativeContractRequest
  ): Promise<Observation<DerivativeContract[]>> {
    const response = parseGatewayResponse(
      "queryDerivativeContracts",
      derivativeContractsResponseSchema,
      await this.api.queryDerivativeContracts(toContractsQuery(request))
    );
    return observeList(
      response.contracts.map(normalizeContract),
      response.status,
      response.observedAt
    );
  }

  async resolveContract(
    request: DerivativeContractRequest & { right: DerivativeRight; strike: number }
  ): Promise<Observation<DerivativeContract | null>> {
    const response = parseGatewayResponse(
      "resolveDerivativeContract",
      derivativeContractResponseSchema,
      await this.api.resolveDerivativeContract(toResolveQuery(request))
    );
    return observe(
      response.contract === null ? null : normalizeContract(response.contract),
      response.status,
      response.observedAt
    );
  }

  async getChain(request: DerivativeContractRequest): Promise<Observation<DerivativeQuote[]>> {
    const response = parseGatewayResponse(
      "queryDerivativeQuotes",
      derivativeQuotesResponseSchema,
      await this.api.queryDerivativeQuotes(toQuotesQuery(request))
    );
    return observeList(response.quotes.map(normalizeQuote), response.status, response.observedAt);
  }

  async getReferenceQuote(
    contract: DerivativeContract
  ): Promise<Observation<DerivativeReferenceQuote>> {
    const completeContract = await this.completeReferenceContract(contract);
    const request: QueryDerivativeReferenceQuoteRequest = {
      derivativeContract: {
        brokerId: Number(completeContract.brokerReference?.contractId),
        symbol: null,
        assetClass: completeContract.identity.assetClass,
        underlying: completeContract.identity.underlying,
        expiration: completeContract.identity.expiration,
        tradingClass: completeContract.identity.tradingClass,
        exchange: completeContract.identity.exchange,
        multiplier: completeContract.identity.multiplier,
        strike: completeContract.identity.strike,
        right: toGatewayRight(completeContract.identity.right),
        settlement: completeContract.identity.settlement ?? "",
        exerciseStyle: completeContract.identity.exerciseStyle ?? "",
      },
    };
    const response = parseGatewayResponse(
      "queryDerivativeReferenceQuote",
      derivativeReferenceQuoteResponseSchema,
      await this.api.queryDerivativeReferenceQuote(request)
    );
    return observe(
      normalizeReferenceQuote(response.referenceQuote),
      response.status,
      response.observedAt
    );
  }

  async getTradingDiagnostics(): Promise<TradingDiagnostics> {
    return normalizeDiagnostics(await this.api.getDiagnostics());
  }

  private async completeReferenceContract(
    contract: DerivativeContract
  ): Promise<DerivativeContract> {
    if (isReferenceContractComplete(contract)) {
      return contract;
    }
    const resolved = requireObservation(
      "resolveDerivativeContract",
      await this.apiToObservation(
        this.api.resolveDerivativeContract(toReferenceContractRequest(contract))
      )
    );
    if (resolved.value === null) {
      throw new Error("Derivative contract could not be resolved for a reference quote");
    }
    const complete = resolved.value;
    if (!isReferenceContractComplete(complete)) {
      throw new Error("Derivative contract is incomplete for a reference quote");
    }
    return complete;
  }

  private async apiToObservation(
    responsePromise: Promise<ResolveDerivativeContractResponse>
  ): Promise<Observation<DerivativeContract | null>> {
    const response = parseGatewayResponse(
      "resolveDerivativeContract",
      derivativeContractResponseSchema,
      await responsePromise
    );
    return observe(
      response.contract === null ? null : normalizeContract(response.contract),
      response.status,
      response.observedAt
    );
  }
}
