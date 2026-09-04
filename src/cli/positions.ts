import chalk from "chalk";
import { brokerClient } from "./shared.js";
import { parseOccSymbol } from "#src/helpers.js";
import { currencyFormatUsd } from "#src/format.js";
import {
  isPartialObservation,
  requireObservation,
  type BrokerName,
  type BrokerPosition,
  type Observation,
} from "#src/brokers/brokerClient.js";

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

function isPositive(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && value > 0;
}

function formatFixed(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(2);
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
}

function displayText(value: string | null | undefined): string {
  return value ?? "-";
}

function displaySymbol(position: BrokerPosition): string {
  const symbol = position.instrument.symbol;
  if (symbol === null) {
    return "-";
  }
  return position.instrument.assetType === "OPTION" ? parseOccSymbol(symbol) : symbol;
}

function calculateCurrentPrice(position: BrokerPosition): number | null {
  const quantity = isPositive(position.longQuantity)
    ? position.longQuantity
    : position.shortQuantity;
  const marketValue = position.marketValue;
  if (quantity === null || marketValue === null || quantity === 0) {
    return null;
  }
  const contractMultiplier = position.instrument.assetType === "OPTION" ? 100 : 1;
  return Math.abs(marketValue / quantity / contractMultiplier);
}

function calculateOpenProfitLoss(position: BrokerPosition): number | null {
  return isPositive(position.longQuantity)
    ? position.longOpenProfitLoss
    : position.shortOpenProfitLoss;
}

function calculateProfitLossPercent(
  position: BrokerPosition,
  plOpen: number | null
): number | null {
  const quantity = isPositive(position.longQuantity)
    ? position.longQuantity
    : position.shortQuantity;
  const averagePrice = position.averagePrice;
  if (quantity === null || averagePrice === null || plOpen === null || quantity === 0) {
    return null;
  }
  const contractMultiplier = position.instrument.assetType === "OPTION" ? 100 : 1;
  const costBasis = averagePrice * quantity * contractMultiplier;
  return costBasis !== 0 ? (plOpen / costBasis) * 100 : null;
}

export interface PositionsRenderOptions {
  symbol?: string;
  type?: string;
  csv?: boolean;
  json?: boolean;
}

