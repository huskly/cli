import chalk from "chalk";
import { brokerClient } from "./shared.js";
import { formatNumber, formatVolume } from "../format.js";
import { ensure } from "#src/helpers.js";
import type { BrokerName, BrokerQuote } from "#src/brokers/brokerClient.js";

function formatChange(change: number | undefined, percentChange: number | undefined): string {
  if (change === undefined) return "-";
  const sign = change >= 0 ? "+" : "";
  const pctStr = percentChange !== undefined ? ` (${sign}${percentChange.toFixed(2)}%)` : "";
  return sign + formatNumber(change) + pctStr;
}

function getChangeColor(change: number | undefined): typeof chalk {
  if (change === undefined || change === 0) return chalk.white;
  return change > 0 ? chalk.green : chalk.red;
}

function printQuote(quote: BrokerQuote): void {
  const q = quote.quote;
  const ref = quote.reference;
  const change = q.netChange;
  const changeColor = getChangeColor(change);

  // Header with symbol and description
  console.log(
    `${chalk.cyan.bold(quote.symbol)} ${chalk.gray("·")} ${chalk.white(ref.description ?? "-")}`
  );
  console.log(chalk.gray(`  ${ref.exchangeName ?? ref.exchange ?? "-"}`));

  // Price and change
  const lastPrice = q.mark ?? q.lastPrice;
  console.log(
    `  ${chalk.bold("Last:")} ${chalk.white("$" + formatNumber(lastPrice))} ` +
      changeColor(formatChange(change, q.netPercentChange))
  );

  // Bid/Ask
  if (q.bidPrice !== undefined || q.askPrice !== undefined) {
    console.log(
      `  ${chalk.bold("Bid/Ask:")} $${formatNumber(q.bidPrice)} / $${formatNumber(q.askPrice)}`
    );
  }

  // Open/High/Low
  if (q.openPrice !== undefined || q.highPrice !== undefined || q.lowPrice !== undefined) {
    console.log(
      `  ${chalk.bold("Open:")} $${formatNumber(q.openPrice)}  ` +
        `${chalk.bold("High:")} $${formatNumber(q.highPrice)}  ` +
        `${chalk.bold("Low:")} $${formatNumber(q.lowPrice)}`
    );
  }

  // Previous close
  if (q.closePrice !== undefined) {
    console.log(`  ${chalk.bold("Prev Close:")} $${formatNumber(q.closePrice)}`);
  }

  // Volume
  if (q.totalVolume !== undefined) {
    console.log(`  ${chalk.bold("Volume:")} ${formatVolume(q.totalVolume)}`);
  }

  // 52-week range
  if (q["52WeekHigh"] !== undefined || q["52WeekLow"] !== undefined) {
    console.log(
      `  ${chalk.bold("52W Range:")} $${formatNumber(q["52WeekLow"])} - $${formatNumber(q["52WeekHigh"])}`
    );
  }

  // Fundamentals (if available)
  const f = quote.fundamental;
  if (f) {
    const fundamentals: string[] = [];
    if (f.peRatio && f.peRatio > 0) fundamentals.push(`P/E: ${formatNumber(f.peRatio)}`);
    if (f.eps && f.eps !== 0) fundamentals.push(`EPS: $${formatNumber(f.eps)}`);
    if (f.divYield && f.divYield > 0) fundamentals.push(`Div Yield: ${formatNumber(f.divYield)}%`);
    if (fundamentals.length > 0) {
      console.log(`  ${chalk.bold("Fundamentals:")} ${fundamentals.join("  ")}`);
    }
  }

  console.log();
}

export async function handleQuote(broker: BrokerName, symbols: string[]): Promise<void> {
  console.log(chalk.bold("\n📈 Market Quotes\n"));
  console.log(chalk.gray("─".repeat(60)));
  const api = await brokerClient(broker);
  const quotes = await api.getQuotes(symbols);

  for (const symbol of symbols) {
    try {
      const quote = ensure(
        quotes[symbol] ?? quotes[symbol.toUpperCase()],
        `No quote data available for ${symbol}`
      );
      printQuote(quote);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${chalk.cyan(symbol.padEnd(10))} ${chalk.red(message)}\n`);
    }
  }
}
