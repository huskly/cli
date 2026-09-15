import chalk from "chalk";
import { apiClient } from "./shared.js";
import { formatNumber, formatVolume } from "../format.js";
import type {
  SchwabMoversIndexSymbol,
  SchwabMoversSort,
  SchwabMoversFrequency,
} from "@huskly/schwab-client";

const VALID_INDEX_SYMBOLS: SchwabMoversIndexSymbol[] = [
  "$DJI",
  "$COMPX",
  "$SPX",
  "NYSE",
  "NASDAQ",
  "OTCBB",
  "INDEX_ALL",
  "EQUITY_ALL",
  "OPTION_ALL",
  "OPTION_PUT",
  "OPTION_CALL",
];

const VALID_SORTS: SchwabMoversSort[] = [
  "VOLUME",
  "TRADES",
  "PERCENT_CHANGE_UP",
  "PERCENT_CHANGE_DOWN",
];

const VALID_FREQUENCIES: SchwabMoversFrequency[] = [0, 1, 5, 10, 30, 60];

export interface MoverDto {
  readonly rank: number;
  readonly symbol: string | null;
  readonly description: string | null;
  readonly lastPrice: number | null;
  readonly netPercentChange: number | null;
  readonly volume: number | null;
}

export interface MoversDto {
  readonly index: SchwabMoversIndexSymbol;
  readonly sort: SchwabMoversSort | null;
  readonly frequency: SchwabMoversFrequency | null;
  readonly count: number;
  readonly movers: readonly MoverDto[];
}

export interface MoversOptions {
  sort?: string;
  frequency?: string;
  json?: boolean;
}

/** Reject an unsupported enum value with the full list of accepted values. */
function oneOf<T extends string | number>(value: T, valid: readonly T[], name: string): T {
  if (!valid.includes(value)) {
    throw new Error(`Invalid ${name}: ${String(value)}. Valid options: ${valid.join(", ")}.`);
  }
  return value;
}

function formatChange(change: number | null): string {
  if (change === null) return "-";
  const formatted = `${(change * 100).toFixed(2)}%`;
  return change > 0 ? chalk.green(`+${formatted}`) : chalk.red(formatted);
}

export function renderMovers(dto: MoversDto): string {
  const sortLabel = dto.sort ?? "default";
  const freqLabel = dto.frequency !== null ? `${String(dto.frequency)} min` : "default";
  const lines = [
    chalk.bold(`\nTop Movers for ${dto.index}\n`),
    chalk.gray(`Sort: ${sortLabel}  |  Frequency: ${freqLabel}\n`),
    chalk.gray("-".repeat(70)),
  ];
  if (dto.count === 0) {
    lines.push(chalk.yellow(`No movers found for ${dto.index}`));
    return lines.join("\n");
  }

  lines.push("");
  for (const mover of dto.movers) {
    const rank = chalk.gray(`${String(mover.rank).padStart(2)}.`);
    const symbol = chalk.cyan.bold((mover.symbol ?? "-").padEnd(8));
    const price = chalk.white(`$${formatNumber(mover.lastPrice ?? undefined)}`);
    const volume = chalk.gray(`Vol: ${formatVolume(mover.volume ?? undefined)}`);
    lines.push(
      `${rank} ${symbol} ${price.padStart(12)}  ${formatChange(mover.netPercentChange).padStart(18)}  ${volume}`,
      `    ${chalk.gray((mover.description ?? "").slice(0, 30))}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function handleMovers(symbolId: string, options: MoversOptions): Promise<void> {
  const index = oneOf(
    symbolId.toUpperCase() as SchwabMoversIndexSymbol,
    VALID_INDEX_SYMBOLS,
    "index symbol"
  );
  const sort =
    options.sort === undefined
      ? null
      : oneOf(options.sort.toUpperCase() as SchwabMoversSort, VALID_SORTS, "sort");
  const frequency =
    options.frequency === undefined
      ? null
      : oneOf(
          parseInt(options.frequency, 10) as SchwabMoversFrequency,
          VALID_FREQUENCIES,
          "frequency"
        );

  const api = await apiClient();
  const response = await api.getMovers(index, sort ?? undefined, frequency ?? undefined);
  const screeners = response.screeners ?? [];
  const dto: MoversDto = {
    index,
    sort,
    frequency,
    count: screeners.length,
    movers: screeners.map((mover, position) => ({
      rank: position + 1,
      symbol: mover.symbol ?? null,
      description: mover.description ?? null,
      lastPrice: mover.lastPrice ?? null,
      netPercentChange: mover.netPercentChange ?? null,
      volume: mover.volume ?? null,
    })),
  };

  console.log(options.json === true ? JSON.stringify(dto, null, 2) : renderMovers(dto));
}
