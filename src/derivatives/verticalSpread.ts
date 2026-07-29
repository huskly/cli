import type { DerivativeIdentity, DerivativeQuote } from "./derivativeDiscovery.js";

export type VerticalSpreadKind = "call-debit" | "call-credit" | "put-debit" | "put-credit";
export type VerticalPriceSource = "synthetic-natural" | "synthetic-midpoint" | "user-limit";

export interface VerticalSpreadLeg {
  side: "LONG" | "SHORT";
  quote: DerivativeQuote;
}

export interface VerticalSpreadAnalysis {
  source: VerticalPriceSource;
  price: number;
  priceEffect: "CREDIT" | "DEBIT";
  maximumProfit: number;
  maximumLoss: number;
  breakeven: number;
  returnOnRisk: number;
  netDelta: number | null;
  expirationPayoff: { underlyingPrice: number; profitLoss: number }[];
}

export interface VerticalSpreadScenario {
  source: VerticalPriceSource;
  price: number;
  analysis: VerticalSpreadAnalysis | null;
  error?: string;
}

export interface VerticalSpreadQuote {
  kind: VerticalSpreadKind;
  quantity: number;
  multiplier: number;
  width: number;
  longLeg: VerticalSpreadLeg;
  shortLeg: VerticalSpreadLeg;
  scenarios: VerticalSpreadScenario[];
  settlementWarning: string;
}

export interface BuildVerticalSpreadInput {
  kind: VerticalSpreadKind;
  quantity: number;
  longQuote: DerivativeQuote;
  shortQuote: DerivativeQuote;
  limit?: number;
}

function isCredit(kind: VerticalSpreadKind): boolean {
  return kind.endsWith("credit");
}

function isCall(kind: VerticalSpreadKind): boolean {
  return kind.startsWith("call");
}

function assertSameSeries(
  longIdentity: DerivativeIdentity,
  shortIdentity: DerivativeIdentity
): void {
  const fields: (keyof DerivativeIdentity)[] = [
    "assetClass",
    "underlying",
    "expiration",
    "right",
    "tradingClass",
    "exchange",
    "multiplier",
  ];
  for (const field of fields) {
    if (longIdentity[field] !== shortIdentity[field]) {
      throw new Error(`Vertical legs differ on ${field}`);
    }
  }
}

function assertLegDirection(
  kind: VerticalSpreadKind,
  longStrike: number,
  shortStrike: number
): void {
  const valid =
    kind === "call-debit"
      ? longStrike < shortStrike
      : kind === "call-credit"
        ? shortStrike < longStrike
        : kind === "put-debit"
          ? longStrike > shortStrike
          : shortStrike > longStrike;
  if (!valid) {
    throw new Error(
      `Invalid ${kind} strikes: long ${String(longStrike)}, short ${String(shortStrike)}`
    );
  }
}

function intrinsic(right: "CALL" | "PUT", strike: number, underlyingPrice: number): number {
  return right === "CALL"
    ? Math.max(0, underlyingPrice - strike)
    : Math.max(0, strike - underlyingPrice);
}

function expirationPayoff(
  kind: VerticalSpreadKind,
  longStrike: number,
  shortStrike: number,
  price: number,
  multiplier: number,
  quantity: number
): { underlyingPrice: number; profitLoss: number }[] {
  const width = Math.abs(longStrike - shortStrike);
  const minimumStrike = Math.min(longStrike, shortStrike);
  const maximumStrike = Math.max(longStrike, shortStrike);
  const prices = [
    Math.max(0, minimumStrike - width),
    minimumStrike,
    maximumStrike,
    maximumStrike + width,
  ];
  const right = isCall(kind) ? "CALL" : "PUT";
  const premium = isCredit(kind) ? price : -price;
  return prices.map((underlyingPrice) => ({
    underlyingPrice,
    profitLoss:
      (intrinsic(right, longStrike, underlyingPrice) -
        intrinsic(right, shortStrike, underlyingPrice) +
        premium) *
      multiplier *
      quantity,
  }));
}

