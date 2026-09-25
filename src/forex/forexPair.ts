/** One spot FX pair in IBKR `BASE.QUOTE` form. */
export interface ForexPair {
  readonly base: string;
  readonly quote: string;
  /** The IBKR pair name, for example `USD.JPY`. */
  readonly pair: string;
}

const pairForms = [
  /^(?<base>[A-Z]{3})\.(?<quote>[A-Z]{3})$/u,
  /^(?<base>[A-Z]{3})\/(?<quote>[A-Z]{3})$/u,
  /^(?<base>[A-Z]{3})(?<quote>[A-Z]{3})$/u,
];

/**
 * Parse one spot FX pair and normalize it to `BASE.QUOTE`.
 *
 * @remarks
 * Accepts `USD.JPY`, `USD/JPY`, and `USDJPY`, in any letter case. Each side
 * must be a three-letter currency code, and the two sides must differ.
 *
 * @example
 * parseForexPair("usd/jpy"); // { base: "USD", quote: "JPY", pair: "USD.JPY" }
 */
export function parseForexPair(value: string): ForexPair {
  const text = value.trim().toUpperCase();
  for (const form of pairForms) {
    const groups = form.exec(text)?.groups;
    const base = groups?.["base"];
    const quote = groups?.["quote"];
    if (base === undefined || quote === undefined) continue;
    if (base === quote) throw new Error(`Invalid FX pair '${value}': base and quote are the same.`);
    return { base, quote, pair: `${base}.${quote}` };
  }
  throw new Error(`Invalid FX pair '${value}'. Expected BASE.QUOTE, for example USD.JPY.`);
}
