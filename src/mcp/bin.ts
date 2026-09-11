#!/usr/bin/env node
import { startMcpServer } from "#src/mcp/server.js";

try {
  await startMcpServer();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Fatal error starting huskly-cli-mcp:", message);
  process.exitCode = 1;
}
