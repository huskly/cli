import type { BrokerName } from "#src/brokers/brokerClient.js";

export type DerivativeAssetClass = "OPT" | "FOP";
export type DerivativeRight = "CALL" | "PUT";
export type DerivativeDataAvailability =
  "live" | "delayed" | "frozen" | "frozen-delayed" | "unavailable";

/** Semantic derivative identity that is safe to persist independently of a broker. */
export interface DerivativeIdentity {
  assetClass: DerivativeAssetClass;
  underlying: string;
  expiration: string;
  strike: number;
  right: DerivativeRight;
  tradingClass: string;
  exchange: string;
  multiplier: number;
  settlement?: string;
  exerciseStyle?: string;
}

/**
 * Opaque, broker-local routing identity. It is suitable for an immediate broker call,
 * but must not be persisted as the durable identity of a derivative contract.
 */
export interface DerivativeBrokerReference {
  broker: BrokerName;
  contractId: string;
}

export interface DerivativeContract {
  identity: DerivativeIdentity;
  brokerReference?: DerivativeBrokerReference;
}

export interface DerivativeExpiry {
  assetClass: DerivativeAssetClass;
  underlying: string;
  expiration: string;
  tradingClass: string;
  exchange: string;
  multiplier: number;
}

export interface DerivativeContractRequest {
  assetClass: DerivativeAssetClass;
  underlying: string;
  expiration: string;
  exchange?: string;
  tradingClass?: string;
  right?: DerivativeRight;
  strike?: number;
}

export interface DerivativeExpiryRequest {
  assetClass: DerivativeAssetClass;
  underlying: string;
  from: string;
  to: string;
  exchange?: string;
  tradingClass?: string;
  right?: DerivativeRight;
}

export interface DerivativeQuote {
  contract: DerivativeContract;
  dataAvailability: DerivativeDataAvailability;
  timestamp: string | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  delta: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
}

/** Read-only derivative capability kept separate from the shared account client. */
export interface DerivativeDiscoveryClient {
  getExpiries(request: DerivativeExpiryRequest): Promise<DerivativeExpiry[]>;
  getContracts(request: DerivativeContractRequest): Promise<DerivativeContract[]>;
  resolveContract(
    request: DerivativeContractRequest & { right: DerivativeRight; strike: number }
  ): Promise<DerivativeContract>;
  getChain(request: DerivativeContractRequest): Promise<DerivativeQuote[]>;
}
