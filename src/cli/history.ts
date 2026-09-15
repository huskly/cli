import chalk from "chalk";
import { apiClient } from "./shared.js";
import { closes, toPriceSeriesDto, type PriceSeriesDto } from "./priceSeries.js";

const SPARKLINE_WIDTH = 40;
const SPARKLINE_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

function sparkline(prices: number[], low: number, high: number): string {
  const range = high - low || 1;
  const blocks = prices.map((price) => {
    const index = Math.floor(((price - low) / range) * (SPARKLINE_BLOCKS.length - 1));
    return SPARKLINE_BLOCKS[index] ?? SPARKLINE_BLOCKS[0];
  });
  if (blocks.length <= SPARKLINE_WIDTH) return blocks.join("");
  const step = Math.ceil(blocks.length / SPARKLINE_WIDTH);
  return blocks.filter((_, index) => index % step === 0).join("");
}

export function renderPriceHistory(dto: PriceSeriesDto): string {
  const header = chalk.bold(`\n📊 Price History: ${dto.symbol} (${dto.days.toFixed(0)} days)\n`);
  if (dto.latest === null || dto.high === null || dto.low === null) {
    return `${header}\n${chalk.yellow("No price history available")}`;
  }

  const change = dto.changePercent ?? 0;
  const rule = chalk.gray("─".repeat(50));
  return [
    header,
    rule,
    `Latest:   ${chalk.white("$" + dto.latest.toFixed(2))}`,
    `High:     ${chalk.green("$" + dto.high.toFixed(2))}`,
    `Low:      ${chalk.red("$" + dto.low.toFixed(2))}`,
    `Change:   ${change >= 0 ? chalk.green("+" + change.toFixed(2) + "%") : chalk.red(change.toFixed(2) + "%")}`,
    rule,
    "",
    chalk.cyan(sparkline(closes(dto), dto.low, dto.high)),
    "",
  ].join("\n");
}

export async function handleHistory(symbol: string, days: number, json = false): Promise<void> {
  const api = await apiClient();
  const dto = toPriceSeriesDto(symbol, days, await api.getPriceHistory({ symbol, days }));
  console.log(json ? JSON.stringify(dto, null, 2) : renderPriceHistory(dto));
}
