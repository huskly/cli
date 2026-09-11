import { createInterface } from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { HUSKLY_BASE_URL, HusklyDeviceAuth } from "./husklyDeviceAuth.js";
import {
  inspectIbkrCredentialFiles,
  installIbkrCredentialFiles,
  type CredentialFileInspection,
  type IbkrCredentialFileConfigs,
} from "./ibkrCredentialFiles.js";
import {
  provisionIbkrCredentials,
  type IbkrProvisioningResponse,
} from "./ibkrProvisioningClient.js";
import { validateIbkrCredential } from "./ibkrCredentialValidator.js";
import type { GatewayRuntime } from "#src/gateway/gatewayConfig.js";

export interface IbkrAuthCommandOptions {
  readonly replace: boolean;
}

interface AuthSessionProvider {
  getSessionToken(): Promise<string | null>;
  ensureAuthenticated(): Promise<void>;
}

export interface IbkrAuthCommandDependencies {
  readonly auth?: AuthSessionProvider;
  readonly inspectCredentialFiles?: () => Promise<CredentialFileInspection>;
  readonly provisionCredentials?: (input: {
    readonly baseUrl: string;
    readonly sessionToken: string;
    readonly currentClientIds: Readonly<Record<GatewayRuntime, string | undefined>>;
  }) => Promise<IbkrProvisioningResponse>;
  readonly installCredentialFiles?: (configs: IbkrCredentialFileConfigs) => Promise<void>;
  readonly validateCredential?: (
    runtime: GatewayRuntime,
    config: IbkrCredentialFileConfigs[GatewayRuntime]
  ) => Promise<void>;
  readonly prompt?: (message: string) => Promise<string>;
  readonly isInteractive?: () => boolean;
  readonly writeLine?: (message: string) => void;
}

const defaultDependencies: Required<IbkrAuthCommandDependencies> = {
  auth: new HusklyDeviceAuth(),
  inspectCredentialFiles: () => inspectIbkrCredentialFiles(),
  provisionCredentials: (input) => provisionIbkrCredentials(input),
  installCredentialFiles: (configs) => installIbkrCredentialFiles(configs),
  validateCredential: (runtime, config) => validateIbkrCredential(runtime, config),
  prompt: defaultPrompt,
  isInteractive: () => defaultInput.isTTY && defaultOutput.isTTY,
  writeLine: (message) => {
    console.log(message);
  },
};

export async function runIbkrAuthCommand(
  options: IbkrAuthCommandOptions,
  dependencies: IbkrAuthCommandDependencies = {}
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies };

  const inspection = await deps.inspectCredentialFiles();
  await confirmReplacement(options, deps, inspection);

  let sessionToken = await deps.auth.getSessionToken();
  if (sessionToken === null) {
    await deps.auth.ensureAuthenticated();
    sessionToken = await deps.auth.getSessionToken();
  }
  if (sessionToken === null) {
    throw new Error("Authentication failed before IBKR credential provisioning");
  }

  deps.writeLine("Provisioning IBKR gateway credentials...");
  const provisioned = await deps.provisionCredentials({
    baseUrl: HUSKLY_BASE_URL,
    sessionToken,
    currentClientIds: {
      cli: inspection.currentClientIds.cli,
      mcp: inspection.currentClientIds.mcp,
    },
  });

  const configs: IbkrCredentialFileConfigs = {
    cli: {
      gatewayUrl: provisioned.gatewayUrl,
      tokenUrl: provisioned.tokenUrl,
      clientId: provisioned.credentials.cli.clientId,
      clientSecret: provisioned.credentials.cli.clientSecret,
    },
    mcp: {
      gatewayUrl: provisioned.gatewayUrl,
      tokenUrl: provisioned.tokenUrl,
      clientId: provisioned.credentials.mcp.clientId,
      clientSecret: provisioned.credentials.mcp.clientSecret,
    },
  };

  try {
    await deps.installCredentialFiles(configs);
  } catch (error: unknown) {
    throw new Error(
      "IBKR credential installation failed after remote rotation succeeded. Old credentials were revoked and must not be restored. Check the CLI and MCP credential paths, then rerun `huskly-cli auth ibkr --replace`.",
      { cause: error }
    );
  }

  try {
    await deps.validateCredential("cli", configs.cli);
  } catch (error: unknown) {
    throw new Error(
      "IBKR CLI credential validation failed after new files were installed. Remote rotation succeeded, and old credentials were revoked and must not be restored. Fix IBKR gateway readiness and retry validation, or rerun `huskly-cli auth ibkr --replace`.",
      { cause: error }
    );
  }

  try {
    await deps.validateCredential("mcp", configs.mcp);
  } catch (error: unknown) {
    throw new Error(
      "IBKR MCP credential validation failed after new files were installed. Remote rotation succeeded, and old credentials were revoked and must not be restored. Fix IBKR gateway readiness and retry validation, or rerun `huskly-cli auth ibkr --replace`.",
      { cause: error }
    );
  }

  deps.writeLine(`Installed IBKR CLI credentials at ${inspection.paths.cli}`);
  deps.writeLine(`Installed IBKR MCP credentials at ${inspection.paths.mcp}`);
  deps.writeLine("IBKR gateway credentials are ready.");
}

async function confirmReplacement(
  options: IbkrAuthCommandOptions,
  deps: Required<IbkrAuthCommandDependencies>,
  inspection: CredentialFileInspection
): Promise<void> {
  if (!inspection.anyExists || options.replace) {
    return;
  }

  if (!deps.isInteractive()) {
    throw new Error("Existing IBKR credential files require --replace in non-interactive mode");
  }

  const answer = await deps.prompt(
    `Existing IBKR credential files will be replaced at ${inspection.paths.cli} and ${inspection.paths.mcp}. This immediately revokes the previous remote credentials. Continue? [y/N] `
  );
  if (!isApproved(answer)) {
    throw new Error("IBKR credential replacement declined");
  }
}

function isApproved(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

async function defaultPrompt(message: string): Promise<string> {
  const rl = createInterface({ input: defaultInput, output: defaultOutput });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}
