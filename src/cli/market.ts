#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { handleQuote } from "./market/quote.js";
import { handleHistory } from "./market/history.js";
import { handleChart } from "./market/chart.js";
import { handleVix } from "./market/vix.js";
import { handleExpiries } from "./market/expiries.js";
import { handleChain } from "./market/chain.js";
import { handleAccount } from "./market/account.js";
import { handlePositions } from "./market/positions.js";
import { handleTransactions } from "./market/transactions.js";
import { handleOrders } from "./market/orders.js";
import { handlePlaceOrder } from "./market/placeOrder.js";
import { handleRepl } from "./market/repl.js";
import { disconnectCache } from "#src/cache.js";

const program = new Command();

program
  .name("huskly-cli-market")
  .description("Explore market data from Schwab API")
  .version("1.0.0");

program
  .command("quote")
  .description("Get current price quotes for one or more symbols")
  .argument("<symbols...>", "Stock symbols to quote")
  .action(async (symbols: string[]) => {
    await handleQuote(symbols);
  });

program
  .command("history")
  .description("Get price history for a symbol")
  .argument("<symbol>", "Stock symbol")
  .option("-d, --days <n>", "Number of days of history", "10")
  .action(async (symbol: string, options: { days: string }) => {
    await handleHistory(symbol, parseInt(options.days));
  });

program
  .command("chart")
  .description("Display ASCII price chart for a symbol")
  .argument("<symbol>", "Stock symbol")
  .option("-d, --days <n>", "Number of days of history", "30")
  .option("-h, --height <n>", "Chart height in rows", "15")
  .option("-i, --image", "Generate image chart and open in browser")
  .action(async (symbol: string, options: { days: string; height: string; image?: boolean }) => {
    await handleChart(symbol, parseInt(options.days), parseInt(options.height), options.image);
  });

program
  .command("vix")
  .description("Get current VIX level with sentiment indicator")
  .action(async () => {
    await handleVix();
  });

program
  .command("expiries")
  .description("List available option expiration dates")
  .argument("<symbol>", "Stock symbol")
  .option("-t, --type <type>", "Contract type (PUT or CALL)", "PUT")
  .option("-f, --from <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --to <date>", "End date (YYYY-MM-DD)")
  .action(async (symbol: string, options: { type: string; from?: string; to?: string }) => {
    await handleExpiries(symbol, options);
  });

program
  .command("chain")
  .description("Get option chain for a symbol and expiry")
  .argument("<symbol>", "Stock symbol")
  .argument("[expiry]", "Expiration date (YYYY-MM-DD)")
  .option("-a, --around <strike>", "Filter strikes around this price, defaults to the last price")
  .option("-s, --strikes <count>", "Number of strikes to show above/below center", "10")
  .action(
    async (
      symbol: string,
      expiry: string | undefined,
      options: { around?: string; strikes: string }
    ) => {
      await handleChain(symbol, expiry, options);
    }
  );

program
  .command("account")
  .description("Show account equity/net liquidation value")
  .action(async () => {
    await handleAccount();
  });

program
  .command("positions")
  .description("Show all account positions, optionally filtered by symbol")
  .argument("[symbol]", "Optional symbol to filter positions", undefined)
  .action(async (symbol?: string) => {
    await handlePositions(symbol);
  });

program
  .command("transactions")
  .description("List account transaction history (defaults to current year)")
  .option("-s, --start <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end <date>", "End date (YYYY-MM-DD)")
  .action(async (options: { start?: string; end?: string }) => {
    await handleTransactions(options);
  });

program
  .command("orders")
  .description("List account orders (defaults to last 30 days)")
  .option("-f, --from <date>", "From entered time (YYYY-MM-DD)")
  .option("-t, --to <date>", "To entered time (YYYY-MM-DD)")
  .option("-s, --status <status>", "Filter by order status (FILLED, WORKING, CANCELED, etc.)")
  .option("-m, --max-results <n>", "Maximum number of orders to retrieve")
  .action(async (options: { from?: string; to?: string; status?: string; maxResults?: string }) => {
    await handleOrders(options as Parameters<typeof handleOrders>[0]);
  });

program
  .command("place-order")
  .description("Place a simple MARKET or LIMIT order for equities")
  .argument("<symbol>", "Stock symbol to trade")
  .argument("<quantity>", "Number of shares")
  .argument("<instruction>", "Order instruction: BUY, SELL, BUY_TO_COVER, SELL_SHORT")
  .option("-t, --type <type>", "Order type: MARKET or LIMIT", "MARKET")
  .option("-p, --price <price>", "Limit price (required for LIMIT orders)")
  .option("-s, --session <session>", "Trading session: NORMAL, AM, PM, SEAMLESS", "NORMAL")
  .option("-d, --duration <duration>", "Order duration: DAY, GOOD_TILL_CANCEL, etc.", "DAY")
  .action(
    async (
      symbol: string,
      quantity: string,
      instruction: string,
      options: { type: string; price?: string; session?: string; duration?: string }
    ) => {
      await handlePlaceOrder(symbol, quantity, instruction, options);
    }
  );

program
  .command("repl")
  .description("Start an interactive REPL to run multiple commands")
  .action(() => {
    handleRepl();
  });

program
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectCache();
  });
