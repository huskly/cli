/**
 * Shared formatting utilities for CLI output
 */

/**
 * Format a number with locale-specific formatting and fixed decimal places.
 * Returns "-" for undefined values.
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a large number with K/M/B/T suffixes.
 * Returns "-" for undefined values.
 */
export function formatLargeNumber(value: number | null | undefined): string {
  if (value === undefined || value === null) return "-";
  if (value >= 1_000_000_000_000) return (value / 1_000_000_000_000).toFixed(2) + "T";
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(2) + "K";
  return value.toFixed(2);
}

/**
 * Format a volume number with K/M/B suffixes.
 * Returns "-" for undefined values.
 */
export function formatVolume(value: number | null | undefined): string {
  if (value === undefined || value === null) return "-";
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(2) + "K";
  return value.toFixed(0);
}
export interface FractionDigits {
  readonly minimum: number;
  readonly maximum: number;
}

/**
 * Format an amount in one ISO 4217 currency, for example `¥3,681` or `$12.50`.
 * Returns "-" for missing values.
 *
 * @remarks
 * Without `fractionDigits` the currency's own minor unit applies, so JPY shows
 * no decimals. Pass `fractionDigits` for a price that needs more precision,
 * such as an FX rate.
 */
export function formatMoney(
  value: number | null | undefined,
  currencyCode: string,
  fractionDigits?: FractionDigits
): string {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: currencyCode,
    ...(fractionDigits === undefined
      ? {}
      : {
          minimumFractionDigits: fractionDigits.minimum,
          maximumFractionDigits: fractionDigits.maximum,
        }),
  });
}

export function currencyFormatUsd(value: number | null | undefined): string {
  return formatMoney(value, "USD");
}

const FOREX_PRICE_DIGITS: FractionDigits = { minimum: 2, maximum: 6 };

/**
 * Format an FX price: the quote-currency amount of one base unit, for example
 * `¥147.255` for USD.JPY. IDEALPRO prices have more decimals than the quote
 * currency's minor unit. Without a known quote currency the price has no symbol.
 */
export function formatForexPrice(
  value: number | null | undefined,
  quoteCurrency: string | null
): string {
  if (value === undefined || value === null) return "-";
  if (quoteCurrency === null)
    return value.toLocaleString("en-US", {
      minimumFractionDigits: FOREX_PRICE_DIGITS.minimum,
      maximumFractionDigits: FOREX_PRICE_DIGITS.maximum,
    });
  return formatMoney(value, quoteCurrency, FOREX_PRICE_DIGITS);
}
