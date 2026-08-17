import * as readline from "readline";
import chalk from "chalk";
import { handleQuote } from "./quote.js";
import { handleHistory } from "./history.js";
import { handleChart } from "./chart.js";
import { handleVix } from "./vix.js";
import { handleExpiries } from "./expiries.js";
import { handleChain } from "./chain.js";
import { handleAccount } from "./account.js";
import { handlePositions } from "./positions.js";
import { handleSearch } from "./search.js";
import { handleTransactions } from "./transactions.js";
import { handleOrders } from "./orders.js";
import { requireSchwab } from "./shared.js";
import { RedisUnavailableError } from "#src/cache.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";

type ReplCommandResult = "continue" | "exit";

function printHelp(broker: BrokerName): void {
  const schwabOnly = broker === "schwab" ? "" : chalk.gray(" (Schwab only)");

  console.log(`
${chalk.bold(`Available ${broker.toUpperCase()} commands:`)}
  ${chalk.cyan("quote <symbols...>")}      Get price quotes (e.g., quote SPY AAPL)
  ${chalk.cyan("search <symbol>")}         Search instruments (options: -p/--projection)
  ${chalk.cyan("account")}                 Show account equity
  ${chalk.cyan("positions [symbol]")}      Show positions (options: -t/--type)
  ${chalk.cyan("transactions")}            List transactions (options: -s/--start, -e/--end, -t/--type)
  ${chalk.cyan("orders")}                  List orders (options: -f/--from, -t/--to, -s/--status)
  ${chalk.cyan("history <symbol>")}        Get price history${schwabOnly}
  ${chalk.cyan("chart <symbol>")}          Display ASCII chart${schwabOnly}
  ${chalk.cyan("vix")}                     Get current VIX level${schwabOnly}
  ${chalk.cyan("expiries <symbol>")}       List option expiration dates${schwabOnly}
  ${chalk.cyan("chain <symbol> [expiry]")} Get option chain${schwabOnly}
  ${chalk.cyan("help")}                    Show this help
  ${chalk.cyan("exit")}                    Exit the REPL

Press ${chalk.yellow("Ctrl+C")} to exit at any time.
`);
}

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (const char of input) {
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function parseOptions(args: string[]): { positional: string[]; options: Record<string, string> } {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[++i];
      options[key] = nextArg ?? "true";
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const nextArg = args[++i];
      options[key] = nextArg ?? "true";
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { positional, options };
}

function guardSchwabRepl(broker: BrokerName, command: string): boolean {
  try {
    requireSchwab(broker, command);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(message));
    return false;
  }
}

