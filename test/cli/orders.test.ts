import assert from "node:assert/strict";
import test from "node:test";
import { renderOrdersObservation } from "#src/cli/orders.js";
import { fetchOrderContractQuotes, formatOrderCurrentPrice } from "#src/cli/orderContractQuotes.js";
import type { BrokerAccountOrders, Observation } from "#src/brokers/brokerClient.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};
const fromDate = new Date("2026-01-01T00:00:00Z");
const toDate = new Date("2026-01-31T00:00:00Z");

test("orders renderer reports a true empty result", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      { observedAt: "2026-09-04T00:00:00.000Z", completeness: "empty", value: [] },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );
  assert.match(output, /No IBKR accounts found/);
});

test("orders renderer warns on partial data and shows missing numeric evidence", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "partial",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "WORKING",
                orderType: "LMT",
                quantity: null,
                filledQuantity: null,
                price: null,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "BUY" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );
  assert.match(output, /Warning: Broker data is partial/);
  assert.match(output, /AAPL/);
  assert.match(output, /\s-\s+\s-\s+\s-/);
});

test("orders renderer shows the stop price when the regular price is null", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "available",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "PRE_SUBMITTED",
                orderType: "STOP",
                quantity: 100,
                filledQuantity: 0,
                price: null,
                stopPrice: 42.5,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "SELL" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );

  assert.match(output, /Stop: \$42\.50/);
});

test("orders renderer shows separate time-in-force and session columns", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "available",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-03T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                tif: "GTC",
                session: "OVERNIGHT",
                quantity: 10,
                filledQuantity: 0,
                price: 42.5,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "BUY" }],
              },
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                tif: "DAY",
                session: "REGULAR",
                quantity: 5,
                filledQuantity: 0,
                price: 40,
                orderLegCollection: [{ instrument: { symbol: "MSFT" }, instruction: "SELL" }],
              },
              {
                enteredTime: "2026-01-01T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                tif: "IOC",
                session: "UNKNOWN",
                quantity: 1,
                filledQuantity: 0,
                price: 10,
                orderLegCollection: [{ instrument: { symbol: "NVDA" }, instruction: "BUY" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );

  assert.match(output, /Type\s+TIF\s+Session\s+Symbol/);
  assert.match(output, /LIMIT\s+GTC\s+OVERNIGHT\s+AAPL/);
  assert.match(output, /AAPL \(unresolved\)\s+BUY\s+10\s+\$42\.50\s+-\s+0/);
  assert.match(output, /LIMIT\s+DAY\s+REGULAR\s+MSFT/);
  assert.match(output, /LIMIT\s+IOC\s+-\s+NVDA/);
});

test("orders renderer shows dashes for missing order timing evidence", () => {
  const output = stripAnsi(
    renderOrdersObservation(
      {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "available",
        value: [
          {
            accountNumber: "acct",
            orders: [
              {
                enteredTime: "2026-01-02T12:00:00Z",
                status: "WORKING",
                orderType: "LIMIT",
                quantity: 1,
                filledQuantity: 0,
                price: 10,
                orderLegCollection: [{ instrument: { symbol: "AAPL" }, instruction: "BUY" }],
              },
            ],
          },
        ],
      },
      "ibkr",
      fromDate,
      toDate,
      {}
    )
  );

  assert.match(output, /LIMIT\s+-\s+-\s+AAPL/);
});

