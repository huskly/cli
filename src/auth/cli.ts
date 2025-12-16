#!/usr/bin/env node
import { HusklyDeviceAuth } from "./husklyDeviceAuth.js";
import chalk from "chalk";

const auth = new HusklyDeviceAuth();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "login":
      await auth.login();
      break;

    case "logout":
      await auth.logout();
      break;

    case "status":
      await auth.status();
      break;

    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

function printUsage(): void {
  console.log(`
${chalk.bold("huskly-cli auth")} - Manage authentication with huskly.finance

${chalk.bold("Usage:")}
  huskly-cli auth <command>

${chalk.bold("Commands:")}
  login     Authenticate with huskly.finance via browser
  logout    Clear stored credentials
  status    Check current authentication status

${chalk.bold("Examples:")}
  $ huskly-cli auth login
  $ huskly-cli auth status
  $ huskly-cli auth logout
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red("Error:"), message);
  process.exit(1);
});
