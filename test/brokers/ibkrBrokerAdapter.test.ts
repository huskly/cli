import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IbkrClient } from "@huskly/ibkr-client";
import { IbkrBrokerAdapter } from "#src/brokers/ibkrBrokerAdapter.js";

describe("IbkrBrokerAdapter", () => {
  it("maps upstream balances and positions to the CLI presentation contract", async () => {
    const client = {
      getAccountBalances: () =>
        Promise.resolve({
          netLiquidation: 100_000,
          cashBalance: 10_000,
          availableFunds: 20_000,
          buyingPower: 40_000,
        }),
      getPositions: () =>
        Promise.resolve([
          {
            symbol: "AAPL",
            assetType: "EQUITY",
            longQuantity: 5,
            shortQuantity: 0,
            averagePrice: 200,
            marketPrice: 210,
            marketValue: 1_050,
            currentDayProfitLoss: 25,
            openProfitLoss: 50,
          },
          {
            symbol: "MSTR  260814P00095000",
            assetType: "OPTION",
            longQuantity: 0,
            shortQuantity: 1,
            averagePrice: 2,
            marketPrice: 1.5,
            marketValue: -150,
            currentDayProfitLoss: 10,
            openProfitLoss: 50,
          },
        ]),
    } as unknown as IbkrClient;
    const adapter = new IbkrBrokerAdapter(client);

    assert.deepEqual(await adapter.getAccountBalances(), {
      liquidationValue: 100_000,
      equity: 100_000,
      cashBalance: 10_000,
      availableFunds: 20_000,
      buyingPower: 40_000,
    });
    assert.deepEqual(await adapter.getPositions(), [
      {
        instrument: { symbol: "AAPL", assetType: "EQUITY" },
        longQuantity: 5,
        shortQuantity: 0,
        averagePrice: 200,
        marketValue: 1_050,
        currentDayProfitLoss: 25,
        longOpenProfitLoss: 50,
        shortOpenProfitLoss: 0,
      },
      {
        instrument: { symbol: "MSTR  260814P00095000", assetType: "OPTION" },
        longQuantity: 0,
        shortQuantity: 1,
        averagePrice: 2,
        marketValue: -150,
        currentDayProfitLoss: 10,
        longOpenProfitLoss: 0,
        shortOpenProfitLoss: 50,
      },
    ]);
  });
});