const optionOrders: Observation<BrokerAccountOrders[]> = {
  observedAt: "2026-09-23T12:30:00.000Z",
  completeness: "available",
  value: [
    {
      orders: [
        {
          orderId: "1",
          status: "SUBMITTED",
          orderType: "LIMIT",
          price: 0.96,
          orderLegCollection: [
            {
              instrument: { symbol: "IBIT" },
              instruction: "SELL",
              brokerId: 101,
              assetClass: "OPT",
              ratio: -1,
              option: {
                symbol: "IBIT  260925C00047000",
                underlying: "IBIT",
                expiration: "2026-09-25",
                strike: 47,
                right: "C",
                tradingClass: "IBIT",
                exchange: "SMART",
                multiplier: 100,
              },
            },
          ],
        },
        {
          orderId: "2",
          status: "SUBMITTED",
          orderType: "LIMIT",
          price: -8.55,
          orderLegCollection: [
            {
              instrument: { symbol: "SPX" },
              instruction: "BUY",
              brokerId: 201,
              assetClass: "OPT",
              ratio: 1,
              option: {
                symbol: "SPXW  260925C06000000",
                underlying: "SPX",
                expiration: "2026-09-25",
                strike: 6000,
                right: "C",
                tradingClass: "SPXW",
                exchange: "SMART",
                multiplier: 100,
              },
            },
            {
              instrument: { symbol: "SPX" },
              instruction: "SELL",
              brokerId: 202,
              assetClass: "OPT",
              ratio: -1,
              option: {
                symbol: "SPXW  260925C06010000",
                underlying: "SPX",
                expiration: "2026-09-25",
                strike: 6010,
                right: "C",
                tradingClass: "SPXW",
                exchange: "SMART",
                multiplier: 100,
              },
            },
          ],
        },
        {
          orderId: "3",
          status: "FILLED",
          orderType: "LIMIT",
          price: 0.53,
          orderLegCollection: [
            {
              instrument: { symbol: "IBIT" },
              brokerId: 101,
              assetClass: "OPT",
              ratio: -1,
              option: {
                symbol: "IBIT  260925C00047000",
                underlying: "IBIT",
                expiration: "2026-09-25",
                strike: 47,
                right: "C",
                tradingClass: "IBIT",
                exchange: "SMART",
                multiplier: 100,
              },
            },
          ],
        },
        {
          orderId: "4",
          status: "PreSubmitted",
          orderType: "STOP",
          stopPrice: 21.4,
          orderLegCollection: [
            {
              instrument: { symbol: "SPX" },
              brokerId: null,
              assetClass: null,
              ratio: null,
              option: null,
            },
          ],
        },
      ],
    },
  ],
};

test("IBKR option orders show exact contract and net option marks, not underlying prices", async () => {
  const calls: number[][] = [];
  const snapshot = await fetchOrderContractQuotes(
    {
      getOrderContractQuotes: (brokerIds) => {
        calls.push(brokerIds);
        return Promise.resolve({
          observedAt: "2026-09-23T12:30:00.000Z",
          completeness: "available",
          value: [
            { brokerId: 101, bid: 1, ask: 1.2, mark: 1.1, availability: "live", timestamp: null },
            { brokerId: 201, bid: 10, ask: 11, mark: 10, availability: "delayed", timestamp: null },
            {
              brokerId: 202,
              bid: 18,
              ask: 19,
              mark: 18.5,
              availability: "delayed",
              timestamp: null,
            },
          ],
        });
      },
    },
    optionOrders
  );
  assert.deepEqual(calls, [[101, 201, 202]]);
  const output = stripAnsi(
    renderOrdersObservation(optionOrders, "ibkr", fromDate, toDate, {}, snapshot)
  );
  assert.match(output, /IBIT {2}260925C00047000.*\$0\.96\s+\$1\.10/);
  assert.match(output, /SPXW {2}260925C06000000.*-\$8\.55\s+Indicative -\$8\.50 \(delayed\)/);
  assert.match(output, /SPXW {2}260925C06010000/);
  assert.match(output, /IBIT {2}260925C00047000.*\$0\.53\s+-/);
  assert.match(output, /SPX \(unresolved\)/);
  assert.doesNotMatch(output, /\$7,729\.25|\$47\.95/);
});

