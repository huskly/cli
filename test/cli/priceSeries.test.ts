import assert from "node:assert/strict";
import test from "node:test";
import { closes, toPriceSeriesDto } from "#src/cli/priceSeries.js";

const candle = (datetime: number, close: number) => ({
  datetime,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
});

test("price series DTO summarizes the close series", () => {
  const dto = toPriceSeriesDto("AAPL", 3, [
    candle(0, 100),
    candle(86_400_000, 120),
    candle(172_800_000, 110),
  ]);
  assert.equal(dto.symbol, "AAPL");
  assert.equal(dto.count, 3);
  assert.equal(dto.first, 100);
  assert.equal(dto.latest, 110);
  assert.equal(dto.high, 120);
  assert.equal(dto.low, 100);
  assert.equal(dto.changePercent, 10);
  assert.deepEqual(closes(dto), [100, 120, 110]);
  assert.equal(dto.candles[0]?.time, "1970-01-01T00:00:00.000Z");
});

test("price series DTO reports null statistics for an empty series", () => {
  const dto = toPriceSeriesDto("AAPL", 3, []);
  assert.deepEqual(
    { count: dto.count, first: dto.first, latest: dto.latest, high: dto.high, low: dto.low },
    { count: 0, first: null, latest: null, high: null, low: null }
  );
  assert.equal(dto.changePercent, null);
});
