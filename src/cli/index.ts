#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { handleQuote } from "./quote.js";
import { handleHistory } from "./history.js";
import { handleChart } from "./chart.js";
import { handleVix } from "./vix.js";
import { handleExpiries } from "./expiries.js";
import { handleChain } from "./chain.js";
import { handleAccount } from "./account.js";
import { handlePositions } from "./positions.js";
import { handleTransactions } from "./transactions.js";
import { handleOrders } from "./orders.js";
import { handlePlaceOrder } from "./placeOrder.js";
import { handleRepl } from "./repl.js";
import { handleUserPreference } from "./userPreference.js";
import { handleSearch } from "./search.js";
import { handleMovers } from "./movers.js";
import { disconnectCache } from "#src/cache.js";
import { resolveBroker, requireSchwab } from "./shared.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";

const program = new Command();

program
  .name("huskly-cli")
  .description("Terminal-based trading tools for Schwab (huskly auth) and IBKR (native OAuth)")
  .version("1.0.0")
  .option("--broker <name>", "Broker to use: schwab or ibkr", "schwab");

/** The broker selected via the global --broker flag (defaults to schwab). */
function broker(): BrokerName {
  return resolveBroker(program.opts<{ broker?: string }>().broker);
}

/** Resolve the broker and assert the command is Schwab-only. */
function guardSchwab(command: string): void {
  requireSchwab(broker(), command);
}

// Auth subcommand
const authCmd = new Command("auth")
  .description("Manage authentication with huskly.finance")
  .action(() => {
    authCmd.outputHelp();
  });

authCmd
  .command("login")
  .description("Authenticate with huskly.finance")
  .action(async () => {
    const { HusklyDeviceAuth } = await import("../auth/husklyDeviceAuth.js");
    const auth = new HusklyDeviceAuth();
    await auth.login();
  });

authCmd
  .command("logout")
  .description("Clear stored credentials")
  .action(async () => {
    const { HusklyDeviceAuth } = await import("../auth/husklyDeviceAuth.js");
    const auth = new HusklyDeviceAuth();
    await auth.logout();
  });

authCmd
  .command("status")
  .description("Check authentication status")
  .action(async () => {
    const { HusklyDeviceAuth } = await import("../auth/husklyDeviceAuth.js");
    const auth = new HusklyDeviceAuth();
    await auth.status();
  });

program.addCommand(authCmd);

// Market commands (now top-level)
program
  .command("quote")
  .description("Get current price quotes for one or more symbols")
  .argument("<symbols...>", "Stock symbols to quote")
  .action(async (symbols: string[]) => {
    await handleQuote(broker(), symbols);
  });

program
  .command("search")
  .description("Search for instruments by symbol or description")
  .argument("<symbol>", "Search term (symbol or description fragment)")
  .option(
    "-p, --projection <type>",
    "Search type: symbol-search, symbol-regex, desc-search, desc-regex, search, fundamental",
    "symbol-search"
  )
  .action(async (symbol: string, options: { projection: string }) => {
    await handleSearch(broker(), symbol, options);
  });

program
  .command("movers")
  .description("Get top 10 movers for a specific index")
  .argument(
    "<index>",
    "Index symbol: $DJI, $COMPX, $SPX, NYSE, NASDAQ, OTCBB, INDEX_ALL, EQUITY_ALL, OPTION_ALL, OPTION_PUT, OPTION_CALL"
  )
  .option("-s, --sort <type>", "Sort by: VOLUME, TRADES, PERCENT_CHANGE_UP, PERCENT_CHANGE_DOWN")
  .option("-f, --frequency <minutes>", "Frequency in minutes: 0, 1, 5, 10, 30, 60 (default: 0)")
  .action(async (index: string, options: { sort?: string; frequency?: string }) => {
    guardSchwab("movers");
    await handleMovers(index, options);
  });

program
  .command("history")
  .description("Get price history for a symbol")
  .argument("<symbol>", "Stock symbol")
  .option("-d, --days <n>", "Number of days of history", "10")
  .action(async (symbol: string, options: { days: string }) => {
    guardSchwab("history");
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
    guardSchwab("chart");
    await handleChart(symbol, parseInt(options.days), parseInt(options.height), options.image);
  });

program
  .command("vix")
  .description("Get current VIX level with sentiment indicator")
  .action(async () => {
    guardSchwab("vix");
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
    guardSchwab("expiries");
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
      guardSchwab("chain");
      await handleChain(symbol, expiry, options);
    }
  );

program
  .command("account")
  .description("Show account equity/net liquidation value")
  .action(async () => {
    await handleAccount(broker());
  });

program
  .command("user-preference")
  .description("Show user preferences, streamer info, and account settings")
  .action(async () => {
    guardSchwab("user-preference");
    await handleUserPreference();
  });

program
  .command("positions")
  .description("Show all account positions, optionally filtered by symbol or type")
  .argument("[symbol]", "Optional symbol to filter positions", undefined)
  .option("-t, --type <type>", "Filter by asset type (e.g., OPTION, EQUITY)")
  .option("--csv", "Output in CSV format instead of table")
  .action(async (symbol: string | undefined, options: { type?: string; csv?: boolean }) => {
    await handlePositions(broker(), symbol, options.type, options.csv);
  });

program
  .command("transactions")
  .description("List account transaction history (defaults to current year)")
  .option("-s, --start <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end <date>", "End date (YYYY-MM-DD)")
  .option("-t, --type <type>", "Filter by transaction type (e.g., TRADE, DIVIDEND)")
  .option("--csv", "Output in CSV format instead of table")
  .action(async (options: { start?: string; end?: string; type?: string; csv?: boolean }) => {
    await handleTransactions(broker(), options);
  });

program
  .command("orders")
  .description("List account orders (defaults to last 30 days)")
  .option("-f, --from <date>", "From entered time (YYYY-MM-DD)")
  .option("-t, --to <date>", "To entered time (YYYY-MM-DD)")
  .option("-s, --status <status>", "Filter by order status (FILLED, WORKING, CANCELED, etc.)")
  .option("-m, --max-results <n>", "Maximum number of orders to retrieve")
  .action(async (options: { from?: string; to?: string; status?: string; maxResults?: string }) => {
    await handleOrders(broker(), options);
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
      guardSchwab("place-order");
      await handlePlaceOrder(symbol, quantity, instruction, options);
    }
  );

program
  .command("repl")
  .description("Start an interactive REPL to run multiple commands")
  .action(async () => {
    await handleRepl(broker());
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
