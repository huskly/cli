import * as readline from "readline";
import chalk from "chalk";
import { CommanderError, type Command } from "commander";
import { isCacheEnabled, RedisUnavailableError } from "#src/cache.js";
import type { BrokerName } from "#src/brokers/brokerClient.js";
import { createProgram, type ProgramSession } from "./program.js";

type ReplCommandResult = "continue" | "exit";

/**
 * Split a REPL line into argv, honouring quotes.
 *
 * @remarks
 * Option symbols are space padded, so `quote "AAPL  261218C00330000"` must stay
 * one argument.
 */
export function parseArgs(input: string): string[] {
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

/**
 * Stop Commander from ending the process on help, version, or a usage error.
 *
 * @remarks
 * Commander exits by default. Inside a REPL that would close the session, so
 * every command in the tree must throw instead.
 */
function keepSessionAlive(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) {
    keepSessionAlive(child);
  }
}

/** True when Commander already printed its own message, such as help or usage. */
function alreadyReported(error: unknown): error is CommanderError {
  return error instanceof CommanderError;
}

export async function executeCommand(
  session: ProgramSession,
  input: string
): Promise<ReplCommandResult> {
  const args = parseArgs(input.trim());
  const first = args[0]?.toLowerCase();
  if (first === undefined) return "continue";
  if (first === "exit" || first === "quit") return "exit";

  const program = createProgram({ ...session, interactive: true });
  keepSessionAlive(program);

  try {
    await program.parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      console.error(chalk.red("Error:"), error.message);
      console.error(chalk.dim("Restart the REPL with --no-cache to read without Redis."));
      return "exit";
    }
    if (alreadyReported(error)) return "continue";
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("Error:"), message);
  }

  return "continue";
}

export function handleRepl(broker: BrokerName): Promise<void> {
  const session: ProgramSession = { broker, cache: isCacheEnabled() };

  console.log(chalk.bold(`\n${broker.toUpperCase()} Trading REPL`));
  console.log(chalk.gray('Every huskly-cli command works here. Type "help" for the list, or'));
  console.log(chalk.gray('"help <command>" for one command. Type "exit" or press Ctrl+C.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
    prompt: chalk.green(`${broker}> `),
  });

  // Two different endings. `stopped` means the user asked to leave, so queued
  // lines must be abandoned. `inputClosed` only means stdin ended, and every
  // line already accepted must still run.
  let stopped = false;
  let inputClosed = false;
  // Run one line at a time, but never drop a line that arrives while the
  // previous command is still running. Dropping input loses real commands
  // whenever the session is scripted or pasted.
  let queue: Promise<void> = Promise.resolve();

  return new Promise((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      console.log(chalk.gray("\nGoodbye!"));
      resolve();
    };

    rl.on("line", (input: string) => {
      queue = queue.then(async () => {
        if (stopped) return;
        try {
          if ((await executeCommand(session, input)) === "exit") {
            stopped = true;
            rl.close();
            return;
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red("Error:"), message);
        }
        if (!inputClosed && !stopped) rl.prompt();
      });
    });

    rl.on("close", () => {
      inputClosed = true;
      // End of input can arrive while commands are still queued or running.
      // Resolving now would let the caller close the cache under a live
      // command, so wait for the queue to drain first.
      void queue.then(finish, finish);
    });

    rl.prompt();
  });
}
