import {
  ALL_SCHWAB_ORDER_TYPES,
  type SchwabInstruction,
  type SchwabOrderType,
} from "@huskly/schwab-client";
import { ensureFloat } from "#src/helpers.js";

export const EQUITY_INSTRUCTIONS = ["BUY", "SELL", "BUY_TO_COVER", "SELL_SHORT"] as const;
export const OPTION_INSTRUCTIONS = [
  "BUY_TO_OPEN",
  "SELL_TO_OPEN",
  "BUY_TO_CLOSE",
  "SELL_TO_CLOSE",
] as const;

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

export function validateOrderType(orderType: string): SchwabOrderType {
  const upper = orderType.toUpperCase() as SchwabOrderType;
  if (!ALL_SCHWAB_ORDER_TYPES.includes(upper)) {
    throw new Error(
      `Invalid order type "${orderType}". Valid options: ${ALL_SCHWAB_ORDER_TYPES.join(", ")}`
    );
  }
  return upper;
}

export function validateQuantity(quantity: string): number {
  const num = parseInt(quantity, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid quantity "${quantity}". Must be a positive integer.`);
  }
  return num;
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
