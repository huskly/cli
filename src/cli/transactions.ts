import chalk from "chalk";
import { endOfDay, format, isValid, parseISO, startOfYear } from "date-fns";
import { brokerClient } from "./shared.js";
import { currencyFormatUsd } from "#src/format.js";
import { parseOccSymbol } from "#src/helpers.js";
import {
  isPartialObservation,
  requireObservation,
  type BrokerName,
  type BrokerTransaction,
  type BrokerTransactionHistory,
  type BrokerTransferItem,
  type Observation,
} from "#src/brokers/brokerClient.js";

interface TransactionOptions {
  start?: string;
  end?: string;
  csv?: boolean;
  type?: string;
  json?: boolean;
}

/** Escapes a value for CSV output by wrapping in quotes if it contains special characters. */
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const DATE_FORMAT = "yyyy-MM-dd";
const COLUMN_WIDTHS = {
  id: 12,
  date: 18,
  type: 22,
  symbol: 22,
  quantity: 8,
  amount: 14,
  fees: 10,
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

function parseTransactionDate(transaction: BrokerTransaction): Date {
  const dateStr = transaction.time;
  return dateStr ? new Date(dateStr) : new Date(NaN);
}

function pickPrimaryTransferItem(items?: BrokerTransferItem[]): BrokerTransferItem | undefined {
  if (!items || items.length === 0) return undefined;
  const actualInstrument = items.find(
    (item) =>
      item.instrument?.assetType && item.instrument.assetType !== "CURRENCY" && !item.feeType
  );
  const nonCurrencyItem = items.find(
    (item) => item.instrument?.assetType && item.instrument.assetType !== "CURRENCY"
  );
  return (
    actualInstrument ?? nonCurrencyItem ?? items.find((item) => item.instrument?.symbol) ?? items[0]
  );
}

function calculateTotalFees(items?: BrokerTransferItem[]): number {
  if (!items || items.length === 0) return 0;
  return items.reduce((total, item) => {
    if (item.feeType && item.cost !== undefined && item.cost !== null) {
      return total + Math.abs(item.cost);
    }
    return total;
  }, 0);
}

function formatColumn(value: string, width: number, align: "left" | "right" = "left"): string {
  const truncated = value.length > width ? `${value.slice(0, Math.max(0, width - 3))}...` : value;
  return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
}

function displayText(value: string | null | undefined, fallback = ""): string {
  return value ?? fallback;
}

function accountHeading(accountNumber: string | undefined): string {
  return accountNumber ? `Account ${accountNumber}` : "Account";
}

function collectTransactions(
  histories: BrokerTransactionHistory[],
  type?: string
): { accountNumber?: string; transaction: BrokerTransaction }[] {
  const allTransactions: { accountNumber?: string; transaction: BrokerTransaction }[] = [];
  for (const history of histories) {
    for (const transaction of history.transactions) {
      if (type && displayText(transaction.type).toUpperCase() !== type.toUpperCase()) {
        continue;
      }
      allTransactions.push(
        history.accountNumber === undefined
          ? { transaction }
          : { accountNumber: history.accountNumber, transaction }
      );
    }
  }
  allTransactions.sort((a, b) => {
    const aDate = parseTransactionDate(a.transaction).getTime();
    const bDate = parseTransactionDate(b.transaction).getTime();
    return bDate - aDate;
  });
  return allTransactions;
}

export function renderTransactionObservation(
  observation: Observation<BrokerTransactionHistory[]>,
  options: TransactionOptions,
  startDate: Date,
  endDate: Date
): string {
  const safeObservation = requireObservation("fetchTransactionHistory", observation);
  if (options.json) {
    return JSON.stringify(safeObservation, null, 2);
  }

  const histories = safeObservation.value;
  if (histories.length === 0) {
    return options.csv ? "" : chalk.yellow("No accounts found.");
  }

  const allTransactions = collectTransactions(histories, options.type);
  const lines: string[] = [];

  if (options.csv) {
    lines.push("Account,ID,Date,Type,Symbol,Quantity,Amount,Fees,Details");
    for (const { accountNumber, transaction } of allTransactions) {
      const date = parseTransactionDate(transaction);
      const dateLabel = isValid(date) ? format(date, "yyyy-MM-dd HH:mm") : "";
      const primaryItem = pickPrimaryTransferItem(transaction.transferItems);
      const rawSymbol =
        primaryItem?.instrument?.symbol ??
        primaryItem?.instrument?.description ??
        transaction.subAccount ??
        "";
      const isOption = primaryItem?.instrument?.assetType === "OPTION";
      const symbol = isOption ? parseOccSymbol(rawSymbol) : rawSymbol;
      const quantity =
        primaryItem?.amount === null || primaryItem?.amount === undefined
          ? ""
          : primaryItem.amount.toString();
      const amount = transaction.netAmount === null ? "-" : transaction.netAmount.toFixed(2);
      const fees = calculateTotalFees(transaction.transferItems);
      const feesStr = fees !== 0 ? fees.toFixed(2) : "";
      const baseDetails =
        transaction.description ??
        primaryItem?.instrument?.description ??
        primaryItem?.transferItemType ??
        "";
      const details =
        transaction.status !== "VALID"
          ? `[${displayText(transaction.status, "UNKNOWN")}] ${baseDetails}`
          : baseDetails;
      lines.push(
        [
          escapeCsv(accountNumber ?? ""),
          escapeCsv(String(transaction.activityId ?? "")),
          escapeCsv(dateLabel),
          escapeCsv(displayText(transaction.type)),
          escapeCsv(symbol),
          quantity,
          amount,
          feesStr,
          escapeCsv(details),
        ].join(",")
      );
    }
    return lines.join("\n");
  }

  lines.push(
    chalk.bold(
      `\n📜 Transaction History (${format(startDate, DATE_FORMAT)} to ${format(endDate, DATE_FORMAT)})\n`
    )
  );
  if (isPartialObservation(safeObservation)) {
    lines.push(chalk.yellow("Warning: Broker data is partial."));
  }

  for (const history of histories) {
    lines.push(chalk.bold(accountHeading(history.accountNumber)));
    const transactions = [...history.transactions]
      .filter(
        (t) => !options.type || displayText(t.type).toUpperCase() === options.type.toUpperCase()
      )
      .sort((a, b) => {
        const aDate = parseTransactionDate(a).getTime();
        const bDate = parseTransactionDate(b).getTime();
        return bDate - aDate;
      });

    if (transactions.length === 0) {
      lines.push(chalk.yellow("  No transactions in range.\n"));
      continue;
    }

    lines.push(chalk.gray("─".repeat(SEPARATOR_LENGTH)));
    lines.push(
      `${chalk.gray(formatColumn("ID", COLUMN_WIDTHS.id))} ${chalk.gray(formatColumn("Date", COLUMN_WIDTHS.date))} ${chalk.gray(formatColumn("Type", COLUMN_WIDTHS.type))} ${chalk.gray(formatColumn("Symbol", COLUMN_WIDTHS.symbol))} ${chalk.gray(formatColumn("Qty", COLUMN_WIDTHS.quantity, "right"))} ${chalk.gray(formatColumn("Amount", COLUMN_WIDTHS.amount, "right"))} ${chalk.gray(formatColumn("Fees", COLUMN_WIDTHS.fees, "right"))} ${chalk.gray(formatColumn("Details", COLUMN_WIDTHS.details))}`
    );
    lines.push(chalk.gray("─".repeat(SEPARATOR_LENGTH)));

    for (const transaction of transactions) {
      const date = parseTransactionDate(transaction);
      const dateLabel = isValid(date) ? format(date, "yyyy-MM-dd HH:mm") : "-";
      const primaryItem = pickPrimaryTransferItem(transaction.transferItems);
      const rawSymbol =
        primaryItem?.instrument?.symbol ??
        primaryItem?.instrument?.description ??
        transaction.subAccount ??
        "";
      const isOption = primaryItem?.instrument?.assetType === "OPTION";
      const symbol = isOption ? parseOccSymbol(rawSymbol) : rawSymbol;
      const quantity =
        primaryItem?.amount === null || primaryItem?.amount === undefined
          ? "-"
          : primaryItem.amount.toString();
      const amount = currencyFormatUsd(transaction.netAmount);
      const fees = calculateTotalFees(transaction.transferItems);
      const feesStr = fees !== 0 ? currencyFormatUsd(fees) : "";
      const baseDetails =
        transaction.description ??
        primaryItem?.instrument?.description ??
        primaryItem?.transferItemType ??
        "";
      const detailsSource =
        transaction.status !== "VALID"
          ? `[${displayText(transaction.status, "UNKNOWN")}] ${baseDetails}`
          : baseDetails;
      const details = formatColumn(detailsSource, COLUMN_WIDTHS.details);
      const idLabel = formatColumn(String(transaction.activityId ?? "-"), COLUMN_WIDTHS.id);
      const typeLabel = formatColumn(displayText(transaction.type, "-"), COLUMN_WIDTHS.type);
      const symbolLabel = formatColumn(symbol, COLUMN_WIDTHS.symbol);
      const quantityLabel = formatColumn(quantity, COLUMN_WIDTHS.quantity, "right");
      const amountLabel = formatColumn(amount, COLUMN_WIDTHS.amount, "right");
      const feesLabel = formatColumn(feesStr, COLUMN_WIDTHS.fees, "right");

      lines.push(
        `${chalk.gray(idLabel)} ${chalk.gray(formatColumn(dateLabel, COLUMN_WIDTHS.date))} ${chalk.white(typeLabel)} ${chalk.cyan(symbolLabel)} ${chalk.white(quantityLabel)} ${chalk.yellow(amountLabel)} ${chalk.red(feesLabel)} ${chalk.white(details)}`
      );
    }

    lines.push(chalk.gray("─".repeat(SEPARATOR_LENGTH)));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export async function handleTransactions(
  broker: BrokerName,
  options: TransactionOptions
): Promise<void> {
  const now = new Date();
  const startDate = options.start ? parseDateInput(options.start, "start") : startOfYear(now);
  const endDate = options.end ? endOfDay(parseDateInput(options.end, "end")) : now;

  if (startDate > endDate) {
    throw new Error("Start date must be on or before end date.");
  }

  const api = await brokerClient(broker);
  const output = renderTransactionObservation(
    await api.fetchTransactionHistory(startDate, endDate),
    options,
    startDate,
    endDate
  );
  if (output.length > 0) {
    console.log(output);
  }
}
