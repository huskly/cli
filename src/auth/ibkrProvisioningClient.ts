import { z } from "zod";
import { type GatewayRuntime, validateGatewayUrl } from "#src/gateway/gatewayConfig.js";

const PROVISIONING_RESPONSE_LIMIT_BYTES = 16 * 1024;
const CLIENT_ID_PATTERN = /^mc_[A-Za-z0-9_-]{24}$/u;
const CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ROTATE_PATH = "/api/v1/cli/ibkr-credentials/rotate";

const clientIdSchema = z.string().regex(CLIENT_ID_PATTERN);

const provisionedCredentialSchema = z.strictObject({
  clientId: clientIdSchema,
  clientSecret: z.string().regex(CLIENT_SECRET_PATTERN),
});

const provisioningResponseSchema = z.strictObject({
  gatewayUrl: z.string(),
  tokenUrl: z.string(),
  credentials: z.strictObject({
    cli: provisionedCredentialSchema,
    mcp: provisionedCredentialSchema,
  }),
});

export interface ProvisionedCredential {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface IbkrProvisioningResponse {
  readonly gatewayUrl: string;
  readonly tokenUrl: string;
  readonly credentials: Readonly<Record<GatewayRuntime, ProvisionedCredential>>;
}

export interface ProvisionIbkrCredentialsInput {
  readonly baseUrl: string;
  readonly sessionToken: string;
  readonly currentClientIds: Readonly<Record<GatewayRuntime, string | undefined>>;
}

export interface ProvisioningClientDependencies {
  readonly fetch?: typeof fetch;
}

export async function provisionIbkrCredentials(
  input: ProvisionIbkrCredentialsInput,
  dependencies: ProvisioningClientDependencies = {}
): Promise<IbkrProvisioningResponse> {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new TypeError("No fetch implementation is available");
  }

  const requestUrl = buildProvisioningUrl(input.baseUrl);
  const requestBody = JSON.stringify({
    credentials: {
      cli: buildCredentialRequest(input.currentClientIds.cli),
      mcp: buildCredentialRequest(input.currentClientIds.mcp),
    },
  });

  let response: Response;
  try {
    response = await fetcher(requestUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.sessionToken}`,
        "content-type": "application/json",
      },
      body: requestBody,
      redirect: "error",
    });
  } catch {
    throw new Error("IBKR credential provisioning service failure");
  }

  if (response.status !== 200) {
    await cancelResponseBody(response);
    throw new Error(messageForStatus(response.status));
  }

  const parsed = parseProvisioningResponse(await readBoundedResponseBody(response));
  validateGatewayUrl(parsed.gatewayUrl, "gatewayUrl", false);
  validateGatewayUrl(parsed.tokenUrl, "tokenUrl", false);

  return parsed;
}

function buildProvisioningUrl(baseUrl: string): string {
  validateGatewayUrl(baseUrl, "baseUrl", false);
  return new URL(ROTATE_PATH, baseUrl).href;
}

function buildCredentialRequest(currentClientId: string | undefined): Record<string, string> {
  if (currentClientId === undefined) {
    return {};
  }

  if (!CLIENT_ID_PATTERN.test(currentClientId)) {
    throw new Error("IBKR credential provisioning request rejected");
  }

  return { currentClientId };
}

function parseProvisioningResponse(body: string): IbkrProvisioningResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("IBKR credential provisioning response is invalid");
  }

  const result = provisioningResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("IBKR credential provisioning response is invalid");
  }

  return {
    gatewayUrl: result.data.gatewayUrl,
    tokenUrl: result.data.tokenUrl,
    credentials: {
      cli: result.data.credentials.cli,
      mcp: result.data.credentials.mcp,
    },
  };
}

function messageForStatus(status: number): string {
  if (status === 401) {
    return "IBKR credential provisioning authentication required";
  }
  if (status === 403) {
    return "IBKR credential provisioning not authorized";
  }
  if (status === 400 || status === 422) {
    return "IBKR credential provisioning request rejected";
  }
  return "IBKR credential provisioning service failure";
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup must not replace the provisioning failure.
  }
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    if (response.body === null) {
      return "";
    }

    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    for (;;) {
      const item = await reader.read();
      if (item.done) {
        break;
      }
      if (!(item.value instanceof Uint8Array)) {
        throw new TypeError("Invalid response stream chunk");
      }
      totalLength += item.value.byteLength;
      if (totalLength > PROVISIONING_RESPONSE_LIMIT_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation must not replace the bounded response failure.
        }
        throw new Error("IBKR credential provisioning response is invalid");
      }
      chunks.push(item.value);
    }

    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === "IBKR credential provisioning response is invalid"
    ) {
      throw error;
    }
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation must not replace the bounded response failure.
      }
    }
    throw new Error("IBKR credential provisioning response is invalid", { cause: error });
  } finally {
    if (reader !== undefined) {
      try {
        reader.releaseLock();
      } catch {
        // Reader cleanup must stay private.
      }
    }
  }
}
