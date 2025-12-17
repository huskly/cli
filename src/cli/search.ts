import chalk from "chalk";
import { apiClient } from "./shared.js";
import { formatNumber, formatLargeNumber } from "../format.js";
import type {
  SchwabInstrumentSearchProjection,
  SchwabInstrumentResponse,
  SchwabFundamentalInstrument,
} from "#src/types.js";

const VALID_PROJECTIONS: SchwabInstrumentSearchProjection[] = [
  "symbol-search",
  "symbol-regex",
  "desc-search",
  "desc-regex",
  "search",
  "fundamental",
];

function printBasicInstrument(instrument: SchwabInstrumentResponse): void {
  console.log(
    `  ${chalk.cyan.bold(instrument.symbol ?? "-")}  ${chalk.white(instrument.description ?? "-")}`
  );
  const details: string[] = [];
  if (instrument.exchange) details.push(`Exchange: ${instrument.exchange}`);
  if (instrument.assetType) details.push(`Type: ${instrument.assetType}`);
  if (instrument.cusip) details.push(`CUSIP: ${instrument.cusip}`);
  if (details.length > 0) {
    console.log(`    ${chalk.gray(details.join("  |  "))}`);
  }
}

function printFundamentalData(f: SchwabFundamentalInstrument): void {
  console.log(chalk.bold("    Fundamentals:"));

  // Valuation metrics
  const valuation: string[] = [];
  if (f.peRatio !== undefined) valuation.push(`P/E: ${formatNumber(f.peRatio)}`);
  if (f.pegRatio !== undefined) valuation.push(`PEG: ${formatNumber(f.pegRatio)}`);
  if (f.pbRatio !== undefined) valuation.push(`P/B: ${formatNumber(f.pbRatio)}`);
  if (f.prRatio !== undefined) valuation.push(`P/S: ${formatNumber(f.prRatio)}`);
  if (f.pcfRatio !== undefined) valuation.push(`P/CF: ${formatNumber(f.pcfRatio)}`);
  if (valuation.length > 0) {
    console.log(`      ${chalk.gray("Valuation:")} ${valuation.join("  ")}`);
  }

  // Market cap and shares
  const market: string[] = [];
  if (f.marketCap !== undefined) market.push(`Mkt Cap: $${formatLargeNumber(f.marketCap)}`);
  if (f.sharesOutstanding !== undefined)
    market.push(`Shares Out: ${formatLargeNumber(f.sharesOutstanding)}`);
  if (f.marketCapFloat !== undefined) market.push(`Float: ${formatLargeNumber(f.marketCapFloat)}`);
  if (market.length > 0) {
    console.log(`      ${chalk.gray("Market:")} ${market.join("  ")}`);
  }

  // Earnings
  const earnings: string[] = [];
  if (f.eps !== undefined) earnings.push(`EPS: $${formatNumber(f.eps)}`);
  if (f.epsTTM !== undefined) earnings.push(`EPS TTM: $${formatNumber(f.epsTTM)}`);
  if (f.epsChangePercentTTM !== undefined)
    earnings.push(`EPS Chg: ${formatNumber(f.epsChangePercentTTM)}%`);
  if (earnings.length > 0) {
    console.log(`      ${chalk.gray("Earnings:")} ${earnings.join("  ")}`);
  }

  // Dividend info
  const dividend: string[] = [];
  if (f.dividendYield !== undefined) dividend.push(`Yield: ${formatNumber(f.dividendYield)}%`);
  if (f.dividendAmount !== undefined) dividend.push(`Annual: $${formatNumber(f.dividendAmount)}`);
  if (f.dividendPayAmount !== undefined)
    dividend.push(`Per Share: $${formatNumber(f.dividendPayAmount)}`);
  if (f.dividendFreq !== undefined) dividend.push(`Freq: ${String(f.dividendFreq)}/yr`);
  if (dividend.length > 0) {
    console.log(`      ${chalk.gray("Dividend:")} ${dividend.join("  ")}`);
  }

  // 52-week range
  if (f.high52 !== undefined || f.low52 !== undefined) {
    console.log(
      `      ${chalk.gray("52W Range:")} $${formatNumber(f.low52)} - $${formatNumber(f.high52)}`
    );
  }

  // Profitability margins
  const margins: string[] = [];
  if (f.grossMarginTTM !== undefined) margins.push(`Gross: ${formatNumber(f.grossMarginTTM)}%`);
  if (f.operatingMarginTTM !== undefined)
    margins.push(`Operating: ${formatNumber(f.operatingMarginTTM)}%`);
  if (f.netProfitMarginTTM !== undefined)
    margins.push(`Net: ${formatNumber(f.netProfitMarginTTM)}%`);
  if (margins.length > 0) {
    console.log(`      ${chalk.gray("Margins (TTM):")} ${margins.join("  ")}`);
  }

  // Returns
  const returns: string[] = [];
  if (f.returnOnEquity !== undefined) returns.push(`ROE: ${formatNumber(f.returnOnEquity)}%`);
  if (f.returnOnAssets !== undefined) returns.push(`ROA: ${formatNumber(f.returnOnAssets)}%`);
  if (f.returnOnInvestment !== undefined)
    returns.push(`ROI: ${formatNumber(f.returnOnInvestment)}%`);
  if (returns.length > 0) {
    console.log(`      ${chalk.gray("Returns:")} ${returns.join("  ")}`);
  }

  // Risk metrics
  if (f.beta !== undefined) {
    console.log(`      ${chalk.gray("Beta:")} ${formatNumber(f.beta)}`);
  }

  // Short interest
  const shortInfo: string[] = [];
  if (f.shortIntToFloat !== undefined)
    shortInfo.push(`Short % Float: ${formatNumber(f.shortIntToFloat)}%`);
  if (f.shortIntDayToCover !== undefined)
    shortInfo.push(`Days to Cover: ${formatNumber(f.shortIntDayToCover)}`);
  if (shortInfo.length > 0) {
    console.log(`      ${chalk.gray("Short Interest:")} ${shortInfo.join("  ")}`);
  }
}

function printInstrument(
  instrument: SchwabInstrumentResponse,
  projection: SchwabInstrumentSearchProjection
): void {
  printBasicInstrument(instrument);

  // For fundamental projection, show detailed fundamental data
  if (projection === "fundamental" && instrument.fundamental) {
    printFundamentalData(instrument.fundamental);
  }

  console.log();
}

export interface SearchOptions {
  projection: string;
}

export async function handleSearch(symbol: string, options: SearchOptions): Promise<void> {
  const projection = options.projection as SchwabInstrumentSearchProjection;

  if (!VALID_PROJECTIONS.includes(projection)) {
    console.error(
      chalk.red(`Invalid projection: ${options.projection}`),
      chalk.gray(`\nValid options: ${VALID_PROJECTIONS.join(", ")}`)
    );
    process.exit(1);
  }

  console.log(chalk.bold("\nInstrument Search\n"));
  console.log(chalk.gray(`Searching for "${symbol}" using ${projection} projection...\n`));
  console.log(chalk.gray("-".repeat(60)));
  const api = await apiClient();
  const instruments = await api.searchInstruments(symbol, projection);

  if (instruments.length === 0) {
    console.log(chalk.yellow(`No instruments found matching "${symbol}"`));
    return;
  }

  console.log(chalk.gray(`Found ${String(instruments.length)} result(s):\n`));

  for (const instrument of instruments) {
    printInstrument(instrument, projection);
  }
}
