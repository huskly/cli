import chalk from "chalk";
import { parse } from "date-fns";
import { apiClient } from "./shared.js";
import type { SchwabDuration, SchwabSession } from "@huskly/schwab-client";
import { buildOccOptionSymbol } from "#src/helpers.js";
import { buildOptionOrderRequest } from "#src/orders/buildOptionOrderRequest.js";
import {
  OPTION_INSTRUCTIONS,
  validateInstruction,
  validateOrderType,
  validatePrice,
  validateQuantity,
} from "#src/orders/orderValidation.js";

interface PlaceOptionOrderOptions {
  type: string;
  price?: string;
  session?: string;
  duration?: string;
}

function validatePutCall(value: string): "CALL" | "PUT" {
  const upper = value.toUpperCase();
  if (upper !== "CALL" && upper !== "PUT") {
    throw new Error(`Invalid option type "${value}". Must be CALL or PUT.`);
  }
  return upper;
}

function validateStrike(value: string): number {
  const strike = Number(value);
  if (!Number.isFinite(strike) || strike <= 0) {
    throw new Error(`Invalid strike "${value}". Must be a positive number.`);
  }
  return strike;
}

function validateExpiry(value: string): Date {
  const expiry = parse(value, "yyyy-MM-dd", new Date());
  if (Number.isNaN(expiry.getTime())) {
    throw new Error(`Invalid expiry "${value}". Use YYYY-MM-DD format.`);
  }
  return expiry;
}

export async function handlePlaceOptionOrder(
  symbol: string,
  expiryArg: string,
  strikeArg: string,
  putCallArg: string,
  quantityArg: string,
  instructionArg: string,
  options: PlaceOptionOrderOptions
): Promise<void> {
  const putCall = validatePutCall(putCallArg);
  const strike = validateStrike(strikeArg);
  const expiry = validateExpiry(expiryArg);
  const validatedInstruction = validateInstruction(instructionArg, OPTION_INSTRUCTIONS);
  const validatedOrderType = validateOrderType(options.type);
  const validatedQuantity = validateQuantity(quantityArg);
  const validatedPrice = validatePrice(options.price, validatedOrderType);
  const occSymbol = buildOccOptionSymbol(symbol, expiry, putCall, strike);

  const orderRequest = buildOptionOrderRequest({
    occSymbol,
    instruction: validatedInstruction,
    quantity: validatedQuantity,
    orderType: validatedOrderType,
    price: validatedPrice,
    session: (options.session?.toUpperCase() ?? "NORMAL") as SchwabSession,
    duration: (options.duration?.toUpperCase() ?? "DAY") as SchwabDuration,
  });

  // Get the first account (most users have one account)
  const api = await apiClient();
  const accounts = await api.fetchAccountNumbers();
  const account = accounts[0];
  if (!account) {
    throw new Error("No Schwab accounts found.");
  }
  const accountHash = account.hashValue;

  // Display order preview
  console.log(chalk.bold("\n📝 Option Order Preview\n"));
  console.log(chalk.gray("─".repeat(40)));
  console.log(`  ${chalk.gray("Account:")}     ${account.accountNumber}`);
  console.log(`  ${chalk.gray("Contract:")}    ${chalk.cyan(occSymbol)}`);
  console.log(
    `  ${chalk.gray("Underlying:")}  ${chalk.cyan(symbol.toUpperCase())} ${putCall} $${strike.toFixed(2)} exp ${expiryArg}`
  );
  console.log(`  ${chalk.gray("Instruction:")} ${chalk.white(validatedInstruction)}`);
  console.log(
    `  ${chalk.gray("Quantity:")}    ${chalk.white(String(validatedQuantity))} contract(s)`
  );
  console.log(`  ${chalk.gray("Order Type:")} ${chalk.white(validatedOrderType)}`);
  if (validatedPrice !== undefined) {
    console.log(`  ${chalk.gray("Price:")}       ${chalk.yellow(`$${validatedPrice.toFixed(2)}`)}`);
    const total = validatedPrice * validatedQuantity * 100;
    const label = validatedInstruction.startsWith("SELL") ? "Est. credit:" : "Est. debit:";
    console.log(`  ${chalk.gray(label)}  ${chalk.yellow(`$${total.toFixed(2)}`)}`);
  }
  console.log(`  ${chalk.gray("Session:")}     ${chalk.white(orderRequest.session)}`);
  console.log(`  ${chalk.gray("Duration:")}    ${chalk.white(orderRequest.duration)}`);
  console.log(chalk.gray("─".repeat(40)));
  console.log();

  // Place the order
  console.log(chalk.gray("Placing order..."));
  const result = await api.placeOrder(accountHash, orderRequest);

  console.log(chalk.green(`\n✓ Order placed successfully!`));
  console.log(`  ${chalk.gray("Order ID:")} ${chalk.cyan(result.orderId)}`);
  console.log();
}