async function executeCommand(broker: BrokerName, input: string): Promise<ReplCommandResult> {
  const args = parseArgs(input.trim());
  if (args.length === 0) return "continue";

  const firstArg = args[0];
  if (firstArg === undefined) return "continue";

  const command = firstArg.toLowerCase();
  const rest = args.slice(1);
  const { positional, options } = parseOptions(rest);

  try {
    switch (command) {
      case "quote":
        if (positional.length === 0) {
          console.log(chalk.red("Usage: quote <symbols...>"));
          return "continue";
        }
        await handleQuote(broker, positional);
        break;

      case "search": {
        const symbol = positional[0];
        if (!symbol) {
          console.log(chalk.red("Usage: search <symbol> [-p/--projection <type>]"));
          return "continue";
        }
        await handleSearch(broker, symbol, {
          projection: options["p"] ?? options["projection"] ?? "symbol-search",
        });
        break;
      }

      case "history": {
        if (!guardSchwabRepl(broker, "history")) return "continue";
        const symbol = positional[0];
        if (!symbol) {
          console.log(chalk.red("Usage: history <symbol> [-d/--days <n>]"));
          return "continue";
        }
        await handleHistory(symbol, parseInt(options["d"] ?? options["days"] ?? "10", 10));
        break;
      }

      case "chart": {
        if (!guardSchwabRepl(broker, "chart")) return "continue";
        const symbol = positional[0];
        if (!symbol) {
          console.log(
            chalk.red("Usage: chart <symbol> [-d/--days <n>] [-h/--height <n>] [-i/--image]")
          );
          return "continue";
        }
        await handleChart(
          symbol,
          parseInt(options["d"] ?? options["days"] ?? "30", 10),
          parseInt(options["h"] ?? options["height"] ?? "15", 10),
          options["i"] !== undefined || options["image"] !== undefined
        );
        break;
      }

      case "vix":
        if (!guardSchwabRepl(broker, "vix")) return "continue";
        await handleVix();
        break;

      case "expiries": {
        if (!guardSchwabRepl(broker, "expiries")) return "continue";
        const symbol = positional[0];
        if (!symbol) {
          console.log(
            chalk.red(
              "Usage: expiries <symbol> [-t/--type <PUT|CALL>] [-f/--from <date>] [-e/--to <date>]"
            )
          );
          return "continue";
        }
        const fromDate = options["f"] ?? options["from"];
        const toDate = options["e"] ?? options["to"];
        await handleExpiries(symbol, {
          type: options["t"] ?? options["type"] ?? "PUT",
          ...(fromDate && { from: fromDate }),
          ...(toDate && { to: toDate }),
        });
        break;
      }

      case "chain": {
        if (!guardSchwabRepl(broker, "chain")) return "continue";
        const symbol = positional[0];
        if (!symbol) {
          console.log(
            chalk.red("Usage: chain <symbol> [expiry] [-a/--around <strike>] [-s/--strikes <n>]")
          );
          return "continue";
        }
        const around = options["a"] ?? options["around"];
        await handleChain(symbol, positional[1], {
          ...(around && { around }),
          strikes: options["s"] ?? options["strikes"] ?? "10",
        });
        break;
      }

      case "account":
        await handleAccount(broker);
        break;

      case "positions": {
        const symbol = positional[0];
        const type = options["t"] ?? options["type"];
        await handlePositions(broker, symbol, type);
        break;
      }

      case "transactions":
        await handleTransactions(
          broker,
          definedOptions({
            start: options["s"] ?? options["start"],
            end: options["e"] ?? options["end"],
            type: options["t"] ?? options["type"],
          })
        );
        break;

      case "orders":
        await handleOrders(
          broker,
          definedOptions({
            from: options["f"] ?? options["from"],
            to: options["t"] ?? options["to"],
            status: options["s"] ?? options["status"],
            maxResults: options["m"] ?? options["max-results"],
          })
        );
        break;

      case "help":
        printHelp(broker);
        break;

      case "exit":
      case "quit":
        return "exit";

      default:
        console.log(chalk.red(`Unknown command: ${command}`));
        console.log(chalk.gray('Type "help" for available commands.'));
    }
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      console.error(chalk.red("Error:"), error.message);
      return "exit";
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("Error:"), message);
  }

  return "continue";
}

function definedOptions<T extends Record<string, string | undefined>>(options: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(options).filter((entry): entry is [string, string] => entry[1] !== undefined)
  ) as Partial<T>;
}

export function handleRepl(broker: BrokerName): Promise<void> {
  console.log(chalk.bold(`\n${broker.toUpperCase()} Market Data REPL`));
  console.log(chalk.gray('Type "help" for available commands, Ctrl+C to exit.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
    prompt: chalk.green(`${broker}> `),
  });

  let isProcessing = false;
  let isClosed = false;

  return new Promise((resolve) => {
    rl.on("line", (input: string) => {
      if (isProcessing) return;
      isProcessing = true;

      executeCommand(broker, input)
        .then((result) => {
          if (result === "exit") {
            rl.close();
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red("Error:"), message);
        })
        .finally(() => {
          isProcessing = false;
          if (!isClosed) {
            rl.prompt();
          }
        });
    });

    rl.on("close", () => {
      isClosed = true;
      console.log(chalk.gray("\nGoodbye!"));
      resolve();
    });

    rl.prompt();
  });
}
