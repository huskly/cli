import chalk from "chalk";
import { addDays, format, parse } from "date-fns";
import { apiClient } from "./shared.js";
import type { OptionQuote } from "@huskly/schwab-client";
import { requireObservation, type BrokerName } from "#src/brokers/brokerClient.js";
import { derivativeDiscoveryClient } from "#src/derivatives/derivativeClient.js";
import type { DerivativeDiscoveryClient } from "#src/derivatives/derivativeDiscovery.js";
import {
  DerivativeResearchService,
  type OptionChainResearch,
} from "#src/derivatives/derivativeResearch.js";

const DEFAULT_DAYS_AHEAD = 30;
const COL_WIDTH = 8;
const STRIKE_WIDTH = 10;

export interface ChainLegDto {
  /** OSI symbol under Schwab; null when the broker gives no stable symbol. */
  readonly symbol: string | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly mid: number | null;
  readonly delta: number | null;
  readonly volume: number | null;
  readonly openInterest: number | null;
}

/** Series facts that IBKR needs to identify a contract and Schwab does not expose. */
export interface ChainSeriesDto {
  readonly tradingClass: string;
  readonly exchange: string;
  readonly multiplier: number;
}

export interface ChainStrikeDto {
  readonly strike: number;
  readonly call: ChainLegDto | null;
  readonly put: ChainLegDto | null;
}

export interface OptionChainDto {
  readonly broker: BrokerName;
  /** Set when the underlying could not be priced; the chain is still valid. */
  readonly underlyingPriceError?: string | null;
  readonly symbol: string;
  readonly expiry: string;
  readonly underlyingPrice: number | null;
  readonly center: number | null;
  readonly delayed: boolean | null;
  readonly series: ChainSeriesDto | null;
  readonly strikes: readonly ChainStrikeDto[];
}

export interface ChainOptions {
  around?: string;
  strikes: string;
  json?: boolean;
  /** IBKR-only filters; Schwab resolves the series from the symbol alone. */
  right?: string;
  class?: string;
  exchange?: string;
}

function toLegDto(quote: OptionQuote | undefined): ChainLegDto | null {
  if (quote === undefined) return null;
  return {
    symbol: quote.symbol,
    bid: quote.bid,
    ask: quote.ask,
    mid: quote.mid,
    delta: quote.delta,
    volume: quote.volume,
    openInterest: quote.openInterest,
  };
}

/** Keep `count` strikes on each side of the strike closest to `center`. */
function selectStrikes(all: number[], center: number | null, count: number): number[] {
  if (center === null) return all;
  const closest = all.reduce(
    (best, strike, index) =>
      Math.abs(strike - center) < Math.abs((all[best] ?? 0) - center) ? index : best,
    0
  );
  return all.slice(Math.max(0, closest - count), Math.min(all.length, closest + count + 1));
}

export function toOptionChainDto(
  symbol: string,
  expiry: Date,
  chain: readonly OptionQuote[],
  underlyingPrice: number | null,
  center: number | null,
  strikeCount: number
): OptionChainDto {
  const allStrikes = Array.from(new Set(chain.map((quote) => quote.strike))).sort((a, b) => a - b);
  const selected = selectStrikes(allStrikes, center, strikeCount);
  const calls = new Map(chain.filter((q) => q.isCall).map((q) => [q.strike, q]));
  const puts = new Map(chain.filter((q) => !q.isCall).map((q) => [q.strike, q]));

  return {
    broker: "schwab",
    symbol,
    expiry: format(expiry, "yyyy-MM-dd"),
    underlyingPrice,
    center,
    delayed: chain[0]?.delayed ?? null,
    series: null,
    strikes: selected.map((strike) => ({
      strike,
      call: toLegDto(calls.get(strike)),
      put: toLegDto(puts.get(strike)),
    })),
  };
}

function price(value: number | null): string {
  return value !== null ? "$" + value.toFixed(2) : "-";
}

/** In-the-money cells are shaded; out-of-the-money cells stay dim. */
const ITM_CALL = (text: string, itm: boolean): string =>
  itm ? chalk.bgGreen.black.bold(text) : chalk.green.dim(text);
const ITM_PUT = (text: string, itm: boolean): string =>
  itm ? chalk.bgRed.white.bold(text) : chalk.red.dim(text);

/** A marker row showing where the underlying sits between two strikes. */
function atmDivider(underlying: number, estimated: boolean): string {
  const label = ` ${estimated ? "≈" : ""}$${underlying.toFixed(2)} `;
  const width = COL_WIDTH * 8 + STRIKE_WIDTH;
  const left = Math.max(0, Math.floor((width - label.length) / 2));
  return chalk.yellow(
    "·".repeat(left) + label + "·".repeat(Math.max(0, width - left - label.length))
  );
}

/** The underlying price used to judge moneyness, and whether it was derived. */
export interface MoneynessReference {
  readonly price: number;
  readonly estimated: boolean;
}

/**
 * Estimate the underlying price from the chain itself, through put-call parity.
 *
 * @remarks
 * For one strike, call - put equals underlying - strike, so each paired strike
 * implies a price. The implication is most accurate near the money, where both
 * legs are liquid, so the strike with the smallest call/put difference wins.
 * This runs only when the broker cannot price the underlying, which the IBKR
 * gateway cannot do for some series.
 */
