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
import { handlePlaceOptionOrder } from "./placeOptionOrder.js";
import { handleCancelOrder } from "./cancelOrder.js";
import { handleRepl } from "./repl.js";
import { handleUserPreference } from "./userPreference.js";
import { handleSearch } from "./search.js";
import { handleMovers } from "./movers.js";
import { disconnectCache, RedisUnavailableError, setCacheEnabled } from "#src/cache.js";
import { chooseBroker, requireSchwab } from "./shared.js";
import { packageVersion } from "./packageVersion.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import { addDerivativeCommands } from "./derivatives.js";

const program = new Command();

program
  .name("huskly-cli")
  .description("Terminal-based trading tools for Schwab (huskly auth) and IBKR (gateway)")
  .version(packageVersion())
  .option("--broker <name>", "Broker to use: schwab or ibkr (default: schwab)")
  .option("--no-cache", "Bypass the Schwab Redis read-cache and query the broker directly")
  .hook("preAction", () => {
    setCacheEnabled(program.opts<{ cache: boolean }>().cache);
  });

/**
 * Resolve the broker for one command.
 *
 * @remarks
 * The global flag carries no Commander default, so an unset value stays
 * `undefined` and each command can apply its own fallback. This keeps a single
 * decision point instead of competing defaults on every subcommand.
 */
