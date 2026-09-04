import { z } from "zod";

const TOKEN_RESPONSE_LIMIT_BYTES = 16 * 1024;
const MAX_ACCESS_TOKEN_LENGTH = 8 * 1024;
const MAX_SCOPE_LENGTH = 1024;
const REFRESH_WINDOW_MS = 60_000;
const RETRY_DELAYS_MS = [100, 200] as const;

const machineTokenResponseSchema = z.strictObject({
  access_token: z.string().min(1).max(MAX_ACCESS_TOKEN_LENGTH),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().gt(60).lte(86_400),
  scope: z.string().min(1).max(MAX_SCOPE_LENGTH),
});

export interface MachineTokenProviderOptions {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly delay?: (ms: number) => Promise<void>;
}

export interface MachineTokenProvider {
  getToken(): Promise<string>;
}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

export function createMachineTokenProvider(
  options: MachineTokenProviderOptions
): MachineTokenProvider {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new TypeError("No fetch implementation is available");
  }

  const now = options.now ?? (() => Date.now());
  const delay =
    options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const authorization = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;

  let cachedToken: CachedToken | undefined;
  let refreshPromise: Promise<string> | undefined;

  return {
    async getToken(): Promise<string> {
      const currentTime = now();
      if (cachedToken !== undefined && currentTime < cachedToken.expiresAt - REFRESH_WINDOW_MS) {
        return cachedToken.token;
      }

      const activeRefresh = refreshPromise ?? startRefresh();
      try {
        return await activeRefresh;
      } catch (error: unknown) {
        if (cachedToken !== undefined && currentTime < cachedToken.expiresAt) {
          return cachedToken.token;
        }
        throw error;
      }
    },
  };

  function startRefresh(): Promise<string> {
    refreshPromise = exchangeToken()
      .then((nextToken) => {
        cachedToken = nextToken;
        return nextToken.token;
      })
      .finally(() => {
        refreshPromise = undefined;
      });
    return refreshPromise;
  }

  async function exchangeToken(): Promise<CachedToken> {
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt += 1) {
      try {
        const response = await fetchToken(fetcher, options.tokenUrl, authorization);

        if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
          await cancelResponseBody(response);
          throw new RetryableExchangeError();
        }

        if (response.status !== 200) {
          await cancelResponseBody(response);
          throw new Error(`Machine token exchange failed with status ${String(response.status)}`);
        }

        const parsed = parseTokenResponse(await readBoundedResponseBody(response));
        return {
          token: parsed.access_token,
          expiresAt: now() + parsed.expires_in * 1000,
        };
      } catch (error: unknown) {
        if (attempt < RETRY_DELAYS_MS.length && isRetryableExchangeFailure(error)) {
          const retryDelay = RETRY_DELAYS_MS[attempt];
          if (retryDelay === undefined) {
            throw new Error("Machine token exchange failed", { cause: error });
          }
          await delay(retryDelay);
          continue;
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error("Machine token exchange failed", { cause: error });
      }
    }

    throw new Error("Machine token exchange failed");
  }
}

class RetryableExchangeError extends Error {
  constructor() {
    super("Machine token exchange failed");
  }
}

function isRetryableExchangeFailure(error: unknown): boolean {
  return error instanceof RetryableExchangeError;
}

async function fetchToken(
  fetcher: typeof fetch,
  tokenUrl: string,
  authorization: string
): Promise<Response> {
  try {
    return await fetcher(tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization,
      },
      redirect: "error",
    });
  } catch {
    throw new RetryableExchangeError();
  }
}

function parseTokenResponse(body: string): z.infer<typeof machineTokenResponseSchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("Machine token response is invalid");
  }

  const result = machineTokenResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Machine token response is invalid");
  }

  return result.data;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup must not replace the exchange failure.
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
      if (totalLength > TOKEN_RESPONSE_LIMIT_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation must not replace the bounded response failure.
        }
        throw new Error("Machine token response is invalid");
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
    if (error instanceof Error && error.message === "Machine token response is invalid") {
      throw error;
    }
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation must not replace the bounded response failure.
      }
    }
    throw new Error("Machine token response is invalid", { cause: error });
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
