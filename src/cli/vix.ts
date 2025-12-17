import chalk from "chalk";
import { api } from "./shared.js";

export async function handleVix(): Promise<void> {
  console.log(chalk.bold("\n😱 VIX (Fear Index)\n"));

  const vix = await api.getVixLevel();
  if (!vix) {
    console.log(chalk.red("VIX level unavailable."));
    return;
  }

  const color =
    vix < 15 ? chalk.green : vix < 20 ? chalk.yellow : vix < 30 ? chalk.hex("#FFA500") : chalk.red;

  const sentiment =
    vix < 15
      ? "Low volatility (complacent)"
      : vix < 20
        ? "Normal volatility"
        : vix < 30
          ? "Elevated volatility (caution)"
          : "High volatility (fear)";

  console.log(chalk.gray("─".repeat(50)));
  console.log(`VIX:      ${color(vix.toFixed(2))}`);
  console.log(`Sentiment: ${color(sentiment)}`);
  console.log(chalk.gray("─".repeat(50)));
  console.log();
}
