import { createRequire } from "module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const keytar = require("keytar") as typeof import("keytar");
import open from "open";
import chalk from "chalk";
import ora from "ora";
import { logger } from "#src/logger.js";

const SERVICE_NAME = "huskly-cli";
const ACCOUNT_NAME = "huskly-schwab-token";
const HUSKLY_BASE_URL = "https://huskly.finance";

/** Response from device code initiation endpoint */
interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Response from polling endpoint */
interface PollResponse {
  status: "pending" | "authorized" | "expired" | "denied";
  sessionToken?: string;
  error?: string;
}

/** Stored auth session */
interface StoredSession {
  sessionToken: string;
  expiresAt: string;
}

/**
 * Handles OAuth device authorization flow for CLI authentication with huskly.finance.
 * Similar to GitHub CLI, Copilot CLI, and Claude Code auth flows.
 */
export class HusklyDeviceAuth {
  private baseUrl: string;

  constructor(baseUrl: string = HUSKLY_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Main login flow - initiates device authorization and waits for completion.
   * Opens browser for user to authorize the CLI.
   */
  async login(): Promise<void> {
    console.log(chalk.blue("\nAuthorizing with huskly.finance...\n"));

    const deviceCode = await this.initiateDeviceFlow();

    console.log(chalk.bold("Visit: ") + chalk.cyan(deviceCode.verificationUri));
    console.log(chalk.bold("Enter code: ") + chalk.yellow.bold(deviceCode.userCode));
    console.log();

    // Attempt to open browser automatically
    try {
      await open(deviceCode.verificationUri);
    } catch {
      console.log(chalk.dim("(Could not open browser automatically)"));
    }

    // Delay starting the spinner so the message doesn't flash if auth completes immediately
    const spinner = ora("Waiting for authorization...");

    try {
      const session = await this.pollForAuthorization(
        deviceCode.deviceCode,
        deviceCode.interval,
        deviceCode.expiresIn
      );

      await this.storeSession(session);
      spinner.succeed(chalk.green("Authorization successful!"));
    } catch (error) {
      spinner.succeed(chalk.green("Authorization successful!"));
      throw error;
    }
  }

  /**
   * Logout - clear stored credentials.
   */
  async logout(): Promise<void> {
    const deleted = await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    if (deleted) {
      console.log(chalk.green("✓ Logged out successfully"));
    } else {
      console.log(chalk.yellow("No active session found"));
    }
  }

  /**
   * Check current auth status.
   */
  async status(): Promise<void> {
    const session = await this.getStoredSession();

    if (!session) {
      console.log(chalk.yellow("Not logged in"));
      console.log(chalk.dim("Run 'huskly-cli auth login' to authenticate"));
      return;
    }

    const expiresAt = new Date(session.expiresAt);
    const now = new Date();

    if (expiresAt <= now) {
      console.log(chalk.yellow("Session expired"));
      console.log(chalk.dim("Run 'huskly-cli auth login' to re-authenticate"));
      return;
    }

    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    console.log(chalk.green("✓ Logged in"));
    console.log(chalk.dim(`Session expires in ${String(daysRemaining)} day(s)`));
  }

  /**
   * Get a valid Schwab access token for API calls.
   * Returns null if not authenticated or session expired.
   */
  async getAccessToken(): Promise<string | null> {
    const session = await this.getStoredSession();

    if (!session) {
      logger.debug("No stored session found");
      return null;
    }

    const expiresAt = new Date(session.expiresAt);
    if (expiresAt <= new Date()) {
      logger.debug("Stored session has expired");
      return null;
    }

    // Exchange session token for Schwab access token
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/cli/token`, {
        method: "GET",
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Session invalid, clear it
          await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
          logger.warn("Stored session is invalid, cleared stored credentials");
          return null;
        }
        throw new Error(`Failed to get access token: ${response.statusText}`);
      } else if (response.status === 502) {
        // Bad gateway, likely Schwab Oauth token expired. Tell the user to re-authenticate.
        await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
        logger.warn(
          "Schwab OAuth token expired, please re-authenticate at huskly.finance and try 'auth login' again"
        );
        return null;
      }

      const { accessToken } = (await response.json()) as { accessToken: string };
      return accessToken;
    } catch (error) {
      console.error(chalk.red("Failed to retrieve access token:"), error);
      return null;
    }
  }

  /**
   * Check if user is authenticated with a valid session.
   */
  async isAuthenticated(): Promise<boolean> {
    const session = await this.getStoredSession();
    if (!session) return false;

    const expiresAt = new Date(session.expiresAt);
    return expiresAt > new Date();
  }

  /**
   * Ensure user is authenticated, prompting login if needed.
   * Throws if authentication fails.
   */
  async ensureAuthenticated(): Promise<void> {
    if (await this.isAuthenticated()) {
      return;
    }

    console.log(chalk.yellow("Authentication required"));
    await this.login();
  }

  // --- Private methods ---

  /**
   * Request a device code from the backend to start the auth flow.
   */
  private async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/cli/device/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to initiate device flow: ${errorText}`);
    }

    return (await response.json()) as DeviceCodeResponse;
  }

  /**
   * Poll the backend until user completes authorization or timeout.
   */
  private async pollForAuthorization(
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number
  ): Promise<StoredSession> {
    const deadline = Date.now() + expiresInSeconds * 1000;
    let currentInterval = intervalSeconds * 1000;

    while (Date.now() < deadline) {
      await this.sleep(currentInterval);

      try {
        const response = await fetch(`${this.baseUrl}/api/v1/cli/device/poll`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deviceCode }),
        });

        if (response.status === 429) {
          // Rate limited, increase interval (exponential backoff)
          currentInterval = Math.min(currentInterval * 2, 30000);
          continue;
        }

        if (!response.ok) {
          throw new Error(`Poll request failed: ${response.statusText}`);
        }

        const result = (await response.json()) as PollResponse;

        switch (result.status) {
          case "authorized": {
            if (!result.sessionToken) {
              throw new Error("Authorization succeeded but no session token received");
            }
            // Calculate expiry (assume 30 days if not specified)
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);

            return {
              sessionToken: result.sessionToken,
              expiresAt: expiresAt.toISOString(),
            };
          }

          case "denied":
            throw new Error(result.error ?? "Authorization was denied");

          case "expired":
            throw new Error("Device code expired. Please try again.");

          case "pending":
            // Continue polling
            break;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("fetch")) {
          // Network error, continue polling with backoff
          currentInterval = Math.min(currentInterval * 2, 30000);
          continue;
        }
        throw error;
      }
    }

    throw new Error("Authorization timed out. Please try again.");
  }

  /**
   * Store session credentials securely in OS keychain.
   */
  private async storeSession(session: StoredSession): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(session));
  }

  /**
   * Retrieve stored session from OS keychain.
   */
  private async getStoredSession(): Promise<StoredSession | null> {
    const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (!stored) return null;

    try {
      return JSON.parse(stored) as StoredSession;
    } catch {
      // Corrupted data, clear it
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
