import { SchwabMarketDataSource } from "../schwab/schwabMarketDataSource.js";
import { createRequire } from "module";

export interface PlotConfig {
  offset?: number;
  padding?: string;
  height?: number;
  colors?: (string | undefined)[];
  min?: number;
  max?: number;
  format?: (x: number, i: number) => string;
}

export interface AsciiChart {
  plot: (series: readonly number[], cfg?: PlotConfig) => string;
  green: string;
  red: string;
}

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const asciichart: AsciiChart = require("asciichart");

export const api = new SchwabMarketDataSource();
