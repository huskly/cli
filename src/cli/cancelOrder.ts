import chalk from "chalk";
import { apiClient } from "./shared.js";
import type { SchwabOrder, SchwabOrderStatus } from "@huskly/schwab-client";

/**
 * Order states that Schwab can still cancel.
 *
 * @remarks
 * Cancelling a terminal order is always a mistake, so the command refuses it
 * up front instead of sending a request that the broker will reject.
 */
const CANCELABLE_STATUSES: readonly SchwabOrderStatus[] = [
  "AWAITING_PARENT_ORDER",
  "AWAITING_CONDITION",
  "AWAITING_MANUAL_REVIEW",
  "ACCEPTED",
  "PENDING_ACTIVATION",
  "QUEUED",
  "WORKING",
  "NEW",
];

export interface CancelOrderDto {
  readonly orderId: string;
  readonly account: string;
  readonly symbol: string | null;
  readonly quantity: number | null;
  readonly statusBefore: SchwabOrderStatus | null;
  readonly statusAfter: SchwabOrderStatus | null;
  readonly requested: boolean;
  readonly terminal: boolean;
}

export interface CancelOrderOptions {
  confirm?: boolean;
  json?: boolean;
}

function describe(order: SchwabOrder): { symbol: string | null; quantity: number | null } {
  const leg = order.orderLegCollection?.[0];
  return {
    symbol: leg?.instrument?.symbol ?? null,
    quantity: order.quantity ?? null,
  };
}

export function renderCancelOrder(dto: CancelOrderDto): string {
  const lines = [
    chalk.bold("\n🚫 Cancel Order\n"),
    chalk.gray("─".repeat(40)),
    `  ${chalk.gray("Account:")}  ${dto.account}`,
    `  ${chalk.gray("Order ID:")} ${chalk.cyan(dto.orderId)}`,
    `  ${chalk.gray("Symbol:")}   ${chalk.white(dto.symbol ?? "-")}`,
    `  ${chalk.gray("Quantity:")} ${chalk.white(dto.quantity === null ? "-" : String(dto.quantity))}`,
    `  ${chalk.gray("Status:")}   ${chalk.white(dto.statusBefore ?? "-")} → ${chalk.white(dto.statusAfter ?? "-")}`,
    chalk.gray("─".repeat(40)),
  ];
  if (dto.terminal) {
    lines.push(chalk.green("\n✓ The order reached a terminal state."));
  } else {
    lines.push(
      chalk.yellow("\n! Cancel requested. Schwab cancels asynchronously."),
      chalk.gray("  The order can still fill before the cancel takes effect."),
      chalk.gray(`  Confirm with: huskly-cli orders --status CANCELED`)
    );
  }
  return lines.join("\n");
}

/**
 * Cancel one working Schwab order.
 *
 * @remarks
 * Schwab returns an empty body and cancels asynchronously, so the command
 * re-reads the order afterwards and reports the observed status instead of
 * claiming the cancel completed.
 */
export async function handleCancelOrder(
  orderId: string,
  options: CancelOrderOptions
): Promise<void> {
  if (options.confirm !== true) {
    throw new Error("Cancelling an order requires --confirm.");
  }

  const api = await apiClient();
  const accounts = await api.fetchAccountNumbers();
  const account = accounts[0];
  if (!account) throw new Error("No Schwab accounts found.");

  const before = await api.fetchAccountOrder(account.hashValue, orderId);
  const statusBefore = before.status ?? null;
  if (statusBefore !== null && !CANCELABLE_STATUSES.includes(statusBefore)) {
    throw new Error(`Order ${orderId} is ${statusBefore} and can no longer be cancelled.`);
  }

  await api.cancelOrder(account.hashValue, orderId);
  const after = await api.fetchAccountOrder(account.hashValue, orderId);
  const statusAfter = after.status ?? null;
  const dto: CancelOrderDto = {
    orderId,
    account: account.accountNumber,
    ...describe(before),
    statusBefore,
    statusAfter,
    requested: true,
    terminal: statusAfter === "CANCELED" || statusAfter === "REJECTED" || statusAfter === "FILLED",
  };

  console.log(options.json === true ? JSON.stringify(dto, null, 2) : renderCancelOrder(dto));
}
