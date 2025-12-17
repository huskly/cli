import chalk from "chalk";
import { api } from "./shared.js";
import { currencyFormatUsd } from "#src/helpers.js";

const COLUMN_WIDTHS = {
  symbol: 25,
  type: 22,
  longQty: 8,
  shortQty: 8,
  avgPrice: 12,
  marketValue: 14,
  dayPL: 12,
} as const;

const SEPARATOR_LENGTH =
  Object.values(COLUMN_WIDTHS).reduce((total, width) => total + width, 0) +
  Object.keys(COLUMN_WIDTHS).length -
  1;

function formatColumn(value: string, width: number, align: "left" | "right" = "left"): string {
  const truncated = value.length > width ? `${value.slice(0, Math.max(0, width - 3))}...` : value;
  return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
}

export async function handlePositions(symbol?: string): Promise<void> {
  const filterText = symbol ? `: ${symbol.toUpperCase()}` : "";
  console.log(chalk.bold(`\n📋 Account Positions${filterText}\n`));

  const positions = await api.getPositions(symbol);

  if (positions.length === 0) {
    console.log(chalk.yellow("No positions found"));
    return;
  }

  console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));
  console.log(
    `${chalk.gray(formatColumn("Symbol", COLUMN_WIDTHS.symbol))} ${chalk.gray(formatColumn("Type", COLUMN_WIDTHS.type))} ${chalk.gray(formatColumn("Long", COLUMN_WIDTHS.longQty, "right"))} ${chalk.gray(formatColumn("Short", COLUMN_WIDTHS.shortQty, "right"))} ${chalk.gray(formatColumn("Avg Price", COLUMN_WIDTHS.avgPrice, "right"))} ${chalk.gray(formatColumn("Mkt Value", COLUMN_WIDTHS.marketValue, "right"))} ${chalk.gray(formatColumn("Day P/L", COLUMN_WIDTHS.dayPL, "right"))}`
  );
  console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));

  for (const pos of positions) {
    const symbol = pos.instrument.symbol;
    const assetType = pos.instrument.assetType;
    const longQty = pos.longQuantity > 0 ? String(pos.longQuantity) : "-";
    const shortQty = pos.shortQuantity > 0 ? String(pos.shortQuantity) : "-";
    const avgPrice = `$${pos.averagePrice.toFixed(2)}`;
    const marketValue = currencyFormatUsd(pos.marketValue);
    const dayPL = pos.currentDayProfitLoss;
    const dayPLValue = dayPL >= 0 ? `+$${dayPL.toFixed(2)}` : `-$${Math.abs(dayPL).toFixed(2)}`;

    const symbolLabel = formatColumn(symbol, COLUMN_WIDTHS.symbol);
    const typeLabel = formatColumn(assetType, COLUMN_WIDTHS.type);
    const longQtyLabel = formatColumn(longQty, COLUMN_WIDTHS.longQty, "right");
    const shortQtyLabel = formatColumn(shortQty, COLUMN_WIDTHS.shortQty, "right");
    const avgPriceLabel = formatColumn(avgPrice, COLUMN_WIDTHS.avgPrice, "right");
    const marketValueLabel = formatColumn(marketValue, COLUMN_WIDTHS.marketValue, "right");
    const dayPLLabel = formatColumn(dayPLValue, COLUMN_WIDTHS.dayPL, "right");
    console.log(
      `${chalk.cyan(symbolLabel)} ${chalk.white(typeLabel)} ${chalk.green(longQtyLabel)} ${chalk.red(shortQtyLabel)} ${chalk.white(avgPriceLabel)} ${chalk.yellow(marketValueLabel)} ${dayPL >= 0 ? chalk.green(dayPLLabel) : chalk.red(dayPLLabel)}`
    );
  }
  console.log();
}
