import pino from "pino";

const level = process.env["LOG_LEVEL"] ?? "info";
const options: pino.LoggerOptions = { level };

// Logs always go to stderr, never stdout: the MCP server's stdio transport
// requires stdout to carry nothing but JSON-RPC messages, and CLI commands
// reserve stdout for their own formatted output.
if (process.stdout.isTTY) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      destination: 2,
    },
  };
}

export const logger = options.transport ? pino(options) : pino(options, pino.destination(2));
