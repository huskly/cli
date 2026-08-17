import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env["REDIS_URL"] = "redis://127.0.0.1:6399";

const { cacheGet, cacheSet, disconnectCache, RedisUnavailableError } =
  await import("#src/cache.js");

describe("cache with Redis unavailable", () => {
  before(() => {
    process.env["LOG_LEVEL"] = "silent";
  });

  after(async () => {
    await disconnectCache();
  });

  it("throws RedisUnavailableError instead of retrying forever", async () => {
    await assert.rejects(() => cacheGet("missing-key"), RedisUnavailableError);
  });

  it("reports the configured Redis URL in the message", async () => {
    await assert.rejects(
      () => cacheSet("key", { value: 1 }),
      (error: unknown) =>
        error instanceof RedisUnavailableError &&
        error.message.includes("redis://127.0.0.1:6399") &&
        error.message.includes("Start Redis")
    );
  });
});
