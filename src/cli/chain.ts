import chalk from "chalk";
import { addDays, format, parse } from "date-fns";
import { apiClient } from "./shared.js";
import type { OptionQuote } from "@huskly/schwab-client";

const DEFAULT_DAYS_AHEAD = 30;
const COL_WIDTH = 8;
const STRIKE_WIDTH = 10;

export interface ChainLegDto {
  readonly symbol: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly mid: number;
  readonly delta: number;
  readonly volume: number | null;
  readonly openInterest: number | null;
}

export interface ChainStrikeDto {
  readonly strike: number;
  readonly call: ChainLegDto | null;
  readonly put: ChainLegDto | null;
}

export interface OptionChainDto {
  readonly symbol: string;
  readonly expiry: string;
  readonly underlyingPrice: number | null;
  readonly center: number | null;
  readonly delayed: boolean | null;
  readonly strikes: readonly ChainStrikeDto[];
}

export interface ChainOptions {
  around?: string;
  strikes: string;
  json?: boolean;
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
    symbol,
    expiry: format(expiry, "yyyy-MM-dd"),
    underlyingPrice,
    center,
    delayed: chain[0]?.delayed ?? null,
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

export function renderOptionChain(dto: OptionChainDto): string {
  const header = chalk.bold(`\n⛓️  Option Chain: ${dto.symbol} ${dto.expiry}\n`);
  if (dto.strikes.length === 0) {
    return `${header}\n${chalk.yellow("No options found for this expiry")}`;
  }

  const lineWidth = COL_WIDTH * 8 + STRIKE_WIDTH;
  const rule = chalk.gray("─".repeat(lineWidth));
  const lines = [
    header,
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

  const underlying = dto.underlyingPrice;
  for (const row of dto.strikes) {
    const callItm = underlying !== null && row.strike < underlying;
    const putItm = underlying !== null && row.strike > underlying;
    const callColor = callItm ? chalk.greenBright : chalk.cyan;
    const putColor = putItm ? chalk.redBright : chalk.cyan;
    const delta = (value: number | undefined): string =>
      (value !== undefined ? value.toFixed(2) : "-").padStart(COL_WIDTH);
    const callMid = price(row.call?.mid ?? null).padStart(COL_WIDTH);
    const putMid = price(row.put?.mid ?? null).padStart(COL_WIDTH);

    lines.push(
      callColor(price(row.call?.bid ?? null).padStart(COL_WIDTH)) +
        callColor(price(row.call?.ask ?? null).padStart(COL_WIDTH)) +
        (callItm ? chalk.yellowBright(callMid) : chalk.yellow(callMid)) +
        chalk.gray(delta(row.call?.delta)) +
        chalk.white(("$" + row.strike.toFixed(2)).padStart(STRIKE_WIDTH)) +
        chalk.gray(delta(row.put?.delta)) +
        (putItm ? chalk.yellowBright(putMid) : chalk.yellow(putMid)) +
        putColor(price(row.put?.ask ?? null).padStart(COL_WIDTH)) +
        putColor(price(row.put?.bid ?? null).padStart(COL_WIDTH))
    );
  }
  lines.push("");
  return lines.join("\n");
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

export async function handleChain(
  symbol: string,
  expiryArg: string | undefined,
  options: ChainOptions
): Promise<void> {
  const api = await apiClient();
  const expiry = await resolveExpiry(api, symbol, expiryArg);
  const [chain, quotes] = await Promise.all([
    api.getOptionChain(symbol, expiry),
    api.getQuotes([symbol]),
  ]);

  const quote = quotes[symbol]?.quote;
  const underlyingPrice = quote?.mark ?? quote?.lastPrice ?? null;
  const center = options.around !== undefined ? parseFloat(options.around) : underlyingPrice;
  const dto = toOptionChainDto(
    symbol,
    expiry,
    chain,
    underlyingPrice,
    center,
    parseInt(options.strikes, 10)
  );

  console.log(options.json === true ? JSON.stringify(dto, null, 2) : renderOptionChain(dto));
}
