import chalk from "chalk";
import { format, isValid, parseISO, subDays } from "date-fns";
import { apiClient } from "./shared.js";
import type { SchwabOrder, SchwabOrderStatus } from "#src/types.js";
import { currencyFormatUsd } from "#src/format.js";

interface OrdersOptions {
  from?: string;
  to?: string;
  status?: SchwabOrderStatus;
  maxResults?: string;
}

const DATE_FORMAT = "yyyy-MM-dd";
const COLUMN_WIDTHS = {
  date: 18,
  status: 20,
  type: 12,
  symbol: 25,
  instruction: 14,
  quantity: 8,
  price: 12,
  filled: 8,
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

function parseOrderDate(order: SchwabOrder): Date {
  const dateStr = order.enteredTime;
  const parsed = dateStr ? new Date(dateStr) : new Date(NaN);
  return parsed;
}

function formatColumn(value: string, width: number, align: "left" | "right" = "left"): string {
  const truncated = value.length > width ? `${value.slice(0, Math.max(0, width - 3))}...` : value;
  return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
}

function getStatusColor(status: SchwabOrderStatus | undefined): (text: string) => string {
  switch (status) {
    case "FILLED":
      return chalk.green;
    case "WORKING":
    case "QUEUED":
    case "PENDING_ACTIVATION":
    case "ACCEPTED":
      return chalk.cyan;
    case "REJECTED":
    case "CANCELED":
    case "EXPIRED":
      return chalk.red;
    case "PENDING_CANCEL":
    case "PENDING_REPLACE":
    case "REPLACED":
      return chalk.yellow;
    default:
      return chalk.white;
  }
}

function getOrderSymbol(order: SchwabOrder): string {
  const legs = order.orderLegCollection;
  if (!legs || legs.length === 0) return "-";

  if (legs.length === 1) {
    return legs[0]?.instrument?.symbol ?? "-";
  }

  // For multi-leg orders, show primary symbol or indicate multi-leg
  const symbols = legs.map((leg) => leg.instrument?.symbol).filter(Boolean);
  const uniqueSymbols = [...new Set(symbols)];
  if (uniqueSymbols.length === 1) {
    return uniqueSymbols[0] ?? "-";
  }
  return `${uniqueSymbols[0] ?? "-"} +${String(legs.length - 1)}`;
}

function getOrderInstruction(order: SchwabOrder): string {
  const legs = order.orderLegCollection;
  if (!legs || legs.length === 0) return "-";

  if (legs.length === 1) {
    return legs[0]?.instruction ?? "-";
  }

  // For complex orders, show the strategy type
  return order.complexOrderStrategyType ?? "MULTI-LEG";
}

function getOrderPrice(order: SchwabOrder): string {
  if (order.price !== undefined) {
    return currencyFormatUsd(order.price);
  }
  if (order.stopPrice !== undefined) {
    return `Stop: ${currencyFormatUsd(order.stopPrice)}`;
  }
  return "-";
}

export async function handleOrders(options: OrdersOptions): Promise<void> {
  const now = new Date();
  // Default to last 30 days if no dates provided
  const toDate = options.to ? parseDateInput(options.to, "to") : now;
  const fromDate = options.from ? parseDateInput(options.from, "from") : subDays(now, 30);

  if (fromDate > toDate) {
    throw new Error("From date must be on or before to date.");
  }

  console.log(
    chalk.bold(`\n📋 Orders (${format(fromDate, DATE_FORMAT)} to ${format(toDate, DATE_FORMAT)})\n`)
  );

  const fetchOptions: Parameters<typeof api.fetchOrders>[0] = {
    fromEnteredTime: fromDate,
    toEnteredTime: toDate,
  };
  if (options.maxResults) {
    fetchOptions.maxResults = parseInt(options.maxResults, 10);
  }
  if (options.status) {
    fetchOptions.status = options.status;
  }

  const api = await apiClient();
  const accountOrders = await api.fetchOrders(fetchOptions);

  if (accountOrders.length === 0) {
    console.log(chalk.yellow("No Schwab accounts found."));
    return;
  }

  for (const account of accountOrders) {
    console.log(chalk.bold(`Account ${account.accountNumber}`));
    const orders = [...account.orders].sort((a, b) => {
      const aDate = parseOrderDate(a).getTime();
      const bDate = parseOrderDate(b).getTime();
      return bDate - aDate;
    });

    if (orders.length === 0) {
      console.log(chalk.yellow("  No orders in range.\n"));
      continue;
    }

    console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));
    console.log(
      `${chalk.gray(formatColumn("Date", COLUMN_WIDTHS.date))} ${chalk.gray(formatColumn("Status", COLUMN_WIDTHS.status))} ${chalk.gray(formatColumn("Type", COLUMN_WIDTHS.type))} ${chalk.gray(formatColumn("Symbol", COLUMN_WIDTHS.symbol))} ${chalk.gray(formatColumn("Instruction", COLUMN_WIDTHS.instruction))} ${chalk.gray(formatColumn("Qty", COLUMN_WIDTHS.quantity, "right"))} ${chalk.gray(formatColumn("Price", COLUMN_WIDTHS.price, "right"))} ${chalk.gray(formatColumn("Filled", COLUMN_WIDTHS.filled, "right"))}`
    );
    console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));

    for (const order of orders) {
      const date = parseOrderDate(order);
      const dateLabel = isValid(date) ? format(date, "yyyy-MM-dd HH:mm") : "-";
      const status = order.status ?? "UNKNOWN";
      const statusColor = getStatusColor(order.status);
      const orderType = order.orderType ?? "-";
      const symbol = getOrderSymbol(order);
      const instruction = getOrderInstruction(order);
      const quantity = order.quantity?.toString() ?? "-";
      const price = getOrderPrice(order);
      const filled = order.filledQuantity?.toString() ?? "0";

      console.log(
        `${chalk.gray(formatColumn(dateLabel, COLUMN_WIDTHS.date))} ${statusColor(formatColumn(status, COLUMN_WIDTHS.status))} ${chalk.white(formatColumn(orderType, COLUMN_WIDTHS.type))} ${chalk.cyan(formatColumn(symbol, COLUMN_WIDTHS.symbol))} ${chalk.white(formatColumn(instruction, COLUMN_WIDTHS.instruction))} ${chalk.white(formatColumn(quantity, COLUMN_WIDTHS.quantity, "right"))} ${chalk.yellow(formatColumn(price, COLUMN_WIDTHS.price, "right"))} ${chalk.green(formatColumn(filled, COLUMN_WIDTHS.filled, "right"))}`
      );
    }

    console.log(chalk.gray("─".repeat(SEPARATOR_LENGTH)));
    console.log();
  }
}
