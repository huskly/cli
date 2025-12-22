import chalk from "chalk";
import { format, isValid, parseISO, startOfYear } from "date-fns";
import { apiClient } from "./shared.js";
import type { SchwabTransaction, SchwabTransferItem } from "@huskly/schwab-client";
import { currencyFormatUsd } from "#src/format.js";
import { parseOccSymbol } from "#src/helpers.js";

interface TransactionOptions {
  start?: string;
  end?: string;
}

const DATE_FORMAT = "yyyy-MM-dd";
const COLUMN_WIDTHS = {
  id: 12,
  date: 18,
  type: 22,
  symbol: 22,
  quantity: 8,
  amount: 14,
  status: 12,
  details: 40,
} as const;
const SEPARATOR_LENGTH =
  Object.values(COLUMN_WIDTHS).reduce((total, width) => total + width, 0) +
  Object.keys(COLUMN_WIDTHS).length -
  1;

function parseDateInput(value: string, label: string): Date {
  const parsed = parseISO(value);
  if (!isValid(parsed)) {
    throw new Error(`Invalid ${label} date. Use YYYY-MM-DD format.`);
  }
  return parsed;
}

function parseTransactionDate(transaction: SchwabTransaction): Date {
  const dateStr = transaction.time;
  const parsed = dateStr ? new Date(dateStr) : new Date(NaN);
  return parsed;
}

function pickPrimaryTransferItem(items?: SchwabTransferItem[]): SchwabTransferItem | undefined {
  if (!items || items.length === 0) return undefined;
  // Fee items have feeType property and use CURRENCY as instrument
  // Prefer actual instruments (OPTION, EQUITY, etc.) over CURRENCY items
  const actualInstrument = items.find(
    (item) =>
      item.instrument?.assetType && item.instrument.assetType !== "CURRENCY" && !("feeType" in item)
  );
  // Fall back to any non-CURRENCY item, then any item with a symbol
  const nonCurrencyItem = items.find(
    (item) => item.instrument?.assetType && item.instrument.assetType !== "CURRENCY"
  );
  return (
    actualInstrument ?? nonCurrencyItem ?? items.find((item) => item.instrument?.symbol) ?? items[0]
  );
}

function formatColumn(value: string, width: number, align: "left" | "right" = "left"): string {
  const truncated = value.length > width ? `${value.slice(0, Math.max(0, width - 3))}...` : value;
  return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
}

export async function handleTransactions(options: TransactionOptions): Promise<void> {
  const now = new Date();
  const startDate = options.start ? parseDateInput(options.start, "start") : startOfYear(now);
  const endDate = options.end ? parseDateInput(options.end, "end") : now;

  if (startDate > endDate) {
    throw new Error("Start date must be on or before end date.");
  }

  console.log(
    chalk.bold(
      `\n📜 Transaction History (${format(startDate, DATE_FORMAT)} to ${format(endDate, DATE_FORMAT)})\n`
    )
  );
  const api = await apiClient();
  const histories = await api.fetchTransactionHistory(startDate, endDate);

  if (histories.length === 0) {
    console.log(chalk.yellow("No Schwab accounts found."));
    return;
  }

  for (const history of histories) {
    console.log(chalk.bold(`Account ${history.accountNumber}`));
    const transactions = [...history.transactions].sort((a, b) => {
      const aDate = parseTransactionDate(a).getTime();
      const bDate = parseTransactionDate(b).getTime();
      return bDate - aDate;
    });

    if (transactions.length === 0) {
      console.log(chalk.yellow("  No transactions in range.\n"));
      continue;
    }

    console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));
    console.log(
      `${chalk.gray(formatColumn("ID", COLUMN_WIDTHS.id))} ${chalk.gray(formatColumn("Date", COLUMN_WIDTHS.date))} ${chalk.gray(formatColumn("Type", COLUMN_WIDTHS.type))} ${chalk.gray(formatColumn("Symbol", COLUMN_WIDTHS.symbol))} ${chalk.gray(formatColumn("Qty", COLUMN_WIDTHS.quantity, "right"))} ${chalk.gray(formatColumn("Amount", COLUMN_WIDTHS.amount, "right"))} ${chalk.gray(formatColumn("Status", COLUMN_WIDTHS.status))} ${chalk.gray(formatColumn("Details", COLUMN_WIDTHS.details))}`
    );
    console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));

    for (const transaction of transactions) {
      const date = parseTransactionDate(transaction);
      const dateLabel = isValid(date) ? format(date, "yyyy-MM-dd HH:mm") : "-";
      const primaryItem = pickPrimaryTransferItem(transaction.transferItems);
      const rawSymbol =
        primaryItem?.instrument?.symbol ??
        primaryItem?.instrument?.description ??
        transaction.subAccount;
      const isOption = primaryItem?.instrument?.assetType === "OPTION";
      const symbol = isOption ? parseOccSymbol(rawSymbol) : rawSymbol;
      const quantity = primaryItem?.amount ? primaryItem.amount.toString() : "";
      const amount = currencyFormatUsd(transaction.netAmount);
      const detailsSource =
        transaction.description ??
        primaryItem?.instrument?.description ??
        primaryItem?.transferItemType ??
        "";
      const details = formatColumn(detailsSource, COLUMN_WIDTHS.details);
      const idLabel = formatColumn(String(transaction.activityId), COLUMN_WIDTHS.id);
      const typeLabel = formatColumn(transaction.type, COLUMN_WIDTHS.type);
      const symbolLabel = formatColumn(symbol, COLUMN_WIDTHS.symbol);
      const quantityLabel = formatColumn(quantity, COLUMN_WIDTHS.quantity, "right");
      const amountLabel = formatColumn(amount, COLUMN_WIDTHS.amount, "right");
      const statusLabel = formatColumn(transaction.status, COLUMN_WIDTHS.status);

      console.log(
        `${chalk.gray(idLabel)} ${chalk.gray(formatColumn(dateLabel, COLUMN_WIDTHS.date))} ${chalk.white(typeLabel)} ${chalk.cyan(symbolLabel)} ${chalk.white(quantityLabel)} ${chalk.yellow(amountLabel)} ${chalk.white(statusLabel)} ${chalk.white(details)}`
      );
    }

    console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));
    console.log();
  }
}
