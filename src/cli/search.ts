import chalk from "chalk";
import { brokerClient } from "./shared.js";
import { formatNumber, formatLargeNumber } from "../format.js";
import {
  isPartialObservation,
  requireObservation,
  type BrokerFundamentalInstrument,
  type BrokerInstrument,
  type BrokerInstrumentSearchProjection,
  type BrokerName,
  type Observation,
} from "#src/brokers/brokerClient.js";

const VALID_PROJECTIONS: BrokerInstrumentSearchProjection[] = [
  "symbol-search",
  "symbol-regex",
  "desc-search",
  "desc-regex",
  "search",
  "fundamental",
];
const IBKR_PROJECTIONS: BrokerInstrumentSearchProjection[] = ["symbol-search", "search"];

function printBasicInstrument(instrument: BrokerInstrument): string[] {
  const lines = [
    `  ${chalk.cyan.bold(instrument.symbol ?? "-")}  ${chalk.white(instrument.description ?? "-")}`,
  ];
  const details: string[] = [];
  if (instrument.exchange) details.push(`Exchange: ${instrument.exchange}`);
  if (instrument.assetType) details.push(`Type: ${instrument.assetType}`);
  if (instrument.cusip) details.push(`CUSIP: ${instrument.cusip}`);
  if (instrument.brokerId) details.push(`ID: ${instrument.brokerId}`);
  if (details.length > 0) {
    lines.push(`    ${chalk.gray(details.join("  |  "))}`);
  }
  return lines;
}

function printFundamentalData(f: BrokerFundamentalInstrument): string[] {
  const lines = [chalk.bold("    Fundamentals:")];
  const valuation: string[] = [];
  if (f.peRatio !== undefined) valuation.push(`P/E: ${formatNumber(f.peRatio)}`);
  if (f.pegRatio !== undefined) valuation.push(`PEG: ${formatNumber(f.pegRatio)}`);
  if (f.pbRatio !== undefined) valuation.push(`P/B: ${formatNumber(f.pbRatio)}`);
  if (f.prRatio !== undefined) valuation.push(`P/S: ${formatNumber(f.prRatio)}`);
  if (f.pcfRatio !== undefined) valuation.push(`P/CF: ${formatNumber(f.pcfRatio)}`);
  if (valuation.length > 0) lines.push(`      ${chalk.gray("Valuation:")} ${valuation.join("  ")}`);

  const market: string[] = [];
  if (f.marketCap !== undefined) market.push(`Mkt Cap: $${formatLargeNumber(f.marketCap)}`);
  if (f.sharesOutstanding !== undefined)
    market.push(`Shares Out: ${formatLargeNumber(f.sharesOutstanding)}`);
  if (f.marketCapFloat !== undefined) market.push(`Float: ${formatLargeNumber(f.marketCapFloat)}`);
  if (market.length > 0) lines.push(`      ${chalk.gray("Market:")} ${market.join("  ")}`);

  const earnings: string[] = [];
  if (f.eps !== undefined) earnings.push(`EPS: $${formatNumber(f.eps)}`);
  if (f.epsTTM !== undefined) earnings.push(`EPS TTM: $${formatNumber(f.epsTTM)}`);
  if (f.epsChangePercentTTM !== undefined)
    earnings.push(`EPS Chg: ${formatNumber(f.epsChangePercentTTM)}%`);
  if (earnings.length > 0) lines.push(`      ${chalk.gray("Earnings:")} ${earnings.join("  ")}`);

  const dividend: string[] = [];
  if (f.dividendYield !== undefined) dividend.push(`Yield: ${formatNumber(f.dividendYield)}%`);
  if (f.dividendAmount !== undefined) dividend.push(`Annual: $${formatNumber(f.dividendAmount)}`);
  if (f.dividendPayAmount !== undefined)
    dividend.push(`Per Share: $${formatNumber(f.dividendPayAmount)}`);
  if (f.dividendFreq !== undefined) dividend.push(`Freq: ${String(f.dividendFreq)}/yr`);
  if (dividend.length > 0) lines.push(`      ${chalk.gray("Dividend:")} ${dividend.join("  ")}`);

  if (f.high52 !== undefined || f.low52 !== undefined) {
    lines.push(
      `      ${chalk.gray("52W Range:")} $${formatNumber(f.low52)} - $${formatNumber(f.high52)}`
    );
  }

  const margins: string[] = [];
  if (f.grossMarginTTM !== undefined) margins.push(`Gross: ${formatNumber(f.grossMarginTTM)}%`);
  if (f.operatingMarginTTM !== undefined)
    margins.push(`Operating: ${formatNumber(f.operatingMarginTTM)}%`);
  if (f.netProfitMarginTTM !== undefined)
    margins.push(`Net: ${formatNumber(f.netProfitMarginTTM)}%`);
  if (margins.length > 0) lines.push(`      ${chalk.gray("Margins (TTM):")} ${margins.join("  ")}`);

  const returns: string[] = [];
  if (f.returnOnEquity !== undefined) returns.push(`ROE: ${formatNumber(f.returnOnEquity)}%`);
  if (f.returnOnAssets !== undefined) returns.push(`ROA: ${formatNumber(f.returnOnAssets)}%`);
  if (f.returnOnInvestment !== undefined)
    returns.push(`ROI: ${formatNumber(f.returnOnInvestment)}%`);
  if (returns.length > 0) lines.push(`      ${chalk.gray("Returns:")} ${returns.join("  ")}`);

  if (f.beta !== undefined) {
    lines.push(`      ${chalk.gray("Beta:")} ${formatNumber(f.beta)}`);
  }

  const shortInfo: string[] = [];
  if (f.shortIntToFloat !== undefined)
    shortInfo.push(`Short % Float: ${formatNumber(f.shortIntToFloat)}%`);
  if (f.shortIntDayToCover !== undefined)
    shortInfo.push(`Days to Cover: ${formatNumber(f.shortIntDayToCover)}`);
  if (shortInfo.length > 0) {
    lines.push(`      ${chalk.gray("Short Interest:")} ${shortInfo.join("  ")}`);
  }
  return lines;
}

