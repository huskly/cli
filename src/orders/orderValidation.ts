import type { SchwabInstruction, SchwabOrderType } from "@huskly/schwab-client";
import { ensureFloat } from "#src/helpers.js";

export const EQUITY_INSTRUCTIONS = ["BUY", "SELL", "BUY_TO_COVER", "SELL_SHORT"] as const;
export const OPTION_INSTRUCTIONS = [
  "BUY_TO_OPEN",
  "SELL_TO_OPEN",
  "BUY_TO_CLOSE",
  "SELL_TO_CLOSE",
] as const;

// Both place-order and place-option-order only construct request fields for MARKET/LIMIT
// (see buildOptionOrderRequest.ts and placeOrder.ts), and both commands advertise only these
// two in their CLI help text, so that's the full allowed set here.
export const CLI_ORDER_TYPES = ["MARKET", "LIMIT"] as const;

export function validateInstruction(
  instruction: string,
  allowed: readonly string[]
): SchwabInstruction {
  const upper = instruction.toUpperCase();
  if (!allowed.includes(upper)) {
    throw new Error(`Invalid instruction "${instruction}". Valid options: ${allowed.join(", ")}`);
  }
  return upper as SchwabInstruction;
}

export function validateOrderType(orderType: string): (typeof CLI_ORDER_TYPES)[number] {
  const upper = orderType.toUpperCase();
  if (!CLI_ORDER_TYPES.includes(upper as (typeof CLI_ORDER_TYPES)[number])) {
    throw new Error(
      `Invalid order type "${orderType}". Valid options: ${CLI_ORDER_TYPES.join(", ")}`
    );
  }
  return upper as (typeof CLI_ORDER_TYPES)[number];
}

export function validateQuantity(quantity: string): number {
  const trimmed = quantity.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
    throw new Error(`Invalid quantity "${quantity}". Must be a positive integer.`);
  }
  return Number(trimmed);
}

export function validatePrice(
  price: string | undefined,
  orderType: SchwabOrderType
): number | undefined {
  if (orderType === "LIMIT") {
    return ensureFloat(price, "Price is required for LIMIT orders. Use --price <price>.");
  }
  if (orderType === "STOP") {
    return ensureFloat(price, "Price is required for STOP orders. Use --price <price>.");
  }
  return undefined;
}
