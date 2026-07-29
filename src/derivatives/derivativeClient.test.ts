import test from "node:test";
import assert from "node:assert/strict";
import { createDerivativeDiscoveryResolver } from "./derivativeClient.js";
import type { DerivativeDiscoveryClient } from "./derivativeDiscovery.js";

const fakeClient: DerivativeDiscoveryClient = {
  getExpiries: () => Promise.resolve([]),
  getContracts: () => Promise.resolve([]),
  resolveContract: () => Promise.reject(new Error("not used")),
  getChain: () => Promise.resolve([]),
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
