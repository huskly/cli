import { HusklyDeviceAuth } from "#src/auth/husklyDeviceAuth.js";
import { ensure } from "#src/helpers.js";
import { SchwabClient } from "@huskly/schwab-client";
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

export async function apiClient(): Promise<SchwabClient> {
  const deviceAuth = new HusklyDeviceAuth();
  const accessToken = await deviceAuth.getAccessToken();
  return new SchwabClient(
    ensure(accessToken, "Not authenticated. Please run 'huskly login' to authenticate.")
  );
}
