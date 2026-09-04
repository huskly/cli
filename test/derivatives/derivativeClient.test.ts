import test from "node:test";
import assert from "node:assert/strict";
import { observe } from "#src/brokers/brokerClient.js";
import { createDerivativeDiscoveryResolver } from "#src/derivatives/derivativeClient.js";
import type { DerivativeDiscoveryClient } from "#src/derivatives/derivativeDiscovery.js";

const fakeClient: DerivativeDiscoveryClient = {
  getExpiries: () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z")),
  getContracts: () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z")),
  resolveContract: () => Promise.reject(new Error("not used")),
  getChain: () => Promise.resolve(observe([], "empty", "2026-07-29T12:00:00.000Z")),
  getReferenceQuote: () => Promise.reject(new Error("not used")),
};

void test("capability resolver initializes IBKR once and rejects unsupported brokers explicitly", async () => {
  let creates = 0;
  const resolve = createDerivativeDiscoveryResolver({
    ibkr: () => {
      creates += 1;
      return Promise.resolve(fakeClient);
    },
  });

  const [first, second] = await Promise.all([resolve("ibkr"), resolve("ibkr")]);
  assert.equal(first, fakeClient);
  assert.equal(second, fakeClient);
  assert.equal(creates, 1);
  await assert.rejects(() => resolve("schwab"), /not implemented for broker 'schwab'/);
});
