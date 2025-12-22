import { Redis } from "ioredis";
import { logger } from "#src/logger.js";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export const CACHE_DURATION = 5 * 60; // 5 minutes in seconds

let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  client.on("error", (err: unknown) => {
    logger.error({ err }, "Redis client error");
  });

  redisClient = client;
  return client;
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
    logger.error({ error, key }, "Cache set error");
    return data;
  }
}

export async function cacheRemove(key: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.del(key);
  } catch (error) {
    logger.error({ error, key }, "Cache remove error");
  }
}

export async function clearCache(): Promise<void> {
  try {
    const client = getRedisClient();
    await client.flushdb();
  } catch (error) {
    logger.error({ error }, "Cache clear error");
  }
}

export async function disconnectCache(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
