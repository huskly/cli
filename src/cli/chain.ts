import chalk from "chalk";
import { addDays, format, parse } from "date-fns";
import { apiClient } from "./shared.js";

export async function handleChain(
  symbol: string,
  expiryArg: string | undefined,
  options: { around?: string; strikes: string }
): Promise<void> {
  let expiry: Date;
  const defaultDaysAhead = 30;
  const api = await apiClient();
  if (expiryArg) {
    // Parse as local date to avoid timezone offset issues
    expiry = parse(expiryArg, "yyyy-MM-dd", new Date());
  } else {
    // Default to nearest expiry
    const [exp] = await api.getAvailableExpiries(
      symbol,
      "PUT",
      format(new Date(), "yyyy-MM-dd"),
      format(addDays(new Date(), defaultDaysAhead), "yyyy-MM-dd")
    );
    if (!exp) {
      console.error(chalk.red("No expiries available for this symbol"));
      process.exit(1);
    }
    expiry = exp;
  }

  console.log(chalk.bold(`\n⛓️  Option Chain: ${symbol} ${format(expiry, "yyyy-MM-dd")}\n`));

  const [chain, quotes] = await Promise.all([
    api.getOptionChain(symbol, expiry),
    api.getQuotes([symbol]),
  ]);

  if (chain.length === 0) {
    console.log(chalk.yellow("No options found for this expiry"));
    return;
  }

  // Separate calls and puts
  const calls = chain.filter((o) => o.isCall);
  const puts = chain.filter((o) => !o.isCall);

  // Default to current stock price if --around not specified
  const quoteData = quotes[symbol];
  const currentPrice = quoteData?.quote.mark ?? quoteData?.quote.lastPrice;
  const aroundStrike = options.around ? parseFloat(options.around) : (currentPrice ?? null);
  const strikeCount = parseInt(options.strikes, 10);

  // Get all unique strikes sorted
  const allStrikes = Array.from(new Set(chain.map((o) => o.strike))).sort((a, b) => a - b);

  // Find strikes to display based on aroundStrike and strikeCount
  let strikesToInclude: Set<number>;
  if (aroundStrike) {
    // Find the index of the closest strike to aroundStrike
    const closestIdx = allStrikes.reduce(
      (bestIdx, strike, idx) =>
        Math.abs(strike - aroundStrike) < Math.abs((allStrikes[bestIdx] ?? 0) - aroundStrike)
          ? idx
          : bestIdx,
      0
    );
    const startIdx = Math.max(0, closestIdx - strikeCount);
    const endIdx = Math.min(allStrikes.length, closestIdx + strikeCount + 1);
    strikesToInclude = new Set(allStrikes.slice(startIdx, endIdx));
  } else {
    strikesToInclude = new Set(allStrikes);
  }

  const filteredCalls = calls.filter((o) => strikesToInclude.has(o.strike));
  const filteredPuts = puts.filter((o) => strikesToInclude.has(o.strike));

  // Build a map of strike -> { call, put }
  const strikes = new Set([...filteredCalls, ...filteredPuts].map((o) => o.strike));
  const sortedStrikes = Array.from(strikes).sort((a, b) => a - b);

  const callsByStrike = new Map(filteredCalls.map((c) => [c.strike, c]));
  const putsByStrike = new Map(filteredPuts.map((p) => [p.strike, p]));

  const colWidth = 8;
  const strikeWidth = 10;
  const headerLine =
    chalk.green("Bid".padStart(colWidth)) +
    chalk.green("Ask".padStart(colWidth)) +
    chalk.green("Mid".padStart(colWidth)) +
    chalk.green("Δ".padStart(colWidth)) +
    chalk.white("Strike".padStart(strikeWidth)) +
    chalk.red("Δ".padStart(colWidth)) +
    chalk.red("Mid".padStart(colWidth)) +
    chalk.red("Ask".padStart(colWidth)) +
    chalk.red("Bid".padStart(colWidth));

  const lineWidth = colWidth * 8 + strikeWidth;
  console.log(chalk.gray("─".repeat(lineWidth)));
  console.log(
    chalk.green("CALLS".padStart(colWidth * 2)) +
      " ".repeat(strikeWidth + colWidth * 2) +
      chalk.red("PUTS")
  );
  console.log(chalk.gray("─".repeat(lineWidth)));
  console.log(headerLine);
  console.log(chalk.gray("─".repeat(lineWidth)));

  for (const strike of sortedStrikes) {
    const call = callsByStrike.get(strike);
    const put = putsByStrike.get(strike);

    const formatPrice = (val: number | null): string => (val !== null ? "$" + val.toFixed(2) : "-");
    const formatDelta = (val: number | undefined): string =>
      val !== undefined ? val.toFixed(2) : "-";

    // Determine if options are in-the-money
    const callItm = currentPrice !== undefined && strike < currentPrice;
    const putItm = currentPrice !== undefined && strike > currentPrice;

    // Use brighter colors for ITM options
    const callColor = callItm ? chalk.greenBright : chalk.cyan;
    const putColor = putItm ? chalk.redBright : chalk.cyan;

    const callBid = formatPrice(call?.bid ?? null).padStart(colWidth);
    const callAsk = formatPrice(call?.ask ?? null).padStart(colWidth);
    const callMid = formatPrice(call?.mid ?? null).padStart(colWidth);
    const callDelta = formatDelta(call?.delta).padStart(colWidth);

    const putBid = formatPrice(put?.bid ?? null).padStart(colWidth);
    const putAsk = formatPrice(put?.ask ?? null).padStart(colWidth);
    const putMid = formatPrice(put?.mid ?? null).padStart(colWidth);
    const putDelta = formatDelta(put?.delta).padStart(colWidth);

    const strikeStr = ("$" + strike.toFixed(2)).padStart(strikeWidth);

    console.log(
      callColor(callBid) +
        callColor(callAsk) +
        (callItm ? chalk.yellowBright(callMid) : chalk.yellow(callMid)) +
        chalk.gray(callDelta) +
        chalk.white(strikeStr) +
        chalk.gray(putDelta) +
        (putItm ? chalk.yellowBright(putMid) : chalk.yellow(putMid)) +
        putColor(putAsk) +
        putColor(putBid)
    );
  }

  console.log();
}
