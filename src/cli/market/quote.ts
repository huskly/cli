import chalk from "chalk";
import { api } from "./shared.js";
import { ensure } from "#src/helpers.js";

export async function handleQuote(symbols: string[]): Promise<void> {
  console.log(chalk.bold("\n📈 Market Quotes\n"));
  console.log(chalk.gray("─".repeat(50)));

  for (const symbol of symbols) {
    try {
      const quotes = await api.getQuotes([symbol]);
      const price = ensure(quotes[symbol], "No quote data available");
      console.log(`${chalk.cyan(symbol.padEnd(10))} ${chalk.white("$" + price.toFixed(2))}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${chalk.cyan(symbol.padEnd(10))} ${chalk.red(message)}`);
    }
  }
  console.log();
}
