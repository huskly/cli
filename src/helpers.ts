export function simpleSma(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(values.length - window);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / window;
}

export function ensure<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "Expected value to be non-null/non-undefined");
  }
  return value;
}

export function ensureFloat(value: unknown, message?: string): number {
  const actualValue = ensure(value, message);
  const num = typeof actualValue === "number" ? actualValue : parseFloat(String(actualValue));
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid float value "${String(actualValue)}". Must be a positive number.`);
  }
  return num;
}

export function currencyFormatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function calculateCagr(startEquity: number, finalEquity: number, years: number): number {
  if (years <= 0 || startEquity <= 0) return 0;
  return (Math.pow(finalEquity / startEquity, 1 / years) - 1) * 100;
}
