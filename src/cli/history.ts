import chalk from "chalk";
import { api } from "./shared.js";

export async function handleHistory(symbol: string, days: number): Promise<void> {
  console.log(chalk.bold(`\n📊 Price History: ${symbol} (${days.toFixed(0)} days)\n`));

  const prices = (await api.getPriceHistory({ symbol, days })).map((c) => c.close);

  if (prices.length === 0) {
    console.log(chalk.yellow("No price history available"));
    return;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const latest = prices[prices.length - 1] ?? 0;
  const first = prices[0] ?? latest;
  const change = ((latest - first) / first) * 100;

  console.log(chalk.gray("─".repeat(50)));
  console.log(`Latest:   ${chalk.white("$" + latest.toFixed(2))}`);
  console.log(`High:     ${chalk.green("$" + max.toFixed(2))}`);
  console.log(`Low:      ${chalk.red("$" + min.toFixed(2))}`);
  console.log(
    `Change:   ${change >= 0 ? chalk.green("+" + change.toFixed(2) + "%") : chalk.red(change.toFixed(2) + "%")}`
  );
  console.log(chalk.gray("─".repeat(50)));

  // Simple sparkline visualization
  const width = 40;
  const range = max - min || 1;
  const sparkline = prices.map((p) => {
    const normalized = (p - min) / range;
    const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    return blocks[Math.floor(normalized * 7)] ?? blocks[0];
  });

  // Sample if too many points
  const sampled =
    sparkline.length > width
      ? sparkline.filter((_, i) => i % Math.ceil(sparkline.length / width) === 0)
      : sparkline;

  console.log(`\n${chalk.cyan(sampled.join(""))}\n`);
}
