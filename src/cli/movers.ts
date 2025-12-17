import chalk from "chalk";
import { apiClient } from "./shared.js";
import { formatNumber, formatVolume } from "../format.js";
import type {
  SchwabMoversIndexSymbol,
  SchwabMoversSort,
  SchwabMoversFrequency,
  SchwabMover,
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

function formatChange(change: number | undefined): string {
  if (change === undefined) return "-";
  const formatted = change * 100;
  if (change > 0) {
    return chalk.green(`+${formatted.toFixed(2)}%`);
  } else {
    return chalk.red(`${formatted.toFixed(2)}%`);
  }
}

function printMover(mover: SchwabMover, index: number): void {
  const rank = chalk.gray(`${String(index + 1).padStart(2)}.`);
  const symbol = chalk.cyan.bold((mover.symbol ?? "-").padEnd(8));
  const price = chalk.white(`$${formatNumber(mover.lastPrice)}`);
  const change = formatChange(mover.netPercentChange);
  const volume = chalk.gray(`Vol: ${formatVolume(mover.volume)}`);
  const description = chalk.gray((mover.description ?? "").slice(0, 30));

  console.log(`${rank} ${symbol} ${price.padStart(12)}  ${change.padStart(18)}  ${volume}`);
  console.log(`    ${description}`);
}

export interface MoversOptions {
  sort?: string;
  frequency?: string;
}

export async function handleMovers(symbolId: string, options: MoversOptions): Promise<void> {
  const upperSymbolId = symbolId.toUpperCase() as SchwabMoversIndexSymbol;

  if (!VALID_INDEX_SYMBOLS.includes(upperSymbolId)) {
    console.error(
      chalk.red(`Invalid index symbol: ${symbolId}`),
      chalk.gray(`\nValid options: ${VALID_INDEX_SYMBOLS.join(", ")}`)
    );
    process.exit(1);
  }

  let sort: SchwabMoversSort | undefined;
  if (options.sort) {
    const upperSort = options.sort.toUpperCase() as SchwabMoversSort;
    if (!VALID_SORTS.includes(upperSort)) {
      console.error(
        chalk.red(`Invalid sort: ${options.sort}`),
        chalk.gray(`\nValid options: ${VALID_SORTS.join(", ")}`)
      );
      process.exit(1);
    }
    sort = upperSort;
  }

  let frequency: SchwabMoversFrequency | undefined;
  if (options.frequency !== undefined) {
    const freq = parseInt(options.frequency, 10) as SchwabMoversFrequency;
    if (!VALID_FREQUENCIES.includes(freq)) {
      console.error(
        chalk.red(`Invalid frequency: ${options.frequency}`),
        chalk.gray(`\nValid options: ${VALID_FREQUENCIES.join(", ")}`)
      );
      process.exit(1);
    }
    frequency = freq;
  }

  console.log(chalk.bold(`\nTop Movers for ${upperSymbolId}\n`));

  const sortLabel = sort ?? "default";
  const freqLabel = frequency !== undefined ? `${String(frequency)} min` : "default";
  console.log(chalk.gray(`Sort: ${sortLabel}  |  Frequency: ${freqLabel}\n`));
  console.log(chalk.gray("-".repeat(70)));

  const api = await apiClient();
  const response = await api.getMovers(upperSymbolId, sort, frequency);

  if (!response.screeners || response.screeners.length === 0) {
    console.log(chalk.yellow(`No movers found for ${upperSymbolId}`));
    return;
  }

  console.log();
  response.screeners.forEach((mover, index) => {
    printMover(mover, index);
  });
  console.log();
}
