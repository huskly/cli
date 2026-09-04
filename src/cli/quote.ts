import chalk from "chalk";
import { brokerClient } from "./shared.js";
import { formatNumber, formatVolume } from "../format.js";
import { ensure } from "#src/helpers.js";
import {
  isPartialObservation,
  requireObservation,
  type BrokerName,
  type BrokerQuote,
  type Observation,
} from "#src/brokers/brokerClient.js";

function formatChange(
  change: number | null | undefined,
  percentChange: number | null | undefined
): string {
  if (change === undefined || change === null) return "-";
  const sign = change >= 0 ? "+" : "";
  const pctStr =
    percentChange !== undefined && percentChange !== null
      ? ` (${sign}${percentChange.toFixed(2)}%)`
      : "";
  return sign + formatNumber(change) + pctStr;
}

function getChangeColor(change: number | null | undefined): typeof chalk {
  if (change === undefined || change === null || change === 0) return chalk.white;
  return change > 0 ? chalk.green : chalk.red;
}

function printQuoteLines(quote: BrokerQuote): string[] {
  const q = quote.quote;
  const ref = quote.reference;
  const change = q.netChange;
  const changeColor = getChangeColor(change);
  const lines = [
    `${chalk.cyan.bold(quote.symbol)} ${chalk.gray("·")} ${chalk.white(ref.description ?? "-")}`,
    chalk.gray(`  ${ref.exchangeName ?? ref.exchange ?? "-"}`),
    `  ${chalk.bold("Last:")} ${chalk.white("$" + formatNumber(q.mark ?? q.lastPrice))} ${changeColor(formatChange(change, q.netPercentChange))}`,
  ];

  if (q.bidPrice !== undefined || q.askPrice !== undefined) {
    lines.push(
      `  ${chalk.bold("Bid/Ask:")} $${formatNumber(q.bidPrice)} / $${formatNumber(q.askPrice)}`
    );
  }
  if (q.openPrice !== undefined || q.highPrice !== undefined || q.lowPrice !== undefined) {
    lines.push(
      `  ${chalk.bold("Open:")} $${formatNumber(q.openPrice)}  ${chalk.bold("High:")} $${formatNumber(q.highPrice)}  ${chalk.bold("Low:")} $${formatNumber(q.lowPrice)}`
    );
  }
  if (q.closePrice !== undefined) {
    lines.push(`  ${chalk.bold("Prev Close:")} $${formatNumber(q.closePrice)}`);
  }
  if (q.totalVolume !== undefined) {
    lines.push(`  ${chalk.bold("Volume:")} ${formatVolume(q.totalVolume)}`);
  }
  if (q["52WeekHigh"] !== undefined || q["52WeekLow"] !== undefined) {
    lines.push(
      `  ${chalk.bold("52W Range:")} $${formatNumber(q["52WeekLow"])} - $${formatNumber(q["52WeekHigh"])}`
    );
  }

  const f = quote.fundamental;
  if (f) {
    const fundamentals: string[] = [];
    if (f.peRatio !== undefined && f.peRatio !== null && f.peRatio > 0) {
      fundamentals.push(`P/E: ${formatNumber(f.peRatio)}`);
    }
    if (f.eps !== undefined && f.eps !== null && f.eps !== 0) {
      fundamentals.push(`EPS: $${formatNumber(f.eps)}`);
    }
    if (f.divYield !== undefined && f.divYield !== null && f.divYield > 0) {
      fundamentals.push(`Div Yield: ${formatNumber(f.divYield)}%`);
    }
    if (fundamentals.length > 0) {
      lines.push(`  ${chalk.bold("Fundamentals:")} ${fundamentals.join("  ")}`);
    }
  }

  return lines;
}

export function renderQuoteObservation(
  observation: Observation<Record<string, BrokerQuote>>,
  symbols: string[],
  json = false
): string {
  const safeObservation = requireObservation("getQuotes", observation);
  if (json) {
    return JSON.stringify(safeObservation, null, 2);
  }

  const quotes = safeObservation.value;
  const lines = [chalk.bold("\n📈 Market Quotes\n"), chalk.gray("─".repeat(60))];
  if (isPartialObservation(safeObservation)) {
    lines.push(chalk.yellow("Warning: Broker data is partial."));
  }

  for (const symbol of symbols) {
    try {
      const quote = ensure(
        quotes[symbol] ?? quotes[symbol.toUpperCase()],
        `No quote data available for ${symbol}`
      );
      lines.push(...printQuoteLines(quote), "");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lines.push(`${chalk.cyan(symbol.padEnd(10))} ${chalk.red(message)}`, "");
    }
  }

  return lines.join("\n").trimEnd();
}

export async function handleQuote(
  broker: BrokerName,
  symbols: string[],
  json = false
): Promise<void> {
  const api = await brokerClient(broker);
  console.log(renderQuoteObservation(await api.getQuotes(symbols), symbols, json));
}
