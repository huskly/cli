import chalk from "chalk";
import { apiClient } from "./shared.js";

export async function handleUserPreference(): Promise<void> {
  console.log(chalk.bold("\n User Preferences\n"));
  const api = await apiClient();
  const prefs = await api.getUserPreference();

  // Accounts section
  console.log(chalk.cyan.bold("Accounts:"));
  console.log(chalk.gray("─".repeat(60)));
  for (const account of prefs.accounts) {
    const primaryBadge = account.primaryAccount ? chalk.green(" (Primary)") : "";
    console.log(`  ${chalk.white(account.accountNumber)}${primaryBadge}`);
    console.log(`    Type:              ${chalk.yellow(account.type)}`);
    if (account.nickName) {
      console.log(`    Nickname:          ${chalk.cyan(account.nickName)}`);
    }
    console.log(`    Display ID:        ${chalk.gray(account.displayAcctId)}`);
    console.log(`    Color:             ${chalk.magenta(account.accountColor)}`);
    console.log(
      `    Auto Position:     ${account.autoPositionEffect ? chalk.green("Yes") : chalk.gray("No")}`
    );
    console.log();
  }

  // Streamer Info section
  console.log(chalk.cyan.bold("Streamer Info:"));
  console.log(chalk.gray("─".repeat(60)));
  console.log(`  Socket URL:          ${chalk.blue(prefs.streamerInfo.streamerSocketUrl)}`);
  console.log(`  Customer ID:         ${chalk.gray(prefs.streamerInfo.schwabClientCustomerId)}`);
  console.log(`  Correlation ID:      ${chalk.gray(prefs.streamerInfo.schwabClientCorrelId)}`);
  console.log(`  Channel:             ${chalk.gray(prefs.streamerInfo.schwabClientChannel)}`);
  console.log(`  Function ID:         ${chalk.gray(prefs.streamerInfo.schwabClientFunctionId)}`);
  console.log();

  // Offers section
  if (prefs.offers.length > 0) {
    console.log(chalk.cyan.bold("Offers:"));
    console.log(chalk.gray("─".repeat(60)));
    for (const offer of prefs.offers) {
      console.log(
        `  Level 2 Permissions: ${offer.level2Permissions ? chalk.green("Yes") : chalk.gray("No")}`
      );
      console.log(`  Market Data:         ${chalk.yellow(offer.mktDataPermission)}`);
    }
    console.log();
  }
}
