import chalk from "chalk";
import { addDays, format } from "date-fns";
import { apiClient } from "./shared.js";

const DEFAULT_DAYS_AHEAD = 90;
const DISPLAY_LIMIT = 20;

export interface ExpiryDto {
  readonly date: string;
  readonly dayOfWeek: string;
  readonly daysToExpiry: number;
}

export interface ExpiriesDto {
  readonly symbol: string;
  readonly contractType: "PUT" | "CALL";
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly expiries: readonly ExpiryDto[];
}

export interface ExpiriesOptions {
  type: string;
  from?: string;
  to?: string;
  json?: boolean;
}

function daysToExpiry(expiry: Date, today: Date): number {
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function renderExpiries(dto: ExpiriesDto): string {
  const header = chalk.bold(`\n📅 Available Expiries: ${dto.symbol}\n`);
  if (dto.count === 0) {
    return `${header}\n${chalk.yellow("No expiries found")}`;
  }

  const rule = chalk.gray("─".repeat(50));
  const lines = [
    header,
    rule,
    `${chalk.gray("Date".padEnd(12))} ${chalk.gray("DTE".padStart(6))} ${chalk.gray("Day")}`,
    rule,
  ];
  for (const expiry of dto.expiries.slice(0, DISPLAY_LIMIT)) {
    const dteColor =
      expiry.daysToExpiry <= 7 ? chalk.red : expiry.daysToExpiry <= 30 ? chalk.yellow : chalk.white;
    lines.push(
      `${chalk.cyan(expiry.date)} ${dteColor(String(expiry.daysToExpiry).padStart(6))} ${chalk.gray(expiry.dayOfWeek)}`
    );
  }
  if (dto.count > DISPLAY_LIMIT) {
    lines.push(chalk.gray(`\n... and ${(dto.count - DISPLAY_LIMIT).toFixed(0)} more expiries`));
  }
  lines.push("");
  return lines.join("\n");
}

export async function handleExpiries(symbol: string, options: ExpiriesOptions): Promise<void> {
  const contractType: "PUT" | "CALL" = options.type.toUpperCase() === "CALL" ? "CALL" : "PUT";
  const today = new Date();
  const from = options.from ?? format(today, "yyyy-MM-dd");
  const to = options.to ?? format(addDays(today, DEFAULT_DAYS_AHEAD), "yyyy-MM-dd");

  const api = await apiClient();
  const expiries = await api.getAvailableExpiries(symbol, contractType, from, to);
  const dto: ExpiriesDto = {
    symbol,
    contractType,
    from,
    to,
    count: expiries.length,
    expiries: expiries.map((expiry) => ({
      date: format(expiry, "yyyy-MM-dd"),
      dayOfWeek: format(expiry, "EEE"),
      daysToExpiry: daysToExpiry(expiry, today),
    })),
  };

  console.log(options.json === true ? JSON.stringify(dto, null, 2) : renderExpiries(dto));
}
