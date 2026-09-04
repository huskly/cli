import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isIP } from "node:net";
import { join } from "node:path";
import { z } from "zod";

const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_CLIENT_FIELD_LENGTH = 1024;

export type GatewayRuntime = "cli" | "mcp";

export interface GatewayConfig {
  readonly gatewayUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface GatewayConfigLoaderOptions {
  readonly runtime: GatewayRuntime;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
  readonly uid?: number;
  readonly allowHttpLoopback?: boolean;
}

const gatewayConfigSchema = z.strictObject({
  gatewayUrl: boundedString("gatewayUrl", MAX_URL_LENGTH),
  tokenUrl: boundedString("tokenUrl", MAX_URL_LENGTH),
  clientId: boundedString("clientId", MAX_CLIENT_FIELD_LENGTH),
  clientSecret: boundedString("clientSecret", MAX_CLIENT_FIELD_LENGTH),
});

function boundedString(field: string, maxLength: number) {
  return z
    .string()
    .max(maxLength, `${field} must be at most ${String(maxLength)} characters`)
    .refine((value) => value.trim().length > 0, `${field} must not be empty`);
}

export async function loadGatewayConfig(
  options: GatewayConfigLoaderOptions
): Promise<GatewayConfig> {
  const path = resolveGatewayConfigPath(options);
  const uid = options.uid ?? process.getuid?.();

  if (uid === undefined) {
    throw new Error("Gateway config ownership checks require a current uid");
  }

  const file = await openGatewayConfig(path);
  try {
    const stat = await file.stat();

    if (!stat.isFile()) {
      throw new Error(`Gateway config at ${path} must be a regular file`);
    }

    if (stat.uid !== uid) {
      throw new Error(`Gateway config at ${path} must be owned by uid ${String(uid)}`);
    }

    if ((stat.mode & 0o7777) !== 0o600) {
      throw new Error(`Gateway config at ${path} must have mode 0600`);
    }

    if (stat.size > MAX_CONFIG_BYTES) {
      throw new Error(
        `Gateway config at ${path} must be at most 16 KiB (${String(MAX_CONFIG_BYTES)} bytes)`
      );
    }

    const source = await readBoundedUtf8(file, path);
    const parsed = parseGatewayConfigJson(source, path);

    validateGatewayUrl(parsed.gatewayUrl, "gatewayUrl", options.allowHttpLoopback === true);
    validateGatewayUrl(parsed.tokenUrl, "tokenUrl", options.allowHttpLoopback === true);

    return parsed;
  } finally {
    await file.close();
  }
}

function resolveGatewayConfigPath(options: GatewayConfigLoaderOptions): string {
  const env = options.env ?? process.env;
  const override =
    options.runtime === "cli"
      ? env["HUSKLY_IBKR_GATEWAY_CLI_CONFIG"]
      : env["HUSKLY_IBKR_GATEWAY_MCP_CONFIG"];

  if (override !== undefined) {
    return override;
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  const fileName = options.runtime === "cli" ? "ibkr-gateway-cli.json" : "ibkr-gateway-mcp.json";

  return join(homeDirectory, ".config", "huskly", fileName);
}

async function openGatewayConfig(path: string) {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ELOOP")) {
      throw new Error(`Gateway config at ${path} must not be a symbolic link`, { cause: error });
    }
    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readBoundedUtf8(
  file: Awaited<ReturnType<typeof openGatewayConfig>>,
  path: string
): Promise<string> {
  const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
  let totalBytes = 0;

  while (totalBytes < buffer.length) {
    const { bytesRead } = await file.read(buffer, totalBytes, buffer.length - totalBytes, null);
    if (bytesRead === 0) {
      return buffer.toString("utf8", 0, totalBytes);
    }
    totalBytes += bytesRead;
  }

  throw new Error(
    `Gateway config at ${path} must be at most 16 KiB (${String(MAX_CONFIG_BYTES)} bytes)`
  );
}

function parseGatewayConfigJson(source: string, path: string): GatewayConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch {
    throw new Error(`Gateway config at ${path} must contain valid JSON`);
  }

  const result = gatewayConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Gateway config at ${path} is invalid: ${result.error.issues.map((issue) => issue.message).join("; ")}`
    );
  }

  return result.data;
}

function validateGatewayUrl(
  value: string,
  field: keyof GatewayConfig,
  allowHttpLoopback: boolean
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`${field} must not include URL credentials`);
  }

  if (url.hash.length > 0) {
    throw new Error(`${field} must not include a fragment`);
  }

  if (url.protocol === "https:") {
    return;
  }

  if (url.protocol === "http:" && allowHttpLoopback && isLoopbackHostname(url.hostname)) {
    return;
  }

  throw new Error(
    `${field} must use HTTPS unless allowHttpLoopback is enabled for an exact loopback host`
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  if (isIP(normalized) !== 4) {
    return false;
  }

  const [firstOctet] = normalized.split(".");
  return firstOctet === "127";
}