test("verified equities use exact IDs and missing option quotes leave orders visible", async () => {
  const stock: Observation<BrokerAccountOrders[]> = {
    observedAt: null,
    completeness: "available",
    value: [
      {
        orders: [
          {
            status: "PRE_SUBMITTED",
            orderType: "STOP",
            stopPrice: 20.19,
            orderLegCollection: [
              { instrument: { symbol: "PFFA" }, assetClass: "STK", brokerId: 501, ratio: -1 },
            ],
          },
        ],
      },
    ],
  };
  const requested: number[][] = [];
  const snapshot = await fetchOrderContractQuotes(
    {
      getOrderContractQuotes: (ids) => {
        requested.push(ids);
        return Promise.resolve({ observedAt: null, completeness: "partial", value: [] });
      },
    },
    stock
  );
  assert.deepEqual(requested, [[501]]);
  const output = stripAnsi(renderOrdersObservation(stock, "ibkr", fromDate, toDate, {}, snapshot));
  assert.match(output, /PFFA\s+SELL|PFFA\s+-/);
  assert.match(output, /Warning: Some current contract quotes are unavailable/);
  assert.match(output, /Stop: \$20\.19\s+-/);
});

test("an incomplete spread does not produce a plausible net price", () => {
  const order = optionOrders.value[0]?.orders[1];
  assert.ok(order);
  assert.equal(
    formatOrderCurrentPrice(order, {
      quotes: new Map([
        [201, { brokerId: 201, bid: 10, ask: 11, mark: 10, availability: "live", timestamp: null }],
      ]),
    }),
    "-"
  );
  const differentMultiplier = {
    ...order,
    orderLegCollection: (order.orderLegCollection ?? []).map((leg, index) =>
      index === 1 ? { ...leg, option: leg.option ? { ...leg.option, multiplier: 50 } : null } : leg
    ),
  };
  assert.equal(formatOrderCurrentPrice(differentMultiplier, { quotes: new Map() }), "-");
});

test("Schwab columns stay unchanged and IBKR JSON preserves contract fields", () => {
  const schwab = stripAnsi(renderOrdersObservation(optionOrders, "schwab", fromDate, toDate, {}));
  assert.match(schwab, /Price\s+Filled/);
  assert.doesNotMatch(schwab, /Current/);
  const json = JSON.parse(
    renderOrdersObservation(optionOrders, "ibkr", fromDate, toDate, { json: true })
  ) as Observation<BrokerAccountOrders[]>;
  assert.equal(
    json.value[0]?.orders[0]?.orderLegCollection?.[0]?.option?.symbol,
    "IBIT  260925C00047000"
  );
});

test("a claimed option symbol without a verified contract ID stays unresolved", () => {
  const original = optionOrders.value[0]?.orders[0];
  assert.ok(original);
  const unsafe = {
    ...original,
    orderLegCollection: (original.orderLegCollection ?? []).map((leg) => ({
      ...leg,
      brokerId: null,
    })),
  };
  const observation: Observation<BrokerAccountOrders[]> = {
    observedAt: null,
    completeness: "partial",
    value: [{ orders: [unsafe] }],
  };
  const snapshot = {
    quotes: new Map([
      [
        101,
        {
          brokerId: 101,
          bid: 1,
          ask: 2,
          mark: 1.5,
          availability: "live" as const,
          timestamp: null,
        },
      ],
    ]),
  };
  const output = stripAnsi(
    renderOrdersObservation(observation, "ibkr", fromDate, toDate, {}, snapshot)
  );
  assert.match(output, /IBIT \(unresolved\)/);
  assert.doesNotMatch(output, /260925C00047000|\$1\.50/);
});

test("a long unresolved contract name remains fully visible", () => {
  const order = optionOrders.value[0]?.orders[0];
  assert.ok(order);
  const raw = "IBIT  260925C00047000";
  const observation: Observation<BrokerAccountOrders[]> = {
    observedAt: null,
    completeness: "partial",
    value: [
      {
        orders: [
          {
            ...order,
            orderLegCollection: [
              {
                instrument: { symbol: raw },
                assetClass: null,
                brokerId: null,
                ratio: null,
                option: null,
              },
            ],
          },
        ],
      },
    ],
  };
  const output = stripAnsi(renderOrdersObservation(observation, "ibkr", fromDate, toDate, {}));
  assert.match(output, /↳ IBIT {2}260925C00047000 \(unresolved\)/);
});