export function renderPositionsObservation(
  observation: Observation<BrokerPosition[]>,
  options: PositionsRenderOptions = {}
): string {
  const safeObservation = requireObservation("getPositions", observation);
  if (options.json) {
    return JSON.stringify(safeObservation, null, 2);
  }

  let positions = safeObservation.value;
  if (options.type) {
    const upperType = options.type.toUpperCase();
    positions = positions.filter((pos) => pos.instrument.assetType === upperType);
  }

  if (positions.length === 0) {
    return options.csv ? "" : chalk.yellow("No positions found");
  }

  const sortedPositions = [...positions].sort((a, b) =>
    displayText(a.instrument.symbol).localeCompare(displayText(b.instrument.symbol))
  );
  const lines: string[] = [];

  if (options.csv) {
    lines.push(
      "Symbol,Type,Long Qty,Short Qty,Avg Price,Cur Price,Market Value,Day P/L,P/L Open,P/L %"
    );
    for (const pos of sortedPositions) {
      const assetType = displayText(pos.instrument.assetType);
      const posSymbol = displaySymbol(pos);
      const longQty = isPositive(pos.longQuantity) ? String(pos.longQuantity) : "0";
      const shortQty = isPositive(pos.shortQuantity) ? String(pos.shortQuantity) : "0";
      const curPrice = calculateCurrentPrice(pos);
      const plOpen = calculateOpenProfitLoss(pos);
      const plPct = calculateProfitLossPercent(pos, plOpen);
      lines.push(
        [
          escapeCsv(posSymbol),
          escapeCsv(assetType),
          longQty,
          shortQty,
          formatFixed(pos.averagePrice),
          formatFixed(curPrice),
          formatFixed(pos.marketValue),
          formatFixed(pos.currentDayProfitLoss),
          formatFixed(plOpen),
          plPct === null ? "-" : plPct.toFixed(2),
        ].join(",")
      );
    }
    return lines.join("\n");
  }

  const filters: string[] = [];
  if (options.symbol) filters.push(options.symbol.toUpperCase());
  if (options.type) filters.push(options.type.toUpperCase());
  const filterText = filters.length > 0 ? `: ${filters.join(", ")}` : "";
  lines.push(chalk.bold(`\n Account Positions${filterText}\n`));
  if (isPartialObservation(safeObservation)) {
    lines.push(chalk.yellow("Warning: Broker data is partial."));
  }
  lines.push(chalk.gray("-".repeat(SEPARATOR_LENGTH)));
  lines.push(
    `${chalk.gray(formatColumn("Symbol", COLUMN_WIDTHS.symbol))} ${chalk.gray(formatColumn("Type", COLUMN_WIDTHS.type))} ${chalk.gray(formatColumn("Long", COLUMN_WIDTHS.longQty, "right"))} ${chalk.gray(formatColumn("Short", COLUMN_WIDTHS.shortQty, "right"))} ${chalk.gray(formatColumn("Avg Price", COLUMN_WIDTHS.avgPrice, "right"))} ${chalk.gray(formatColumn("Cur Price", COLUMN_WIDTHS.curPrice, "right"))} ${chalk.gray(formatColumn("Mkt Value", COLUMN_WIDTHS.marketValue, "right"))} ${chalk.gray(formatColumn("Day P/L", COLUMN_WIDTHS.dayPL, "right"))} ${chalk.gray(formatColumn("P/L Open", COLUMN_WIDTHS.plOpen, "right"))} ${chalk.gray(formatColumn("P/L %", COLUMN_WIDTHS.plPct, "right"))}`
  );
  lines.push(chalk.gray("-".repeat(SEPARATOR_LENGTH)));

  for (const pos of sortedPositions) {
    const assetType = displayText(pos.instrument.assetType);
    const posSymbol = displaySymbol(pos);
    const longQty = isPositive(pos.longQuantity) ? String(pos.longQuantity) : "-";
    const shortQty = isPositive(pos.shortQuantity) ? String(pos.shortQuantity) : "-";
    const curPrice = calculateCurrentPrice(pos);
    const dayPL = pos.currentDayProfitLoss;
    const plOpen = calculateOpenProfitLoss(pos);
    const plPct = calculateProfitLossPercent(pos, plOpen);

    const symbolLabel = formatColumn(posSymbol, COLUMN_WIDTHS.symbol);
    const typeLabel = formatColumn(assetType, COLUMN_WIDTHS.type);
    const longQtyLabel = formatColumn(longQty, COLUMN_WIDTHS.longQty, "right");
    const shortQtyLabel = formatColumn(shortQty, COLUMN_WIDTHS.shortQty, "right");
    const avgPriceLabel = formatColumn(
      currencyFormatUsd(pos.averagePrice),
      COLUMN_WIDTHS.avgPrice,
      "right"
    );
    const curPriceLabel = formatColumn(
      currencyFormatUsd(curPrice),
      COLUMN_WIDTHS.curPrice,
      "right"
    );
    const marketValueLabel = formatColumn(
      currencyFormatUsd(pos.marketValue),
      COLUMN_WIDTHS.marketValue,
      "right"
    );
    const dayPLLabel = formatColumn(formatSignedCurrency(dayPL), COLUMN_WIDTHS.dayPL, "right");
    const plOpenLabel = formatColumn(formatSignedCurrency(plOpen), COLUMN_WIDTHS.plOpen, "right");
    const plPctLabel = formatColumn(
      plPct === null ? "-" : `${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%`,
      COLUMN_WIDTHS.plPct,
      "right"
    );
    lines.push(
      `${chalk.cyan(symbolLabel)} ${chalk.white(typeLabel)} ${chalk.green(longQtyLabel)} ${chalk.red(shortQtyLabel)} ${chalk.white(avgPriceLabel)} ${chalk.white(curPriceLabel)} ${chalk.yellow(marketValueLabel)} ${dayPL !== null && dayPL < 0 ? chalk.red(dayPLLabel) : chalk.green(dayPLLabel)} ${plOpen !== null && plOpen < 0 ? chalk.red(plOpenLabel) : chalk.green(plOpenLabel)} ${plPct !== null && plPct < 0 ? chalk.red(plPctLabel) : chalk.green(plPctLabel)}`
    );
  }
  return lines.join("\n");
}

export async function handlePositions(
  broker: BrokerName,
  symbol?: string,
  type?: string,
  csv?: boolean,
  json?: boolean
): Promise<void> {
  const api = await brokerClient(broker);
  const renderOptions: PositionsRenderOptions = {};
  if (symbol !== undefined) renderOptions.symbol = symbol;
  if (type !== undefined) renderOptions.type = type;
  if (csv !== undefined) renderOptions.csv = csv;
  if (json !== undefined) renderOptions.json = json;
  const output = renderPositionsObservation(await api.getPositions(symbol), renderOptions);
  if (output.length > 0) {
    console.log(output);
  }
}
