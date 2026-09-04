import assert from "node:assert/strict";
import test from "node:test";
import type { CachedSchwabClient } from "#src/cachedSchwabClient.js";
import { SchwabBrokerAdapter } from "#src/brokers/schwabBrokerAdapter.js";

test("SchwabBrokerAdapter wraps bare Schwab values as unspecified observations", async () => {
  const client = {
    getAccountBalances: () => Promise.resolve({ liquidationValue: 1, cashBalance: 2, availableFunds: 3, buyingPower: 4, equity: 5 }),
    getPositions: () => Promise.resolve([{ instrument: { assetType: "EQUITY", symbol: "AAPL" }, longQuantity: 1, shortQuantity: 0, averagePrice: 2, marketValue: 3, currentDayProfitLoss: 4, longOpenProfitLoss: 5, shortOpenProfitLoss: 0 }]),
    getQuotes: () => Promise.resolve({ AAPL: { symbol: "AAPL", reference: {}, quote: {} } }),
    searchInstruments: () => Promise.resolve([{ symbol: "AAPL" }]),
    fetchTransactionHistory: () => Promise.resolve([{ accountNumber: "acct", transactions: [] }]),
    fetchOrders: () => Promise.resolve([{ accountNumber: "acct", orders: [] }]),
  } as unknown as CachedSchwabClient;
  const adapter = new SchwabBrokerAdapter(client);

  for (const observation of [
    await adapter.getAccountBalances(),
    await adapter.getPositions(),
    await adapter.getQuotes(["AAPL"]),
    await adapter.searchInstruments("AAPL", "symbol-search"),
    await adapter.fetchTransactionHistory(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-02T00:00:00Z")),
    await adapter.fetchOrders({ fromEnteredTime: new Date("2026-01-01T00:00:00Z"), toEnteredTime: new Date("2026-01-02T00:00:00Z") }),
  ]) {
    assert.equal(observation.observedAt, null);
    assert.equal(observation.completeness, "unspecified");
  }
});
