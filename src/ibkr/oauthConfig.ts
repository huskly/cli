import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { extractDhPrime } from "#src/ibkr/dhPrime.js";

/**
 * Shape of the OAuth 1.0a config consumed by `ibkr-client`'s `IbkrClient`
 * constructor. The package does not re-export this type, so we mirror it here.
 */
export interface IbkrOauth1Config {
  accessTokenSecret: string;
  accessToken: string;
  consumerKey: string;
  encryption: string;
  signature: string;
  dhPrime: string;
  realm: string;
}

/**
 * Assemble the `ibkr-client` OAuth 1.0a config from local PEM files + env vars.
 *
 * The cryptographic material (private keys + DH params) lives as PEM files in
 * the keys directory; the account-specific secrets come from the environment
 * (or a local .env). `ibkr-client` expects the DH prime as a hex string, so we
 * extract it from dhparam.pem via {@link extractDhPrime} (no openssl subprocess).
 *
 * The standard individual self-service OAuth flow uses the `limited_poa` realm;
 * institutional consumers override it via IBIND_OAUTH1A_REALM.
 */
const DEFAULT_REALM = "limited_poa";

const REQUIRED_ENV = [
  "IBIND_OAUTH1A_CONSUMER_KEY",
  "IBIND_OAUTH1A_ACCESS_TOKEN",
  "IBIND_OAUTH1A_ACCESS_TOKEN_SECRET",
] as const;

export function buildOauthConfig(): IbkrOauth1Config {
  // dotenv v17 logs an "injected env" banner to stdout by default; the MCP
  // server's stdio transport requires stdout to carry nothing but JSON-RPC.
  loadEnv({ quiet: true });

  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required IBKR environment variables:\n  ${missing.join("\n  ")}\n\n` +
        "Copy .env.example to .env and fill them in (or export them)."
    );
  }

  // Where the PEM key files live (defaults to the current working directory).
  const keysDir = process.env["IBKR_KEYS_DIR"] ?? process.cwd();
  const readPem = (file: string): string => readFileSync(resolve(keysDir, file), "utf8");

  return {
    consumerKey: process.env["IBIND_OAUTH1A_CONSUMER_KEY"] ?? "",
    accessToken: process.env["IBIND_OAUTH1A_ACCESS_TOKEN"] ?? "",
    accessTokenSecret: process.env["IBIND_OAUTH1A_ACCESS_TOKEN_SECRET"] ?? "",
    signature: readPem("private_signature.pem"),
    encryption: readPem("private_encryption.pem"),
    dhPrime: extractDhPrime(readPem("dhparam.pem")),
    realm: process.env["IBIND_OAUTH1A_REALM"] ?? DEFAULT_REALM,
  };
}
