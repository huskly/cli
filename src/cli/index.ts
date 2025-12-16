#!/usr/bin/env node
import { disconnectCache } from "#src/cache.js";
import chalk from "chalk";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  switch (subcommand) {
    case "auth": {
      // Re-execute with auth CLI
      process.argv = ["node", "huskly-cli", ...args.slice(1)];
      await import("../auth/cli.js");
      break;
    }

    case "market": {
      // Re-execute with market CLI
      process.argv = ["node", "huskly-cli", ...args.slice(1)];
      await import("./market.js");
      break;
    }

    default:
      printUsage();
      process.exit(subcommand ? 1 : 0);
  }
}

function printUsage(): void {
  console.log(`
${chalk.bold("huskly-cli")} - Terminal-based trading tools powered by Schwab API

${chalk.bold("Usage:")}
  huskly-cli <command> [options]

${chalk.bold("Commands:")}
  ${chalk.cyan("auth")}      Manage authentication with huskly.finance
  ${chalk.cyan("market")}    Explore market data (quotes, options, history)

${chalk.bold("Examples:")}
  $ huskly-cli auth login
  $ huskly-cli market quote SPY
  $ huskly-cli market vix
  $ huskly-cli market chain SPX --puts

Run ${chalk.cyan("huskly-cli <command>")} without arguments for command-specific help.
`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("Error:"), message);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectCache();
  });
