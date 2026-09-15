import chalk from "chalk";
import { parse } from "date-fns";
import { apiClient, requireOperator } from "./shared.js";
import type {
  SchwabDuration,
  SchwabInstruction,
  SchwabOrderType,
  SchwabSession,
} from "@huskly/schwab-client";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import { buildOccOptionSymbol } from "#src/helpers.js";
import { buildOptionOrderRequest } from "#src/orders/buildOptionOrderRequest.js";
import {
  OPTION_INSTRUCTIONS,
  validateInstruction,
  validateOrderType,
  validatePrice,
  validateQuantity,
} from "#src/orders/orderValidation.js";
import {
  handleGatewayOptionOrder,
  type GatewayOptionOrderDependencies,
} from "./gatewayOptionOrder.js";

export interface PlaceOptionOrderOptions {
  type: string;
  price?: string;
  session?: string;
  duration?: string;
  /** Gateway-only: exact confirmation of a real IBKR submission. */
  confirm?: boolean;
  /** Gateway-only: CME operator identity; defaults to HUSKLY_EXT_OPERATOR. */
  operator?: string;
  /** Gateway-only: exact broker trading class. */
  class?: string;
  /** Gateway-only: exact listing/routing exchange. */
  exchange?: string;
  /** Gateway-only: recover the order with this exact reference. */
  recover?: string;
  /** Gateway-only: emit a stable JSON DTO. */
  json?: boolean;
}

function validatePutCall(value: string): "CALL" | "PUT" {
  const upper = value.toUpperCase();
  if (upper === "CALL" || upper === "C") return "CALL";
  if (upper === "PUT" || upper === "P") return "PUT";
  throw new Error(`Invalid option type "${value}". Must be CALL or PUT.`);
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

async function placeSchwabOptionOrder(
  symbol: string,
  expiry: Date,
  expiryArg: string,
  strike: number,
  putCall: "CALL" | "PUT",
  quantity: number,
  instruction: SchwabInstruction,
  orderType: SchwabOrderType,
  price: number | undefined,
  options: PlaceOptionOrderOptions
): Promise<void> {
  const occSymbol = buildOccOptionSymbol(symbol, expiry, putCall, strike);

  const orderRequest = buildOptionOrderRequest({
    occSymbol,
    instruction,
    quantity,
    orderType,
    price,
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
  console.log(`  ${chalk.gray("Instruction:")} ${chalk.white(instruction)}`);
  console.log(`  ${chalk.gray("Quantity:")}    ${chalk.white(String(quantity))} contract(s)`);
  console.log(`  ${chalk.gray("Order Type:")} ${chalk.white(orderType)}`);
  if (price !== undefined) {
    console.log(`  ${chalk.gray("Price:")}       ${chalk.yellow(`$${price.toFixed(2)}`)}`);
    const total = price * quantity * 100;
    const label = instruction.startsWith("SELL") ? "Est. credit:" : "Est. debit:";
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

const IBKR_SESSIONS: Readonly<Record<string, "REGULAR" | "OVERNIGHT">> = {
  NORMAL: "REGULAR",
  REGULAR: "REGULAR",
  OVERNIGHT: "OVERNIGHT",
};

const IBKR_DURATIONS: Readonly<Record<string, "DAY" | "GTC">> = {
  DAY: "DAY",
  GTC: "GTC",
  GOOD_TILL_CANCEL: "GTC",
};

/** Map the Schwab-shaped session flag onto the gateway session. */
function gatewaySession(value: string | undefined): "REGULAR" | "OVERNIGHT" {
  const session = IBKR_SESSIONS[(value ?? "NORMAL").toUpperCase()];
  if (session === undefined) {
    throw new Error(
      `Invalid session "${String(value)}" for --broker ibkr. Valid options: NORMAL, REGULAR, OVERNIGHT.`
    );
  }
  return session;
}

/** Map the Schwab-shaped duration flag onto the gateway time in force. */
function gatewayTif(value: string | undefined): "DAY" | "GTC" {
  const tif = IBKR_DURATIONS[(value ?? "DAY").toUpperCase()];
  if (tif === undefined) {
    throw new Error(
      `Invalid duration "${String(value)}" for --broker ibkr. Valid options: DAY, GOOD_TILL_CANCEL.`
    );
  }
  return tif;
}

async function placeGatewayOptionOrder(
  broker: BrokerName,
  symbol: string,
  expiryArg: string,
  strike: number,
  putCall: "CALL" | "PUT",
  quantity: number,
  instruction: string,
  price: number | undefined,
  options: PlaceOptionOrderOptions,
  dependencies: GatewayOptionOrderDependencies
): Promise<void> {
  if (price === undefined) {
    throw new Error("The IBKR gateway only places LIMIT option orders. Use --type LIMIT --price.");
  }
  await handleGatewayOptionOrder(
    broker,
    {
      underlying: symbol.toUpperCase(),
      expiration: expiryArg,
      strike,
      right: putCall,
      side: instruction.startsWith("SELL") ? "SELL" : "BUY",
      quantity,
      limit: price,
      tif: gatewayTif(options.duration),
      session: gatewaySession(options.session),
      ...(options.class === undefined ? {} : { tradingClass: options.class.toUpperCase() }),
      ...(options.exchange === undefined ? {} : { exchange: options.exchange.toUpperCase() }),
      operator: requireOperator(options.operator),
      confirm: options.confirm === true,
    },
    options,
    dependencies
  );
}

/**
 * Place one single-leg option order on the selected broker.
 *
 * @remarks
 * Schwab places the order directly from an OCC symbol. IBKR routes through the
 * guarded gateway mutation boundary, which resolves the exact contract and
 * requires `--confirm` plus an operator identity. Both brokers share the same
 * arguments, validation, and instruction vocabulary.
 */
export async function handlePlaceOptionOrder(
  broker: BrokerName,
  symbol: string,
  expiryArg: string,
  strikeArg: string,
  putCallArg: string,
  quantityArg: string,
  instructionArg: string,
  options: PlaceOptionOrderOptions,
  dependencies: GatewayOptionOrderDependencies = {}
): Promise<void> {
  const putCall = validatePutCall(putCallArg);
  const strike = validateStrike(strikeArg);
  const expiry = validateExpiry(expiryArg);
  const instruction = validateInstruction(instructionArg, OPTION_INSTRUCTIONS);
  const orderType = validateOrderType(options.type);
  const quantity = validateQuantity(quantityArg);
  const price = validatePrice(options.price, orderType);
  if (broker === "ibkr") {
    await placeGatewayOptionOrder(
      broker,
      symbol,
      expiryArg,
      strike,
      putCall,
      quantity,
      instruction,
      price,
      options,
      dependencies
    );
    return;
  }
  await placeSchwabOptionOrder(
    symbol,
    expiry,
    expiryArg,
    strike,
    putCall,
    quantity,
    instruction,
    orderType,
    price,
    options
  );
}
