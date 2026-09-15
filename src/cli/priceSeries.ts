import type { PriceHistoryCandle } from "@huskly/schwab-client";

export interface PriceSeriesCandleDto {
  readonly time: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface PriceSeriesDto {
  readonly symbol: string;
  readonly days: number;
  readonly count: number;
  readonly first: number | null;
  readonly latest: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly changePercent: number | null;
  readonly candles: readonly PriceSeriesCandleDto[];
}

/**
 * Summarize daily candles into the stable DTO shared by `history` and `chart`.
 *
 * @remarks
 * Both commands read the same series and derive the same statistics, so the
 * summary lives here instead of being duplicated in each renderer.
 */
export function toPriceSeriesDto(
  symbol: string,
  days: number,
  candles: readonly PriceHistoryCandle[]
): PriceSeriesDto {
  const closes = candles.map((candle) => candle.close);
  const first = closes[0] ?? null;
  const latest = closes[closes.length - 1] ?? null;
  const changePercent =
    first === null || latest === null || first === 0 ? null : ((latest - first) / first) * 100;
  return {
    symbol,
    days,
    count: candles.length,
    first,
    latest,
    high: closes.length === 0 ? null : Math.max(...closes),
    low: closes.length === 0 ? null : Math.min(...closes),
    changePercent,
    candles: candles.map((candle) => ({
      time: new Date(candle.datetime).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })),
  };
}

/** The close series, which every text renderer plots. */
export function closes(dto: PriceSeriesDto): number[] {
  return dto.candles.map((candle) => candle.close);
}