function analyze(
  kind: VerticalSpreadKind,
  source: VerticalPriceSource,
  price: number,
  longQuote: DerivativeQuote,
  shortQuote: DerivativeQuote,
  quantity: number
): VerticalSpreadAnalysis {
  const multiplier = longQuote.contract.identity.multiplier;
  const longStrike = longQuote.contract.identity.strike;
  const shortStrike = shortQuote.contract.identity.strike;
  const width = Math.abs(longStrike - shortStrike);
  if (!Number.isFinite(price) || price <= 0 || price >= width) {
    throw new Error(
      `${source} ${isCredit(kind) ? "credit" : "debit"} must be greater than 0 and less than spread width ${String(width)}`
    );
  }
  const maximumProfit = (isCredit(kind) ? price : width - price) * multiplier * quantity;
  const maximumLoss = (isCredit(kind) ? width - price : price) * multiplier * quantity;
  const breakeven = isCall(kind)
    ? (isCredit(kind) ? shortStrike : longStrike) + price
    : (isCredit(kind) ? shortStrike : longStrike) - price;
  const netDelta =
    longQuote.delta === null || shortQuote.delta === null
      ? null
      : (longQuote.delta - shortQuote.delta) * multiplier * quantity;
  return {
    source,
    price,
    priceEffect: isCredit(kind) ? "CREDIT" : "DEBIT",
    maximumProfit,
    maximumLoss,
    breakeven,
    returnOnRisk: maximumProfit / maximumLoss,
    netDelta,
    expirationPayoff: expirationPayoff(kind, longStrike, shortStrike, price, multiplier, quantity),
  };
}

function scenario(
  kind: VerticalSpreadKind,
  source: VerticalPriceSource,
  price: number,
  longQuote: DerivativeQuote,
  shortQuote: DerivativeQuote,
  quantity: number
): VerticalSpreadScenario {
  try {
    return {
      source,
      price,
      analysis: analyze(kind, source, price, longQuote, shortQuote, quantity),
    };
  } catch (error) {
    return {
      source,
      price,
      analysis: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function settlementWarning(identity: DerivativeIdentity): string {
  const metadata = [identity.settlement, identity.exerciseStyle].filter(Boolean).join(", ");
  const details = metadata ? ` Broker metadata: ${metadata}.` : " Broker metadata is unavailable.";
  const residual =
    identity.assetClass === "FOP"
      ? " Futures-option exercise can create a residual futures position."
      : " Settlement timing can leave residual exercise or assignment exposure.";
  return `${details}${residual} Verify settlement and exercise terms before trading.`.trim();
}

/** Construct and analyze a two-leg vertical from executable leg markets. */
export function buildVerticalSpread(input: BuildVerticalSpreadInput): VerticalSpreadQuote {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Vertical quantity must be a positive integer");
  }
  const longIdentity = input.longQuote.contract.identity;
  const shortIdentity = input.shortQuote.contract.identity;
  assertSameSeries(longIdentity, shortIdentity);
  const expectedRight = isCall(input.kind) ? "CALL" : "PUT";
  if (longIdentity.right !== expectedRight) {
    throw new Error(`${input.kind} requires ${expectedRight} contracts`);
  }
  assertLegDirection(input.kind, longIdentity.strike, shortIdentity.strike);
  if (
    input.longQuote.ask === null ||
    input.longQuote.bid === null ||
    input.shortQuote.ask === null ||
    input.shortQuote.bid === null
  ) {
    throw new Error("Both vertical legs require usable bid and ask prices");
  }
  const longMid = (input.longQuote.bid + input.longQuote.ask) / 2;
  const shortMid = (input.shortQuote.bid + input.shortQuote.ask) / 2;
  const natural = isCredit(input.kind)
    ? input.shortQuote.bid - input.longQuote.ask
    : input.longQuote.ask - input.shortQuote.bid;
  const midpoint = isCredit(input.kind) ? shortMid - longMid : longMid - shortMid;
  const scenarios = [
    scenario(
      input.kind,
      "synthetic-natural",
      natural,
      input.longQuote,
      input.shortQuote,
      input.quantity
    ),
    scenario(
      input.kind,
      "synthetic-midpoint",
      midpoint,
      input.longQuote,
      input.shortQuote,
      input.quantity
    ),
    ...(input.limit === undefined
      ? []
      : [
          scenario(
            input.kind,
            "user-limit",
            input.limit,
            input.longQuote,
            input.shortQuote,
            input.quantity
          ),
        ]),
  ];
  return {
    kind: input.kind,
    quantity: input.quantity,
    multiplier: longIdentity.multiplier,
    width: Math.abs(longIdentity.strike - shortIdentity.strike),
    longLeg: { side: "LONG", quote: input.longQuote },
    shortLeg: { side: "SHORT", quote: input.shortQuote },
    scenarios,
    settlementWarning: settlementWarning(longIdentity),
  };
}
