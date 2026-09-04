import chalk from "chalk";
import { brokerClient } from "./shared.js";
import {
  isPartialObservation,
  requireObservation,
  type AccountBalances,
  type BrokerName,
  type Observation,
} from "#src/brokers/brokerClient.js";

function formatCurrency(value: number | null | undefined): string {
  if (value === undefined || value === null) return "-";
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2 });
}

export function renderAccountObservation(
  observation: Observation<AccountBalances>,
  json = false
): string {
  const safeObservation = requireObservation("getAccountBalances", observation);
  if (json) {
    return JSON.stringify(safeObservation, null, 2);
  }

  const balances = safeObservation.value;
  const lines = [chalk.bold("\n💰 Account Summary\n")];
  if (isPartialObservation(safeObservation)) {
    lines.push(chalk.yellow("Warning: Broker data is partial."));
  }
  lines.push(chalk.gray("─".repeat(50)));
  lines.push(`Net Liquidation:  ${chalk.green(formatCurrency(balances.liquidationValue))}`);
  lines.push(`Account Equity:   ${chalk.cyan(formatCurrency(balances.equity))}`);
  lines.push(`Cash Balance:     ${chalk.yellow(formatCurrency(balances.cashBalance))}`);
  if (balances.marginBalance !== undefined) {
    lines.push(`Margin Balance:   ${chalk.red(formatCurrency(balances.marginBalance))}`);
  }
  lines.push(`Available Funds:  ${chalk.blue(formatCurrency(balances.availableFunds))}`);
  lines.push(`Buying Power:     ${chalk.magenta(formatCurrency(balances.buyingPower))}`);
  lines.push(chalk.gray("─".repeat(50)));
  return lines.join("\n");
}

export async function handleAccount(broker: BrokerName, json = false): Promise<void> {
  const api = await brokerClient(broker);
  const output = renderAccountObservation(await api.getAccountBalances(), json);
  console.log(output);
}
