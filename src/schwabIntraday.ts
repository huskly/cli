import type { PriceHistoryCandle } from "@huskly/schwab-client";

const SCHWAB_API_BASE_URL = "https://api.schwabapi.com";

/**
 * Fetch intraday (minute-level) price candles for a symbol for the current
 * trading day.
 *
 * The published `@huskly/schwab-client` `getPriceHistory` is hard-coded to
 * daily candles and its low-level request helper is private, so this calls the
 * Schwab pricehistory endpoint directly, reusing an access token obtained via
 * {@link HusklyDeviceAuth.getAccessToken}.
 *
 * @param accessToken - A valid Schwab API access token (Bearer).
 * @param symbol - Equity/ETF/index symbol (intraday is not available for options).
 * @param frequencyMinutes - Bar size in minutes (1, 5, 10, 15, 30). Defaults to 1.
 * @returns Candles sorted ascending by datetime, or an empty array.
 */
export async function getIntradayCandles(
  accessToken: string,
  symbol: string,
  frequencyMinutes = 1
): Promise<PriceHistoryCandle[]> {
  const params = new URLSearchParams({
    symbol,
    periodType: "day",
    period: "1",
    frequencyType: "minute",
    frequency: String(frequencyMinutes),
    needExtendedHoursData: "false",
  });
  const res = await fetch(
    `${SCHWAB_API_BASE_URL}/marketdata/v1/pricehistory?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch intraday history for ${symbol}: ${String(res.status)} ${res.statusText}`
    );
  }
  const data = (await res.json()) as { empty?: boolean; candles?: PriceHistoryCandle[] };
  if (data.empty === true || data.candles === undefined) {
    return [];
  }
  return data.candles.sort((a, b) => a.datetime - b.datetime);
}
