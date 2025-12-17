import chalk from "chalk";
import { addDays, format } from "date-fns";
import { api } from "./shared.js";

export async function handleExpiries(
  symbol: string,
  options: { type: string; from?: string; to?: string }
): Promise<void> {
  const contractType: "PUT" | "CALL" = options.type.toUpperCase() === "CALL" ? "CALL" : "PUT";
  const defaultDaysAhead = 90;
  const fromDate = options.from ?? format(new Date(), "yyyy-MM-dd");
  const toDate = options.to ?? format(addDays(new Date(), defaultDaysAhead), "yyyy-MM-dd");

  console.log(chalk.bold(`\n📅 Available Expiries: ${symbol}\n`));

  const expiries = await api.getAvailableExpiries(symbol, contractType, fromDate, toDate);

  if (expiries.length === 0) {
    console.log(chalk.yellow("No expiries found"));
    return;
  }

  console.log(chalk.gray("─".repeat(50)));
  console.log(
    `${chalk.gray("Date".padEnd(12))} ${chalk.gray("DTE".padStart(6))} ${chalk.gray("Day")}`
  );
  console.log(chalk.gray("─".repeat(50)));

  const today = new Date();
  for (const expiry of expiries.slice(0, 20)) {
    const dte = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const dayName = format(expiry, "EEE");
    const dateStr = format(expiry, "yyyy-MM-dd");
    const dteColor = dte <= 7 ? chalk.red : dte <= 30 ? chalk.yellow : chalk.white;
    console.log(
      `${chalk.cyan(dateStr)} ${dteColor(String(dte).padStart(6))} ${chalk.gray(dayName)}`
    );
  }

  if (expiries.length > 20) {
    console.log(chalk.gray(`\n... and ${(expiries.length - 20).toFixed(0)} more expiries`));
  }
  console.log();
}
