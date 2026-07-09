import chalk from "chalk";
import { apiClient } from "./shared.js";
import {
  ALL_SCHWAB_INSTRUCTIONS,
  type SchwabInstruction,
  type SchwabOrderRequest,
} from "@huskly/schwab-client";
import {
  validateInstruction as validateInstructionAgainst,
  validateOrderType,
  validatePrice,
  validateQuantity,
} from "#src/orders/orderValidation.js";

interface PlaceOrderOptions {
  type: string;
  price?: string;
  session?: string;
  duration?: string;
}

function validateInstruction(instruction: string): SchwabInstruction {
  return validateInstructionAgainst(instruction, ALL_SCHWAB_INSTRUCTIONS);
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
  const api = await apiClient();
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
