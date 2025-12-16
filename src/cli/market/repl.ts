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

function printHelp(): void {
  console.log(`
${chalk.bold("Available commands:")}
  ${chalk.cyan("quote <symbols...>")}     Get price quotes (e.g., quote SPY AAPL)
  ${chalk.cyan("history <symbol>")}       Get price history (options: -d/--days)
  ${chalk.cyan("chart <symbol>")}         Display ASCII chart (options: -d/--days, -h/--height, -i/--image)
  ${chalk.cyan("vix")}                    Get current VIX level
  ${chalk.cyan("expiries <symbol>")}      List option expiration dates (options: -t/--type, -f/--from, -e/--to)
  ${chalk.cyan("chain <symbol> [expiry]")} Get option chain (options: -a/--around, -s/--strikes)
  ${chalk.cyan("account")}                Show account equity
  ${chalk.cyan("positions <symbol>")}     Show option positions
  ${chalk.cyan("help")}                   Show this help
  ${chalk.cyan("exit")}                   Exit the REPL

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

async function executeCommand(input: string): Promise<void> {
  const args = parseArgs(input.trim());
  if (args.length === 0) return;

  const firstArg = args[0];
  if (firstArg === undefined) return;

  const command = firstArg.toLowerCase();
  const rest = args.slice(1);
  const { positional, options } = parseOptions(rest);

  try {
    switch (command) {
      case "quote":
        if (positional.length === 0) {
          console.log(chalk.red("Usage: quote <symbols...>"));
          return;
        }
        await handleQuote(positional);
        break;

      case "history": {
        const symbol = positional[0];
        if (!symbol) {
          console.log(chalk.red("Usage: history <symbol> [-d/--days <n>]"));
          return;
        }
        await handleHistory(symbol, parseInt(options["d"] ?? options["days"] ?? "10"));
        break;
      }

      case "chart": {
        const symbol = positional[0];
        if (!symbol) {
          console.log(
            chalk.red("Usage: chart <symbol> [-d/--days <n>] [-h/--height <n>] [-i/--image]")
          );
          return;
        }
        await handleChart(
          symbol,
          parseInt(options["d"] ?? options["days"] ?? "30"),
          parseInt(options["h"] ?? options["height"] ?? "15"),
          options["i"] !== undefined || options["image"] !== undefined
        );
        break;
      }

      case "vix":
        await handleVix();
        break;

      case "expiries": {
        const symbol = positional[0];
        if (!symbol) {
          console.log(
            chalk.red(
              "Usage: expiries <symbol> [-t/--type <PUT|CALL>] [-f/--from <date>] [-e/--to <date>]"
            )
          );
          return;
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
        const symbol = positional[0];
        if (!symbol) {
          console.log(
            chalk.red("Usage: chain <symbol> [expiry] [-a/--around <strike>] [-s/--strikes <n>]")
          );
          return;
        }
        const around = options["a"] ?? options["around"];
        await handleChain(symbol, positional[1], {
          ...(around && { around }),
          strikes: options["s"] ?? options["strikes"] ?? "10",
        });
        break;
      }

      case "account":
        await handleAccount();
        break;

      case "positions": {
        const symbol = positional[0];
        if (!symbol) {
          console.log(chalk.red("Usage: positions <symbol>"));
          return;
        }
        await handlePositions(symbol);
        break;
      }

      case "help":
        printHelp();
        break;

      case "exit":
      case "quit":
        process.exit(0);
        break;

      default:
        console.log(chalk.red(`Unknown command: ${command}`));
        console.log(chalk.gray('Type "help" for available commands.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("Error:"), message);
  }
}

export function handleRepl(): void {
  console.log(chalk.bold("\n🚀 Market Data REPL"));
  console.log(chalk.gray('Type "help" for available commands, Ctrl+C to exit.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(chalk.green("market> "), (input: string) => {
      executeCommand(input)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red("Error:"), message);
        })
        .finally(() => {
          prompt();
        });
    });
  };

  rl.on("close", () => {
    console.log(chalk.gray("\nGoodbye!"));
    process.exit(0);
  });

  prompt();
}
