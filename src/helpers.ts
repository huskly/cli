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

/**
 * IBKR asset-class codes -> human-readable type labels.
 * Mirrors the labels Schwab uses (EQUITY, OPTION, ...) so the shared positions
 * handler renders both brokers consistently.
 */
export const ASSET_CLASS_LABELS: Record<string, string> = {
  STK: "EQUITY",
  OPT: "OPTION",
  FOP: "FUTURES OPTION",
  FUT: "FUTURE",
  FUND: "COLLECTIVE_INVESTMENT",
  BOND: "BOND",
  WAR: "WARRANT",
  CASH: "FOREX",
  CFD: "CFD",
};

/** Coerce an unknown (string | number | null) into a number, defaulting to 0. */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function ensureFloat(value: unknown, message?: string): number {
  const actualValue = ensure(value, message);
  const num = typeof actualValue === "number" ? actualValue : parseFloat(String(actualValue));
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid float value "${String(actualValue)}". Must be a positive number.`);
  }
  return num;
}

export function calculateCagr(startEquity: number, finalEquity: number, years: number): number {
  if (years <= 0 || startEquity <= 0) return 0;
  return (Math.pow(finalEquity / startEquity, 1 / years) - 1) * 100;
}

const MONTH_ABBREVS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function parseOccSymbol(occSymbol: string): string {
  // OCC format: ROOT(6 chars padded) + YYMMDD + C/P + Strike(8 digits, 3 implied decimals)
  // Example: "AAPL  251219C00195000" -> "AAPL Dec 19 $195 C"
  const trimmed = occSymbol.replace(/\s+/g, "");
  const match = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(trimmed);
  if (!match) return occSymbol;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const root = match[1]!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const expDate = match[2]!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const optionType = match[3]!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const strikeStr = match[4]!;
  const month = parseInt(expDate.slice(2, 4), 10) - 1;
  const day = parseInt(expDate.slice(4, 6), 10);
  const strike = parseInt(strikeStr, 10) / 1000;
  const year = 2000 + parseInt(expDate.slice(0, 2), 10);

  const monthAbbrev = MONTH_ABBREVS[month] ?? "???";
  const strikeFormatted = strike % 1 === 0 ? String(strike) : strike.toFixed(2);

  return `${root} ${monthAbbrev} ${String(day)} ${String(year)} ${strikeFormatted} ${optionType}`;
}
