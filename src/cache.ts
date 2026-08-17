import { Redis } from "ioredis";
import { logger } from "#src/logger.js";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export const CACHE_DURATION = 5 * 60; // 5 minutes in seconds

let redisClient: Redis | null = null;

/** Give up quickly instead of reconnecting forever when Redis is down. */
const MAX_CONNECTION_ATTEMPTS = 3;

/** Raised when Redis cannot be reached, so the CLI can exit with clear advice. */
export class RedisUnavailableError extends Error {
  constructor(readonly redisUrl: string) {
    super(`Cannot connect to Redis at ${redisUrl}. Start Redis and try the command again.`);
    this.name = "RedisUnavailableError";
  }
}

function redisUrl(): string {
  return process.env["REDIS_URL"] ?? "redis://localhost:6379";
}

/** True when the error means the server is unreachable, not a command failure. */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") return true;
  return /connection is closed|enotfound|econnrefused|max retries/i.test(error.message);
}

function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  const url = redisUrl();
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: MAX_CONNECTION_ATTEMPTS,
    retryStrategy: (attempt: number) =>
      attempt > MAX_CONNECTION_ATTEMPTS ? null : Math.min(attempt * 100, 500),
  });

  client.on("error", (err: unknown) => {
    // Connection failures surface once through RedisUnavailableError; logging
    // every reconnect attempt only floods the terminal.
    if (isConnectionError(err)) {
      logger.debug({ err }, "Redis connection error");
      return;
    }
    logger.error({ err }, "Redis client error");
  });

  redisClient = client;
  return client;
}

/**
 * Rethrow unreachable-Redis failures as {@link RedisUnavailableError}; other
 * cache errors stay non-fatal so commands can still serve uncached data.
 */
function rethrowIfUnavailable(error: unknown): void {
  if (isConnectionError(error)) {
    throw new RedisUnavailableError(redisUrl());
  }
}

export async function cacheFetch<T>(
  key: string,
  fetchFunction: () => Promise<T>,
  expirationInSeconds: number = CACHE_DURATION
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    logger.debug({ key, cached }, "Cache hit");
    return cached;
  }

  logger.debug({ key }, "Cache miss");
  const result = await fetchFunction();
  await cacheSet(key, result, expirationInSeconds);
  return result;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    const cached = await client.get(key);
    if (!cached) return null;

    const entry = JSON.parse(cached) as CacheEntry<T>;
    const now = Math.floor(Date.now() / 1000);

    if (now >= entry.expiresAt) {
      await cacheRemove(key);
      return null;
    }

    return entry.data;
  } catch (error) {
    rethrowIfUnavailable(error);
    logger.error({ error, key }, "Cache get error");
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  data: T,
  expirationInSeconds = CACHE_DURATION
): Promise<T> {
  try {
    const client = getRedisClient();
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Math.floor(Date.now() / 1000) + expirationInSeconds,
    };
    // Use Redis TTL for automatic expiration
    await client.set(key, JSON.stringify(entry), "EX", expirationInSeconds);
    return data;
  } catch (error) {
    rethrowIfUnavailable(error);
    logger.error({ error, key }, "Cache set error");
    return data;
  }
}

export async function cacheRemove(key: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.del(key);
  } catch (error) {
    rethrowIfUnavailable(error);
    logger.error({ error, key }, "Cache remove error");
  }
}

export async function clearCache(): Promise<void> {
  try {
    const client = getRedisClient();
    await client.flushdb();
  } catch (error) {
    rethrowIfUnavailable(error);
    logger.error({ error }, "Cache clear error");
  }
}

export async function disconnectCache(): Promise<void> {
  if (!redisClient) return;
  const client = redisClient;
  redisClient = null;
  try {
    await client.quit();
  } catch (error) {
    // A never-connected or already-closed client rejects here; nothing to clean.
    logger.debug({ error }, "Redis disconnect error");
    client.disconnect();
  }
}
