import type {
  DerivativeAssetClass,
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
import type {
  DerivativeComboPreviewRequest,
  DerivativeComboPreviewResult,
  DerivativePreviewClient,
  TradingDiagnostics,
} from "./derivativePreview.js";

type IbkrOptionRight = "C" | "P";

interface IbkrDerivativeExpiry {
  assetClass: DerivativeAssetClass;
  underlying: string;
  expiration: string;
  tradingClass: string;
  exchange: string;
  multiplier: number;
}

interface IbkrDerivativeContract extends IbkrDerivativeExpiry {
  conid: number;
  strike: number;
  right: IbkrOptionRight;
  settlement?: string;
  exerciseStyle?: string;
}

interface IbkrDerivativeQuote {
  contract: IbkrDerivativeContract;
  availability: DerivativeDataAvailability;
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

interface IbkrDerivativeReferenceQuote {
  conid: number;
  symbol: string;
  availability: DerivativeDataAvailability;
  timestamp: string | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
}

interface IbkrContractQuery {
  assetClass: DerivativeAssetClass;
  underlying: string;
  expiration: string;
  exchange?: string;
  tradingClass?: string;
  right?: IbkrOptionRight;
  strike?: number;
}

interface IbkrExpiryQuery {
  assetClass: DerivativeAssetClass;
  underlying: string;
  from: string;
  to: string;
  exchange?: string;
  tradingClass?: string;
  right?: IbkrOptionRight;
}

/** Structural boundary implemented by @huskly/ibkr-client's read-only capability. */
export interface IbkrDerivativeDiscoveryApi {
  getDerivativeExpiries(query: IbkrExpiryQuery): Promise<IbkrDerivativeExpiry[]>;
  getDerivativeContracts(query: IbkrContractQuery): Promise<IbkrDerivativeContract[]>;
  resolveDerivativeContract(
    query: IbkrContractQuery & { right: IbkrOptionRight; strike: number }
  ): Promise<IbkrDerivativeContract>;
  getDerivativeChain(query: IbkrContractQuery): Promise<IbkrDerivativeQuote[]>;
  getDerivativeReferenceQuote(
    contract: IbkrDerivativeContract
  ): Promise<IbkrDerivativeReferenceQuote>;
  getTradingDiagnostics(accountId: string): Promise<TradingDiagnostics>;
  previewDerivativeCombo(request: {
    accountId: string;
    legs: [
      { contract: IbkrDerivativeContract; ratio: 1 | -1 },
      { contract: IbkrDerivativeContract; ratio: 1 | -1 },
    ];
    quantity: number;
    priceEffect: "CREDIT" | "DEBIT";
    limit: number;
    tif: "DAY" | "GTC";
    session: "REGULAR" | "OVERNIGHT";
  }): Promise<DerivativeComboPreviewResult>;
}

function toIbkrRight(right: DerivativeRight): IbkrOptionRight {
  return right === "CALL" ? "C" : "P";
}

function fromIbkrRight(right: IbkrOptionRight): DerivativeRight {
  return right === "C" ? "CALL" : "PUT";
}

function contractQuery(request: DerivativeContractRequest): IbkrContractQuery {
  return {
    assetClass: request.assetClass,
    underlying: request.underlying,
    expiration: request.expiration,
    ...(request.exchange !== undefined ? { exchange: request.exchange } : {}),
    ...(request.tradingClass !== undefined ? { tradingClass: request.tradingClass } : {}),
    ...(request.right !== undefined ? { right: toIbkrRight(request.right) } : {}),
    ...(request.strike !== undefined ? { strike: request.strike } : {}),
  };
}

function expiryQuery(request: DerivativeExpiryRequest): IbkrExpiryQuery {
  return {
    assetClass: request.assetClass,
    underlying: request.underlying,
    from: request.from,
    to: request.to,
    ...(request.exchange !== undefined ? { exchange: request.exchange } : {}),
    ...(request.tradingClass !== undefined ? { tradingClass: request.tradingClass } : {}),
    ...(request.right !== undefined ? { right: toIbkrRight(request.right) } : {}),
  };
}

function normalizeExpiry(expiry: IbkrDerivativeExpiry): DerivativeExpiry {
  return { ...expiry };
}

function normalizeContract(contract: IbkrDerivativeContract): DerivativeContract {
  if (!Number.isSafeInteger(contract.conid) || contract.conid <= 0) {
    throw new Error("IBKR returned an invalid broker-local derivative contract reference");
  }
  return {
    identity: {
      assetClass: contract.assetClass,
      underlying: contract.underlying,
      expiration: contract.expiration,
      strike: contract.strike,
      right: fromIbkrRight(contract.right),
      tradingClass: contract.tradingClass,
      exchange: contract.exchange,
      multiplier: contract.multiplier,
      ...(contract.settlement !== undefined ? { settlement: contract.settlement } : {}),
      ...(contract.exerciseStyle !== undefined ? { exerciseStyle: contract.exerciseStyle } : {}),
    },
    brokerReference: { broker: "ibkr", contractId: String(contract.conid) },
  };
}

function normalizeQuote(quote: IbkrDerivativeQuote): DerivativeQuote {
  return {
    contract: normalizeContract(quote.contract),
    dataAvailability: quote.availability,
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

function ibkrContract(contract: DerivativeContract): IbkrDerivativeContract {
  const reference = contract.brokerReference;
  const conid = Number(reference?.contractId);
  if (reference?.broker !== "ibkr" || !Number.isSafeInteger(conid) || conid <= 0) {
    throw new Error("Derivative contract does not contain a valid IBKR broker reference");
  }
  return {
    conid,
    assetClass: contract.identity.assetClass,
    underlying: contract.identity.underlying,
    expiration: contract.identity.expiration,
    strike: contract.identity.strike,
    right: toIbkrRight(contract.identity.right),
    tradingClass: contract.identity.tradingClass,
    exchange: contract.identity.exchange,
    multiplier: contract.identity.multiplier,
    ...(contract.identity.settlement !== undefined
      ? { settlement: contract.identity.settlement }
      : {}),
    ...(contract.identity.exerciseStyle !== undefined
      ? { exerciseStyle: contract.identity.exerciseStyle }
      : {}),
  };
}

/** Maps broker-local conids and C/P codes into the CLI's durable semantic model. */
export class IbkrDerivativeAdapter implements DerivativeDiscoveryClient, DerivativePreviewClient {
  constructor(private readonly client: IbkrDerivativeDiscoveryApi) {}

  async getExpiries(request: DerivativeExpiryRequest): Promise<DerivativeExpiry[]> {
    return (await this.client.getDerivativeExpiries(expiryQuery(request))).map(normalizeExpiry);
  }

  async getContracts(request: DerivativeContractRequest): Promise<DerivativeContract[]> {
    return (await this.client.getDerivativeContracts(contractQuery(request))).map(
      normalizeContract
    );
  }

  async resolveContract(
    request: DerivativeContractRequest & { right: DerivativeRight; strike: number }
  ): Promise<DerivativeContract> {
    const query = contractQuery(request) as IbkrContractQuery & {
      right: IbkrOptionRight;
      strike: number;
    };
    return normalizeContract(await this.client.resolveDerivativeContract(query));
  }

  async getChain(request: DerivativeContractRequest): Promise<DerivativeQuote[]> {
    return (await this.client.getDerivativeChain(contractQuery(request))).map(normalizeQuote);
  }

  async getReferenceQuote(contract: DerivativeContract): Promise<DerivativeReferenceQuote> {
    const quote = await this.client.getDerivativeReferenceQuote(ibkrContract(contract));
    return {
      brokerReference: { broker: "ibkr", contractId: String(quote.conid) },
      symbol: quote.symbol,
      dataAvailability: quote.availability,
      timestamp: quote.timestamp,
      bid: quote.bid,
      ask: quote.ask,
      last: quote.last,
      mark: quote.mark,
    };
  }

  getTradingDiagnostics(accountId: string): Promise<TradingDiagnostics> {
    return this.client.getTradingDiagnostics(accountId);
  }

  previewDerivativeCombo(
    request: DerivativeComboPreviewRequest
  ): Promise<DerivativeComboPreviewResult> {
    return this.client.previewDerivativeCombo({
      ...request,
      legs: request.legs.map(({ contract, ratio }) => ({
        contract: ibkrContract(contract),
        ratio,
      })) as [
        { contract: IbkrDerivativeContract; ratio: 1 | -1 },
        { contract: IbkrDerivativeContract; ratio: 1 | -1 },
      ],
    });
  }
}