function printInstrument(
  instrument: BrokerInstrument,
  projection: BrokerInstrumentSearchProjection
): string[] {
  const lines = [...printBasicInstrument(instrument)];
  if (projection === "fundamental" && instrument.fundamental) {
    lines.push(...printFundamentalData(instrument.fundamental));
  }
  return lines;
}

export interface SearchOptions {
  projection: string;
  json?: boolean;
}

export function renderSearchObservation(
  observation: Observation<BrokerInstrument[]>,
  broker: BrokerName,
  symbol: string,
  options: SearchOptions
): string {
  const projection = options.projection as BrokerInstrumentSearchProjection;
  const safeObservation = requireObservation("searchInstruments", observation);
  if (options.json) {
    return JSON.stringify(safeObservation, null, 2);
  }

  const lines = [chalk.bold("\nInstrument Search\n")];
  if (isPartialObservation(safeObservation)) {
    lines.push(chalk.yellow("Warning: Broker data is partial."));
  }
  lines.push(
    chalk.gray(
      `Searching ${broker.toUpperCase()} for "${symbol}" using ${projection} projection...\n`
    )
  );
  lines.push(chalk.gray("-".repeat(60)));

  if (safeObservation.value.length === 0) {
    lines.push(chalk.yellow(`No instruments found matching "${symbol}"`));
    return lines.join("\n");
  }

  lines.push(chalk.gray(`Found ${String(safeObservation.value.length)} result(s):\n`));
  for (const instrument of safeObservation.value) {
    lines.push(...printInstrument(instrument, projection), "");
  }
  return lines.join("\n").trimEnd();
}

export async function handleSearch(
  broker: BrokerName,
  symbol: string,
  options: SearchOptions
): Promise<void> {
  const projection = options.projection as BrokerInstrumentSearchProjection;

  if (!VALID_PROJECTIONS.includes(projection)) {
    console.error(
      chalk.red(`Invalid projection: ${options.projection}`),
      chalk.gray(`\nValid options: ${VALID_PROJECTIONS.join(", ")}`)
    );
    process.exit(1);
  }

  if (broker === "ibkr" && !IBKR_PROJECTIONS.includes(projection)) {
    throw new Error(
      `IBKR search currently supports only symbol-search/search projections (got '${projection}').`
    );
  }

  const api = await brokerClient(broker);
  console.log(renderSearchObservation(await api.searchInstruments(symbol, projection), broker, symbol, options));
}
