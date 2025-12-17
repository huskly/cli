import chalk from "chalk";
import { api } from "./shared.js";
import {
  ALL_SCHWAB_INSTRUCTIONS,
  ALL_SCHWAB_ORDER_TYPES,
  type SchwabInstruction,
  type SchwabOrderRequest,
  type SchwabOrderType,
} from "#src/types.js";
import { ensureFloat } from "#src/helpers.js";

interface PlaceOrderOptions {
  type: string;
  price?: string;
  session?: string;
  duration?: string;
}

function validateInstruction(instruction: string): SchwabInstruction {
  const upper = instruction.toUpperCase() as SchwabInstruction;
  if (!ALL_SCHWAB_INSTRUCTIONS.includes(upper)) {
    throw new Error(
      `Invalid instruction "${instruction}". Valid options: ${ALL_SCHWAB_INSTRUCTIONS.join(", ")}`
    );
  }
  return upper;
}

function validateOrderType(orderType: string): SchwabOrderType {
  const upper = orderType.toUpperCase() as SchwabOrderType;
  if (!ALL_SCHWAB_ORDER_TYPES.includes(upper)) {
    throw new Error(
      `Invalid order type "${orderType}". Valid options: ${ALL_SCHWAB_ORDER_TYPES.join(", ")}`
    );
  }
  return upper;
}

function validateQuantity(quantity: string): number {
  const num = parseInt(quantity, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid quantity "${quantity}". Must be a positive integer.`);
  }
  return num;
}

function validatePrice(price: string | undefined, orderType: SchwabOrderType): number | undefined {
  if (orderType === "LIMIT") {
    return ensureFloat(price, "Price is required for LIMIT orders. Use --price <price>.");
  }
  if (orderType === "STOP") {
    return ensureFloat(price, "Price is required for STOP orders. Use --price <price>.");
  }
  return undefined;
}

export async function handlePlaceOrder(
  symbol: string,
  quantity: string,
  instruction: string,
  options: PlaceOrderOptions
): Promise<void> {
  const validatedInstruction = validateInstruction(instruction);
  const validatedOrderType = validateOrderType(options.type);
  const validatedQuantity = validateQuantity(quantity);
  const validatedPrice = validatePrice(options.price, validatedOrderType);
  const orderRequest: SchwabOrderRequest = {
    session: (options.session?.toUpperCase() ?? "NORMAL") as SchwabOrderRequest["session"],
    duration: (options.duration?.toUpperCase() ?? "DAY") as SchwabOrderRequest["duration"],
    orderType: validatedOrderType,
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: validatedInstruction,
        quantity: validatedQuantity,
        instrument: { assetType: "EQUITY", symbol: symbol.toUpperCase() },
      },
    ],
  };

  if (orderRequest.orderType === "LIMIT") {
    // validatePrice already ensures price is defined for LIMIT orders
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    orderRequest.price = validatedPrice!;
  }
  if (orderRequest.orderType === "STOP") {
    // validatePrice already ensures price is defined for STOP orders
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    orderRequest.stopPrice = validatedPrice!;
  }

  // Get the first account (most users have one account)
  const accounts = await api.fetchAccountNumbers();
  const account = accounts[0];
  if (!account) {
    throw new Error("No Schwab accounts found.");
  }
  const accountHash = account.hashValue;

  // Display order preview
  console.log(chalk.bold("\n📝 Order Preview\n"));
  console.log(chalk.gray("─".repeat(40)));
  console.log(`  ${chalk.gray("Account:")}     ${account.accountNumber}`);
  console.log(`  ${chalk.gray("Symbol:")}      ${chalk.cyan(symbol.toUpperCase())}`);
  console.log(`  ${chalk.gray("Instruction:")} ${chalk.white(validatedInstruction)}`);
  console.log(`  ${chalk.gray("Quantity:")}    ${chalk.white(String(validatedQuantity))}`);
  console.log(`  ${chalk.gray("Order Type:")} ${chalk.white(validatedOrderType)}`);
  if (validatedPrice !== undefined) {
    console.log(`  ${chalk.gray("Price:")}       ${chalk.yellow(`$${validatedPrice.toFixed(2)}`)}`);
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