export function estimateUnderlying(strikes: readonly ChainStrikeDto[]): number | null {
  let best: { distance: number; price: number } | null = null;
  for (const row of strikes) {
    const call = row.call?.mid;
    const put = row.put?.mid;
    if (call === null || call === undefined || put === null || put === undefined) continue;
    const distance = Math.abs(call - put);
    if (best === null || distance < best.distance) {
      best = { distance, price: row.strike + call - put };
    }
  }
  return best === null ? null : best.price;
}

/** Resolve the moneyness reference: the broker price, else a parity estimate. */
export function moneynessReference(dto: OptionChainDto): MoneynessReference | null {
  if (dto.underlyingPrice !== null) return { price: dto.underlyingPrice, estimated: false };
  const estimated = estimateUnderlying(dto.strikes);
  return estimated === null ? null : { price: estimated, estimated: true };
}

export function renderOptionChain(dto: OptionChainDto): string {
  const header = chalk.bold(`\n⛓️  Option Chain: ${dto.symbol} ${dto.expiry}\n`);
  if (dto.strikes.length === 0) {
    return `${header}\n${chalk.yellow("No options found for this expiry")}`;
  }

  const lineWidth = COL_WIDTH * 8 + STRIKE_WIDTH;
  const rule = chalk.gray("─".repeat(lineWidth));
  const lines = [
    header,
    ...(dto.underlyingPriceError === null || dto.underlyingPriceError === undefined
      ? []
      : [chalk.yellow(`  Underlying price unavailable: ${dto.underlyingPriceError}`)]),
    ...(dto.series === null
      ? []
      : [
          chalk.gray(
            `  ${dto.series.tradingClass} · ${dto.series.exchange} · multiplier ${String(dto.series.multiplier)}`
          ),
        ]),
    rule,
    chalk.green("CALLS".padStart(COL_WIDTH * 2)) +
      " ".repeat(STRIKE_WIDTH + COL_WIDTH * 2) +
      chalk.red("PUTS"),
    rule,
    chalk.green("Bid".padStart(COL_WIDTH)) +
      chalk.green("Ask".padStart(COL_WIDTH)) +
      chalk.green("Mid".padStart(COL_WIDTH)) +
      chalk.green("Δ".padStart(COL_WIDTH)) +
      chalk.white("Strike".padStart(STRIKE_WIDTH)) +
      chalk.red("Δ".padStart(COL_WIDTH)) +
      chalk.red("Mid".padStart(COL_WIDTH)) +
      chalk.red("Ask".padStart(COL_WIDTH)) +
      chalk.red("Bid".padStart(COL_WIDTH)),
    rule,
  ];

  const reference = moneynessReference(dto);
  const underlying = reference?.price ?? null;
  const cell = (value: string): string => value.padStart(COL_WIDTH);
  const delta = (value: number | null | undefined): string =>
    cell(value !== null && value !== undefined ? value.toFixed(2) : "-");

  let crossed = underlying === null;
  for (const row of dto.strikes) {
    // A call is in the money below the underlying, a put above it.
    const callItm = underlying !== null && row.strike < underlying;
    const putItm = underlying !== null && row.strike > underlying;

    if (!crossed && underlying !== null && row.strike >= underlying) {
      crossed = true;
      lines.push(atmDivider(underlying, reference?.estimated === true));
    }

    lines.push(
      ITM_CALL(
        cell(price(row.call?.bid ?? null)) +
          cell(price(row.call?.ask ?? null)) +
          cell(price(row.call?.mid ?? null)),
        callItm
      ) +
        chalk.gray(delta(row.call?.delta)) +
        chalk.white.bold(("$" + row.strike.toFixed(2)).padStart(STRIKE_WIDTH)) +
        chalk.gray(delta(row.put?.delta)) +
        ITM_PUT(
          cell(price(row.put?.mid ?? null)) +
            cell(price(row.put?.ask ?? null)) +
            cell(price(row.put?.bid ?? null)),
          putItm
        )
    );
  }

  lines.push(
    rule,
    underlying === null
      ? chalk.gray("  Moneyness unknown: no underlying price available.")
      : chalk.gray(
          `  ${ITM_CALL(" ITM ", true)} in the money    ${ITM_PUT(" ITM ", true)} in the money    underlying ${reference?.estimated === true ? "≈" : ""}$${underlying.toFixed(2)}`
        )
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * Project an IBKR derivative chain onto the shared chain DTO.
 *
 * @remarks
 * Both brokers answer the same question, so both render through one table.
 * IBKR contracts carry series routing facts that Schwab does not expose, and
 * those go in `series` instead of being dropped.
 */
export function toIbkrChainDto(
  symbol: string,
  expiry: string,
  research: OptionChainResearch
): OptionChainDto {
  const quotes = research.quotes.value;
  const reference = research.referenceQuote?.value ?? null;
  const first = quotes[0]?.contract.identity;
  const byStrike = new Map<number, { call: ChainLegDto | null; put: ChainLegDto | null }>();

  for (const quote of quotes) {
    const identity = quote.contract.identity;
    const row = byStrike.get(identity.strike) ?? { call: null, put: null };
    const leg: ChainLegDto = {
      symbol: null,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mark,
      delta: quote.delta,
      volume: quote.volume,
      openInterest: quote.openInterest,
    };
    byStrike.set(
      identity.strike,
      identity.right === "CALL" ? { ...row, call: leg } : { ...row, put: leg }
    );
  }

  return {
    broker: "ibkr",
    symbol,
    expiry,
    underlyingPrice: reference === null ? null : (reference.mark ?? reference.last),
    underlyingPriceError: research.referenceQuoteError,
    center: research.center,
    delayed: quotes[0] === undefined ? null : quotes[0].dataAvailability.includes("delayed"),
    series:
      first === undefined
        ? null
        : {
            tradingClass: first.tradingClass,
            exchange: first.exchange,
            multiplier: first.multiplier,
          },
    strikes: [...byStrike.entries()]
      .sort(([a], [b]) => a - b)
      .map(([strike, row]) => ({ strike, call: row.call, put: row.put })),
  };
}

/** Resolve the requested expiry, or fall back to the nearest listed expiry. */
async function resolveExpiry(
  api: Awaited<ReturnType<typeof apiClient>>,
  symbol: string,
  expiryArg: string | undefined
): Promise<Date> {
  // Parse as a local date so the calendar day survives the timezone offset.
  if (expiryArg !== undefined) return parse(expiryArg, "yyyy-MM-dd", new Date());

  const [nearest] = await api.getAvailableExpiries(
    symbol,
    "PUT",
    format(new Date(), "yyyy-MM-dd"),
    format(addDays(new Date(), DEFAULT_DAYS_AHEAD), "yyyy-MM-dd")
  );
  if (!nearest) throw new Error(`No expiries available for ${symbol}.`);
  return nearest;
}

/** Resolve the nearest listed IBKR expiry when the user names none. */
async function nearestIbkrExpiry(
  client: DerivativeDiscoveryClient,
  underlying: string
): Promise<string> {
  const today = new Date();
  const expiries = requireObservation(
    "queryDerivativeExpiries",
    await client.getExpiries({
      assetClass: "OPT",
      underlying,
      from: format(today, "yyyy-MM-dd"),
      to: format(addDays(today, DEFAULT_DAYS_AHEAD), "yyyy-MM-dd"),
    })
  ).value;
  const nearest = [...expiries].sort((a, b) => a.expiration.localeCompare(b.expiration))[0];
  if (nearest === undefined) throw new Error(`No expiries available for ${underlying}.`);
  return nearest.expiration;
}

async function ibkrChain(
  symbol: string,
  expiryArg: string | undefined,
  options: ChainOptions
): Promise<OptionChainDto> {
  const client = await derivativeDiscoveryClient("ibkr");
  const underlying = symbol.toUpperCase();
  const expiry = expiryArg ?? (await nearestIbkrExpiry(client, underlying));
  const research = await new DerivativeResearchService(client).chain({
    assetClass: "OPT",
    underlying,
    expiration: expiry,
    ...(options.around !== undefined ? { around: parseFloat(options.around) } : {}),
    ...(options.right !== undefined
      ? { right: options.right.toUpperCase() as "CALL" | "PUT" }
      : {}),
    ...(options.class !== undefined ? { tradingClass: options.class.toUpperCase() } : {}),
    ...(options.exchange !== undefined ? { exchange: options.exchange.toUpperCase() } : {}),
    strikes: parseInt(options.strikes, 10),
  });
  return toIbkrChainDto(underlying, expiry, research);
}

async function schwabChain(
  symbol: string,
  expiryArg: string | undefined,
  options: ChainOptions
): Promise<OptionChainDto> {
  const api = await apiClient();
  const expiry = await resolveExpiry(api, symbol, expiryArg);
  const [chain, quotes] = await Promise.all([
    api.getOptionChain(symbol, expiry),
    api.getQuotes([symbol]),
  ]);

  const quote = quotes[symbol]?.quote;
  const underlyingPrice = quote?.mark ?? quote?.lastPrice ?? null;
  const center = options.around !== undefined ? parseFloat(options.around) : underlyingPrice;
  return toOptionChainDto(
    symbol,
    expiry,
    chain,
    underlyingPrice,
    center,
    parseInt(options.strikes, 10)
  );
}

/**
 * Show an option chain for either broker.
 *
 * @remarks
 * Schwab and IBKR answer the same question through different APIs, so the
 * command resolves the broker and renders one shared table. IBKR needs a
 * trading class and exchange only when the default series is ambiguous.
 */
export async function handleChain(
  broker: BrokerName,
  symbol: string,
  expiryArg: string | undefined,
  options: ChainOptions
): Promise<void> {
  const dto =
    broker === "ibkr"
      ? await ibkrChain(symbol, expiryArg, options)
      : await schwabChain(symbol, expiryArg, options);

  console.log(options.json === true ? JSON.stringify(dto, null, 2) : renderOptionChain(dto));
}
