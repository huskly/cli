import { IbkrGatewayClient, IbkrGatewayVersionError } from "@huskly/ibkr-gateway-client";
import type { GatewayConfig, GatewayRuntime } from "#src/gateway/gatewayConfig.js";
import { createMachineTokenProvider } from "#src/gateway/machineTokenProvider.js";

const REQUIRED_SCOPE = "ibkr:read-write";

type ValidationPhase =
  | "token exchange"
  | "token scope"
  | "gateway compatibility"
  | "gateway liveness"
  | "gateway diagnostics"
  | "gateway authentication"
  | "gateway connection"
  | "gateway account";

export interface IbkrCredentialValidatorDependencies {
  readonly fetch?: typeof fetch;
}

export async function validateIbkrCredential(
  runtime: GatewayRuntime,
  config: GatewayConfig,
  dependencies: IbkrCredentialValidatorDependencies = {}
): Promise<void> {
  const provider = createMachineTokenProvider({
    tokenUrl: config.tokenUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });

  let access: Awaited<ReturnType<typeof provider.getAccess>>;
  try {
    access = await provider.getAccess();
  } catch {
    throw validationError(runtime, "token exchange");
  }

  if (access.scope !== REQUIRED_SCOPE) {
    throw validationError(runtime, "token scope");
  }

  const client = new IbkrGatewayClient({
    baseUrl: config.gatewayUrl,
    token: () => provider.getToken(),
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });

  try {
    await client.getLiveness();
  } catch (error: unknown) {
    if (error instanceof IbkrGatewayVersionError) {
      throw validationError(runtime, "gateway compatibility");
    }
    throw validationError(runtime, "gateway liveness");
  }

  let diagnostics: unknown;
  try {
    diagnostics = await client.getDiagnostics();
  } catch (error: unknown) {
    if (error instanceof IbkrGatewayVersionError) {
      throw validationError(runtime, "gateway compatibility");
    }
    throw validationError(runtime, "gateway diagnostics");
  }

  validateDiagnostics(runtime, diagnostics);
}

function validateDiagnostics(runtime: GatewayRuntime, diagnostics: unknown): void {
  if (typeof diagnostics !== "object" || diagnostics === null || Array.isArray(diagnostics)) {
    throw validationError(runtime, "gateway diagnostics");
  }

  const record = diagnostics as Record<string, unknown>;

  if (!Object.hasOwn(record, "authenticated")) {
    throw validationError(runtime, "gateway diagnostics");
  }
  if (record["authenticated"] !== true) {
    throw validationError(runtime, "gateway authentication");
  }

  if (!Object.hasOwn(record, "connected")) {
    throw validationError(runtime, "gateway diagnostics");
  }
  if (record["connected"] !== true) {
    throw validationError(runtime, "gateway connection");
  }

  if (!Object.hasOwn(record, "accountVerified")) {
    throw validationError(runtime, "gateway diagnostics");
  }
  if (record["accountVerified"] !== true) {
    throw validationError(runtime, "gateway account");
  }
}

function validationError(runtime: GatewayRuntime, phase: ValidationPhase): Error {
  return new Error(`IBKR ${runtime.toUpperCase()} credential failed ${phase} validation`);
}
