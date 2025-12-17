import pino from "pino";

const level = process.env["LOG_LEVEL"] ?? "info";
const options: pino.LoggerOptions = { level };

if (process.stdout.isTTY) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  };
}

export const logger = pino(options);
