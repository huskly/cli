import {
  requireObservation,
  type Observation,
} from "#src/brokers/brokerClient.js";
import type {
  DerivativeContract,
  DerivativeContractRequest,
  DerivativeDiscoveryClient,
  DerivativeQuote,
  DerivativeReferenceQuote,
  DerivativeRight,
} from "./derivativeDiscovery.js";
import {
  buildVerticalSpread,
  type VerticalSpreadKind,
  type VerticalSpreadQuote,
} from "./verticalSpread.js";

export interface OptionResolution {
  contract: Observation<DerivativeContract>;
  referenceQuote: Observation<DerivativeReferenceQuote>;
}

export interface OptionDiscoveryResearch {
  contracts: Observation<DerivativeContract[]>;
  referenceQuote: Observation<DerivativeReferenceQuote> | null;
}

export interface OptionChainRequest extends DerivativeContractRequest {
  around?: number;
  strikes?: number;
}

export interface OptionChainResearch {
  referenceQuote: Observation<DerivativeReferenceQuote> | null;
  center: number | null;
  quotes: Observation<DerivativeQuote[]>;
}

export interface VerticalSpreadResearchRequest {
  kind: VerticalSpreadKind;
  assetClass: DerivativeContractRequest["assetClass"];
  underlying: string;
  expiration: string;
  longStrike: number;
  shortStrike: number;
  quantity: number;
  exchange?: string;
  tradingClass?: string;
  limit?: number;
}

export interface VerticalSpreadResearch {
  referenceQuote: Observation<DerivativeReferenceQuote>;
  spread: VerticalSpreadQuote;
  pricingNotice: string;
}

function rightForKind(kind: VerticalSpreadKind): DerivativeRight {
  return kind.startsWith("call") ? "CALL" : "PUT";
}

function quoteCenter(reference: DerivativeReferenceQuote): number | null {
  if (reference.mark !== null) return reference.mark;
  if (reference.bid !== null && reference.ask !== null) return (reference.bid + reference.ask) / 2;
  return reference.last;
}

function filterAround(
  quotes: DerivativeQuote[],
  center: number | null,
  strikes: number | undefined
): DerivativeQuote[] {
  if (strikes === undefined) return quotes;
  if (!Number.isSafeInteger(strikes) || strikes < 0) {
    throw new Error("Strike count must be a non-negative integer");
  }
  if (center === null) {
    throw new Error("--strikes requires --around or a usable reference quote");
  }
  const uniqueStrikes = [...new Set(quotes.map(({ contract }) => contract.identity.strike))].sort(
    (left, right) => left - right
  );
  let centerIndex = 0;
  for (let index = 1; index < uniqueStrikes.length; index += 1) {
    const candidate = uniqueStrikes[index];
    const selected = uniqueStrikes[centerIndex];
    if (
      candidate !== undefined &&
      selected !== undefined &&
      Math.abs(candidate - center) <= Math.abs(selected - center)
    ) {
      centerIndex = index;
    }
  }
  const selected = new Set(
    uniqueStrikes.slice(
      Math.max(0, centerIndex - strikes),
      Math.min(uniqueStrikes.length, centerIndex + strikes + 1)
    )
  );
  return quotes.filter(({ contract }) => selected.has(contract.identity.strike));
}

function sameContract(left: DerivativeContract, right: DerivativeContract): boolean {
  return (
    left.identity.assetClass === right.identity.assetClass &&
    left.identity.underlying === right.identity.underlying &&
    left.identity.expiration === right.identity.expiration &&
    left.identity.strike === right.identity.strike &&
    left.identity.right === right.identity.right &&
    left.identity.tradingClass === right.identity.tradingClass &&
    left.identity.exchange === right.identity.exchange &&
    left.identity.multiplier === right.identity.multiplier
  );
}

/** Read-only option and spread research shared by CLI and MCP presentation layers. */
export class DerivativeResearchService {
  constructor(private readonly client: DerivativeDiscoveryClient) {}

  async discover(request: DerivativeContractRequest): Promise<OptionDiscoveryResearch> {
    const contracts = await this.client.getContracts(request);
    requireObservation("queryDerivativeContracts", contracts);
    const first = contracts.value[0];
    return {
      contracts,
      referenceQuote: first === undefined ? null : await this.client.getReferenceQuote(first),
    };
  }

  async resolve(
    request: DerivativeContractRequest & { right: DerivativeRight; strike: number }
  ): Promise<OptionResolution> {
    const contract = requireObservation(
      "resolveDerivativeContract",
      await this.client.resolveContract(request)
    );
    if (contract.value === null) {
      throw new Error(
        `No exact derivative contract returned for ${request.underlying} ${request.expiration} ${String(request.strike)} ${request.right}`
      );
    }
    return {
      contract: { ...contract, value: contract.value },
      referenceQuote: await this.client.getReferenceQuote(contract.value),
    };
  }

  async chain(request: OptionChainRequest): Promise<OptionChainResearch> {
    const { around, strikes, ...contractRequest } = request;
    const quotes = requireObservation("queryDerivativeQuotes", await this.client.getChain(contractRequest));
    if (quotes.value.length === 0) {
      return { referenceQuote: null, center: around ?? null, quotes };
    }
    const first = quotes.value[0];
    if (first === undefined) throw new Error("Derivative chain unexpectedly has no first quote");
    const referenceQuote = await this.client.getReferenceQuote(first.contract);
    const center =
      around ?? quoteCenter(requireObservation("queryDerivativeReferenceQuote", referenceQuote).value);
    return {
      referenceQuote,
      center,
      quotes: {
        ...quotes,
        value: filterAround(quotes.value, center, strikes),
      },
    };
  }

  async quoteVertical(request: VerticalSpreadResearchRequest): Promise<VerticalSpreadResearch> {
    const right = rightForKind(request.kind);
    const base = {
      assetClass: request.assetClass,
      underlying: request.underlying,
      expiration: request.expiration,
      right,
      ...(request.exchange !== undefined ? { exchange: request.exchange } : {}),
      ...(request.tradingClass !== undefined ? { tradingClass: request.tradingClass } : {}),
    };
    const [longQuote, shortQuote] = await Promise.all([
      this.exactQuote({ ...base, strike: request.longStrike }),
      this.exactQuote({ ...base, strike: request.shortStrike }),
    ]);
    const referenceQuote = requireObservation(
      "queryDerivativeReferenceQuote",
      await this.client.getReferenceQuote(longQuote.contract)
    );
    return {
      referenceQuote,
      spread: buildVerticalSpread({
        kind: request.kind,
        quantity: request.quantity,
        longQuote,
        shortQuote,
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
      }),
      pricingNotice:
        "Natural and midpoint prices are synthesized from individual leg markets; they are not a broker combo NBBO or executable preview.",
    };
  }

  private async exactQuote(
    request: DerivativeContractRequest & { right: DerivativeRight; strike: number }
  ): Promise<DerivativeQuote> {
    const contract = requireObservation(
      "resolveDerivativeContract",
      await this.client.resolveContract(request)
    );
    if (contract.value === null) {
      throw new Error(
        `No exact derivative contract returned for ${request.underlying} ${request.expiration} ${String(request.strike)} ${request.right}`
      );
    }
    const quotes = requireObservation("queryDerivativeQuotes", await this.client.getChain(request));
    const resolvedContract = contract.value;
    const quote = quotes.value.find((candidate) => sameContract(candidate.contract, resolvedContract));
    if (quote === undefined) {
      throw new Error(
        `No market quote returned for ${request.underlying} ${request.expiration} ${String(request.strike)} ${request.right}`
      );
    }
    return quote;
  }
}
