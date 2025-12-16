import chalk from "chalk";
import { api } from "./shared.js";

function formatCurrency(value: number): string {
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2 });
}

export async function handleAccount(): Promise<void> {
  console.log(chalk.bold("\n💰 Account Summary\n"));

  const balances = await api.getAccountBalances();

  console.log(chalk.gray("─".repeat(50)));
  console.log(`Net Liquidation:  ${chalk.green(formatCurrency(balances.liquidationValue))}`);
  console.log(`Account Equity:   ${chalk.cyan(formatCurrency(balances.equity))}`);
  console.log(`Cash Balance:     ${chalk.yellow(formatCurrency(balances.cashBalance))}`);
  console.log(`Available Funds:  ${chalk.blue(formatCurrency(balances.availableFunds))}`);
  console.log(`Buying Power:     ${chalk.magenta(formatCurrency(balances.buyingPower))}`);
  console.log(chalk.gray("─".repeat(50)));
  console.log();
}
