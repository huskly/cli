import chalk from "chalk";
import { brokerClient } from "./shared.js";
import { parseOccSymbol } from "#src/helpers.js";
import { currencyFormatUsd } from "#src/format.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";

/** Escapes a value for CSV output by wrapping in quotes if it contains special characters. */
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const COLUMN_WIDTHS = {
  symbol: 25,
  type: 22,
  longQty: 8,
  shortQty: 8,
  avgPrice: 12,
  curPrice: 12,
  marketValue: 14,
  dayPL: 12,
  plOpen: 14,
  plPct: 10,
} as const;

const SEPARATOR_LENGTH =
  Object.values(COLUMN_WIDTHS).reduce((total, width) => total + width, 0) +
  Object.keys(COLUMN_WIDTHS).length -
  1;

function formatColumn(value: string, width: number, align: "left" | "right" = "left"): string {
  const truncated = value.length > width ? `${value.slice(0, Math.max(0, width - 3))}...` : value;
  return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
}

export async function handlePositions(
  broker: BrokerName,
  symbol?: string,
  type?: string,
  csv?: boolean
): Promise<void> {
  const api = await brokerClient(broker);
  let positions = await api.getPositions(symbol);

  // Filter by asset type if specified
  if (type) {
    const upperType = type.toUpperCase();
    positions = positions.filter((pos) => pos.instrument.assetType === upperType);
  }

  if (positions.length === 0) {
    if (csv) {
      // No output for CSV when empty
      return;
    }
    console.log(chalk.yellow("No positions found"));
    return;
  }

  const sortedPositions = positions.sort((a, b) =>
    a.instrument.symbol.localeCompare(b.instrument.symbol)
  );

  if (csv) {
    // Output CSV header
    console.log(
      "Symbol,Type,Long Qty,Short Qty,Avg Price,Cur Price,Market Value,Day P/L,P/L Open,P/L %"
    );

    for (const pos of sortedPositions) {
      const assetType = pos.instrument.assetType;
      const isOption = assetType === "OPTION";
      const contractMultiplier = isOption ? 100 : 1;
      const posSymbol = isOption ? parseOccSymbol(pos.instrument.symbol) : pos.instrument.symbol;
      const longQty = pos.longQuantity > 0 ? pos.longQuantity : 0;
      const shortQty = pos.shortQuantity > 0 ? pos.shortQuantity : 0;
      const quantity = pos.longQuantity > 0 ? pos.longQuantity : pos.shortQuantity;
      const curPrice =
        quantity !== 0 ? Math.abs(pos.marketValue / quantity / contractMultiplier) : 0;
      const plOpen = pos.longQuantity > 0 ? pos.longOpenProfitLoss : pos.shortOpenProfitLoss;
      const costBasis = pos.averagePrice * quantity * contractMultiplier;
      const plPct = costBasis !== 0 ? (plOpen / costBasis) * 100 : 0;

      console.log(
        [
          escapeCsv(posSymbol),
          escapeCsv(assetType),
          longQty,
          shortQty,
          pos.averagePrice.toFixed(2),
          curPrice.toFixed(2),
          pos.marketValue.toFixed(2),
          pos.currentDayProfitLoss.toFixed(2),
          plOpen.toFixed(2),
          plPct.toFixed(2),
        ].join(",")
      );
    }
    return;
  }

  // Table output (default)
  const filters: string[] = [];
  if (symbol) filters.push(symbol.toUpperCase());
  if (type) filters.push(type.toUpperCase());
  const filterText = filters.length > 0 ? `: ${filters.join(", ")}` : "";
  console.log(chalk.bold(`\n Account Positions${filterText}\n`));

  console.log(chalk.gray("-".repeat(SEPARATOR_LENGTH)));
  console.log(
    `${chalk.gray(formatColumn("Symbol", COLUMN_WIDTHS.symbol))} ${chalk.gray(formatColumn("Type", COLUMN_WIDTHS.type))} ${chalk.gray(formatColumn("Long", COLUMN_WIDTHS.longQty, "right"))} ${chalk.gray(formatColumn("Short", COLUMN_WIDTHS.shortQty, "right"))} ${chalk.gray(formatColumn("Avg Price", COLUMN_WIDTHS.avgPrice, "right"))} ${chalk.gray(formatColumn("Cur Price", COLUMN_WIDTHS.curPrice, "right"))} ${chalk.gray(formatColumn("Mkt Value", COLUMN_WIDTHS.marketValue, "right"))} ${chalk.gray(formatColumn("Day P/L", COLUMN_WIDTHS.dayPL, "right"))} ${chalk.gray(formatColumn("P/L Open", COLUMN_WIDTHS.plOpen, "right"))} ${chalk.gray(formatColumn("P/L %", COLUMN_WIDTHS.plPct, "right"))}`
  );
  console.log(chalk.gray("-".repeat(SEPARATOR_LENGTH)));

  for (const pos of sortedPositions) {
    const assetType = pos.instrument.assetType;
    const isOption = assetType === "OPTION";
    const contractMultiplier = isOption ? 100 : 1;
    const posSymbol = isOption ? parseOccSymbol(pos.instrument.symbol) : pos.instrument.symbol;
    const longQty = pos.longQuantity > 0 ? String(pos.longQuantity) : "-";
    const shortQty = pos.shortQuantity > 0 ? String(pos.shortQuantity) : "-";
    const avgPrice = `$${pos.averagePrice.toFixed(2)}`;
    const quantity = pos.longQuantity > 0 ? pos.longQuantity : pos.shortQuantity;
    const curPrice = quantity !== 0 ? Math.abs(pos.marketValue / quantity / contractMultiplier) : 0;
    const curPriceStr = `$${curPrice.toFixed(2)}`;
    const marketValue = currencyFormatUsd(pos.marketValue);
    const dayPL = pos.currentDayProfitLoss;
    const dayPLValue = dayPL >= 0 ? `+$${dayPL.toFixed(2)}` : `-$${Math.abs(dayPL).toFixed(2)}`;

    // P/L Open: use long or short open P/L based on position type
    const plOpen = pos.longQuantity > 0 ? pos.longOpenProfitLoss : pos.shortOpenProfitLoss;
    const plOpenValue = plOpen >= 0 ? `+$${plOpen.toFixed(2)}` : `-$${Math.abs(plOpen).toFixed(2)}`;

    // P/L %: calculate percentage based on cost basis
    const costBasis = pos.averagePrice * quantity * contractMultiplier;
    const plPct = costBasis !== 0 ? (plOpen / costBasis) * 100 : 0;
    const plPctValue = `${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%`;

    const symbolLabel = formatColumn(posSymbol, COLUMN_WIDTHS.symbol);
    const typeLabel = formatColumn(assetType, COLUMN_WIDTHS.type);
    const longQtyLabel = formatColumn(longQty, COLUMN_WIDTHS.longQty, "right");
    const shortQtyLabel = formatColumn(shortQty, COLUMN_WIDTHS.shortQty, "right");
    const avgPriceLabel = formatColumn(avgPrice, COLUMN_WIDTHS.avgPrice, "right");
    const curPriceLabel = formatColumn(curPriceStr, COLUMN_WIDTHS.curPrice, "right");
    const marketValueLabel = formatColumn(marketValue, COLUMN_WIDTHS.marketValue, "right");
    const dayPLLabel = formatColumn(dayPLValue, COLUMN_WIDTHS.dayPL, "right");
    const plOpenLabel = formatColumn(plOpenValue, COLUMN_WIDTHS.plOpen, "right");
    const plPctLabel = formatColumn(plPctValue, COLUMN_WIDTHS.plPct, "right");
    console.log(
      `${chalk.cyan(symbolLabel)} ${chalk.white(typeLabel)} ${chalk.green(longQtyLabel)} ${chalk.red(shortQtyLabel)} ${chalk.white(avgPriceLabel)} ${chalk.white(curPriceLabel)} ${chalk.yellow(marketValueLabel)} ${dayPL >= 0 ? chalk.green(dayPLLabel) : chalk.red(dayPLLabel)} ${plOpen >= 0 ? chalk.green(plOpenLabel) : chalk.red(plOpenLabel)} ${plPct >= 0 ? chalk.green(plPctLabel) : chalk.red(plPctLabel)}`
    );
  }
  console.log();
}
