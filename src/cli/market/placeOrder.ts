import chalk from "chalk";
import { api } from "./shared.js";
import type {
  SchwabInstruction,
  SchwabOrderRequest,
  SimpleOrderType,
} from "#src/types.js";

interface PlaceOrderOptions {
  type: string;
  price?: string;
  session?: string;
  duration?: string;
}

const VALID_INSTRUCTIONS: SchwabInstruction[] = [
  "BUY",
  "SELL",
  "BUY_TO_COVER",
  "SELL_SHORT",
];

const VALID_ORDER_TYPES: SimpleOrderType[] = ["MARKET", "LIMIT"];

function validateInstruction(instruction: string): SchwabInstruction {
  const upper = instruction.toUpperCase() as SchwabInstruction;
  if (!VALID_INSTRUCTIONS.includes(upper)) {
    throw new Error(
      `Invalid instruction "${instruction}". Valid options: ${VALID_INSTRUCTIONS.join(", ")}`
    );
  }
  return upper;
}

function validateOrderType(orderType: string): SimpleOrderType {
  const upper = orderType.toUpperCase() as SimpleOrderType;
  if (!VALID_ORDER_TYPES.includes(upper)) {
    throw new Error(
      `Invalid order type "${orderType}". Valid options: ${VALID_ORDER_TYPES.join(", ")}`
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

function validatePrice(price: string | undefined, orderType: SimpleOrderType): number | undefined {
  if (orderType === "LIMIT") {
    if (!price) {
      throw new Error("Price is required for LIMIT orders. Use --price <price>.");
    }
    const num = parseFloat(price);
    if (isNaN(num) || num <= 0) {
      throw new Error(`Invalid price "${price}". Must be a positive number.`);
    }
    return num;
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

  // Build the order request
  const orderRequest: SchwabOrderRequest = {
    session: (options.session?.toUpperCase() ?? "NORMAL") as SchwabOrderRequest["session"],
    duration: (options.duration?.toUpperCase() ?? "DAY") as SchwabOrderRequest["duration"],
    orderType: validatedOrderType,
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: validatedInstruction,
        quantity: validatedQuantity,
        instrument: {
          assetType: "EQUITY",
          symbol: symbol.toUpperCase(),
        },
      },
    ],
  };

  // Add price for LIMIT orders
  if (validatedPrice !== undefined) {
    orderRequest.price = validatedPrice;
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
