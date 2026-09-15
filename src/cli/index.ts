#!/usr/bin/env node
import chalk from "chalk";
import { disconnectCache, RedisUnavailableError } from "#src/cache.js";
import { createProgram } from "./program.js";

createProgram()
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
