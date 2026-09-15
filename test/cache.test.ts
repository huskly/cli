import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env["REDIS_URL"] = "redis://127.0.0.1:6399";

const {
  cacheFetch,
  cacheGet,
  cacheSet,
  disconnectCache,
  isCacheEnabled,
  setCacheEnabled,
  RedisUnavailableError,
} = await import("#src/cache.js");

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

describe("cache disabled through --no-cache", () => {
  before(() => {
    process.env["LOG_LEVEL"] = "silent";
    setCacheEnabled(false);
  });

  after(() => {
    setCacheEnabled(true);
  });

  it("reads straight through to the broker while Redis is unreachable", async () => {
    let calls = 0;
    const fetchTwice = async (): Promise<number> => {
      calls += 1;
      return Promise.resolve(calls);
    };

    assert.equal(isCacheEnabled(), false);
    assert.equal(await cacheFetch("key", fetchTwice), 1);
    assert.equal(await cacheFetch("key", fetchTwice), 2);
  });

  it("never raises RedisUnavailableError from a cache operation", async () => {
    assert.equal(await cacheGet("missing-key"), null);
    assert.deepEqual(await cacheSet("key", { value: 1 }), { value: 1 });
  });
});

describe("Redis guidance", () => {
  it("points at --no-cache as the escape hatch", () => {
    assert.match(new RedisUnavailableError("redis://x").message, /--no-cache/);
  });
});