function broker(override?: string, fallback: BrokerName = "schwab"): BrokerName {
  return chooseBroker(override, program.opts<{ broker?: string }>().broker, fallback);
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

authCmd
  .command("ibkr")
  .description("Provision admin-authorized IBKR gateway credentials")
  .option("--replace", "Rotate and replace existing CLI and MCP credentials")
  .action(async (options: { replace?: boolean }) => {
    const { runIbkrAuthCommand } = await import("../auth/ibkrAuthCommand.js");
    await runIbkrAuthCommand({ replace: options.replace === true });
  });

program.addCommand(authCmd);

// Market commands (now top-level)
program
  .command("quote")
  .description("Get current price quotes for one or more equity or option symbols")
  .argument("<symbols...>", "Equity tickers, or OSI option symbols under Schwab")
  .option("--json", "Emit a stable JSON DTO")
  .addHelpText(
    "after",
    `
Option symbols (Schwab only) use the 21-character OSI format:
  <root padded to 6><YYMMDD><C|P><strike x 1000 padded to 8>

Examples:
  $ huskly-cli quote AAPL
  $ huskly-cli quote SPY QQQ NVDA
  $ huskly-cli quote --json AAPL
  $ huskly-cli --broker ibkr quote AAPL
  $ huskly-cli quote "AAPL  271217C00250000"    # AAPL 2027-12-17 250 call
  $ huskly-cli quote "SPY   271217P00600000"    # SPY 2027-12-17 600 put

Quote the space-padded OSI symbol so the shell keeps it as one argument.
An expired or unlisted contract returns "No quote data available"; use
"expiries" and "chain" to find a live contract symbol.
Under --broker ibkr, quote accepts equity symbols only; use "option chain"
to quote IBKR option series.`
  )
  .action(async (symbols: string[], options: { json?: boolean }) => {
    await handleQuote(broker(), symbols, options.json);
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
  .option("--json", "Emit a stable JSON DTO")
  .action(async (symbol: string, options: { projection: string; json?: boolean }) => {
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
  .option("--json", "Emit a stable JSON DTO")
  .action(async (index: string, options: { sort?: string; frequency?: string; json?: boolean }) => {
    guardSchwab("movers");
    await handleMovers(index, options);
  });

program
  .command("history")
  .description("Get price history for a symbol")
  .argument("<symbol>", "Stock symbol")
  .option("-d, --days <n>", "Number of days of history", "10")
  .option("--json", "Emit a stable JSON DTO")
  .action(async (symbol: string, options: { days: string; json?: boolean }) => {
    guardSchwab("history");
    await handleHistory(symbol, parseInt(options.days), options.json);
  });

program
  .command("chart")
  .description("Display ASCII price chart for a symbol")
  .argument("<symbol>", "Stock symbol")
  .option("-d, --days <n>", "Number of days of history", "30")
  .option("-h, --height <n>", "Chart height in rows", "15")
  .option("-i, --image", "Generate image chart and open in browser")
  .option("--json", "Emit a stable JSON DTO")
  .action(
    async (
      symbol: string,
      options: { days: string; height: string; image?: boolean; json?: boolean }
    ) => {
      guardSchwab("chart");
      await handleChart(
        symbol,
        parseInt(options.days),
        parseInt(options.height),
        options.image,
        options.json
      );
    }
  );

program
  .command("vix")
  .description("Get current VIX level with sentiment indicator")
  .option("--json", "Emit a stable JSON DTO")
  .action(async (options: { json?: boolean }) => {
    guardSchwab("vix");
    await handleVix(options.json);
  });

program
  .command("expiries")
  .description("List available option expiration dates")
  .argument("<symbol>", "Stock symbol")
  .option("-t, --type <type>", "Contract type (PUT or CALL)", "PUT")
  .option("-f, --from <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --to <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Emit a stable JSON DTO")
  .action(
    async (
      symbol: string,
      options: { type: string; from?: string; to?: string; json?: boolean }
    ) => {
      guardSchwab("expiries");
      await handleExpiries(symbol, options);
    }
  );

program
  .command("chain")
  .description("Get option chain for a symbol and expiry")
  .argument("<symbol>", "Stock symbol")
  .argument("[expiry]", "Expiration date (YYYY-MM-DD)")
  .option("-a, --around <strike>", "Filter strikes around this price, defaults to the last price")
  .option("-s, --strikes <count>", "Number of strikes to show above/below center", "10")
  .option("--json", "Emit a stable JSON DTO")
  .action(
    async (
      symbol: string,
      expiry: string | undefined,
      options: { around?: string; strikes: string; json?: boolean }
    ) => {
      guardSchwab("chain");
      await handleChain(symbol, expiry, options);
    }
  );

addDerivativeCommands(program, broker);

program
  .command("account")
  .description("Show account equity/net liquidation value")
  .option("--json", "Emit a stable JSON DTO")
  .action(async (options: { json?: boolean }) => {
    await handleAccount(broker(), options.json);
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
  .option("--json", "Emit a stable JSON DTO")
  .action(
    async (
      symbol: string | undefined,
      options: { type?: string; csv?: boolean; json?: boolean }
    ) => {
      await handlePositions(broker(), symbol, options.type, options.csv, options.json);
    }
  );

program
  .command("transactions")
  .description("List account transaction history (defaults to current year)")
  .option("-s, --start <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end <date>", "End date (YYYY-MM-DD)")
  .option("-t, --type <type>", "Filter by transaction type (e.g., TRADE, DIVIDEND)")
  .option("--csv", "Output in CSV format instead of table")
  .option("--json", "Emit a stable JSON DTO")
  .action(
    async (options: {
      start?: string;
      end?: string;
      type?: string;
      csv?: boolean;
      json?: boolean;
    }) => {
      await handleTransactions(broker(), options);
    }
  );

program
  .command("orders")
  .description("List account orders (defaults to last 30 days)")
  .option("-f, --from <date>", "From entered time (YYYY-MM-DD)")
  .option("-t, --to <date>", "To entered time (YYYY-MM-DD)")
  .option("-s, --status <status>", "Filter by order status (FILLED, WORKING, CANCELED, etc.)")
  .option("-m, --max-results <n>", "Maximum number of orders to retrieve")
  .option("--json", "Emit a stable JSON DTO")
  .action(
    async (options: {
      from?: string;
      to?: string;
      status?: string;
      maxResults?: string;
      json?: boolean;
    }) => {
      await handleOrders(broker(), options);
    }
  );

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
  .command("place-option-order")
  .description("Place a single-leg MARKET or LIMIT order for an option contract")
  .argument("<symbol>", "Underlying stock symbol")
  .argument("<expiry>", "Expiration date (YYYY-MM-DD)")
  .argument("<strike>", "Strike price")
  .argument("<putCall>", "Option type: CALL or PUT")
  .argument("<quantity>", "Number of contracts")
  .argument(
    "<instruction>",
    "Order instruction: BUY_TO_OPEN, SELL_TO_OPEN, BUY_TO_CLOSE, SELL_TO_CLOSE"
  )
  .option("-t, --type <type>", "Order type: MARKET or LIMIT", "LIMIT")
  .option("-p, --price <price>", "Limit price per contract (required for LIMIT orders)")
  .option("-s, --session <session>", "Trading session: NORMAL, AM, PM, SEAMLESS", "NORMAL")
  .option("-d, --duration <duration>", "Order duration: DAY, GOOD_TILL_CANCEL, etc.", "DAY")
  .action(
    async (
      symbol: string,
      expiry: string,
      strike: string,
      putCall: string,
      quantity: string,
      instruction: string,
      options: { type: string; price?: string; session?: string; duration?: string }
    ) => {
      guardSchwab("place-option-order");
      await handlePlaceOptionOrder(symbol, expiry, strike, putCall, quantity, instruction, options);
    }
  );

program
  .command("cancel-order")
  .description("Cancel a working equity or option order")
  .argument("<orderId>", "Schwab order ID, as shown by the 'orders' command")
  .option("--confirm", "Confirm this cancellation")
  .option("--json", "Emit a stable JSON DTO")
  .addHelpText(
    "after",
    `
Schwab cancels asynchronously. The order can still fill before the cancel
takes effect, so this command re-reads the order and reports the status it
actually observed. Schwab has no replace operation; cancel, then place a
new order.

Examples:
  $ huskly-cli orders --status WORKING
  $ huskly-cli cancel-order 1003456789 --confirm
  $ huskly-cli cancel-order 1003456789 --confirm --json

Use "order cancel <operation-id>" for IBKR gateway orders.`
  )
  .action(async (orderId: string, options: { confirm?: boolean; json?: boolean }) => {
    guardSchwab("cancel-order");
    await handleCancelOrder(orderId, options);
  });

program
  .command("repl")
  .description("Start an interactive REPL to run multiple commands")
  .action(async () => {
    await handleRepl(broker());
  });

program
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    if (error instanceof RedisUnavailableError) {
      console.error(chalk.red("Error:"), error.message);
      console.error(chalk.dim("Example: brew services start redis  (or: redis-server)"));
      console.error(chalk.dim("Or rerun the command with --no-cache."));
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectCache();
  });
