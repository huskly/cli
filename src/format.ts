/**
 * Shared formatting utilities for CLI output
 */

/**
 * Format a number with locale-specific formatting and fixed decimal places.
 * Returns "-" for undefined values.
 */
export function formatNumber(value: number | undefined, decimals = 2): string {
  if (value === undefined) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a large number with K/M/B/T suffixes.
 * Returns "-" for undefined values.
 */
export function formatLargeNumber(value: number | undefined): string {
  if (value === undefined) return "-";
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
export function formatVolume(value: number | undefined): string {
  if (value === undefined) return "-";
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(2) + "K";
  return value.toFixed(0);
}
export function currencyFormatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
