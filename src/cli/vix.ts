import chalk from "chalk";
import { apiClient } from "./shared.js";

/** Stable volatility regime tokens, ordered from calm to fearful. */
export type VixSentiment = "low" | "normal" | "elevated" | "high";

export interface VixDto {
  readonly level: number | null;
  readonly sentiment: VixSentiment | null;
}

const SENTIMENT_LABELS: Readonly<Record<VixSentiment, string>> = {
  low: "Low volatility (complacent)",
  normal: "Normal volatility",
  elevated: "Elevated volatility (caution)",
  high: "High volatility (fear)",
};

function sentimentOf(level: number): VixSentiment {
  if (level < 15) return "low";
  if (level < 20) return "normal";
  if (level < 30) return "elevated";
  return "high";
}

export function toVixDto(level: number | null | undefined): VixDto {
  if (level === null || level === undefined) {
    return { level: null, sentiment: null };
  }
  return { level, sentiment: sentimentOf(level) };
}

export function renderVix(dto: VixDto): string {
  const header = chalk.bold("\n😱 VIX (Fear Index)\n");
  if (dto.level === null || dto.sentiment === null) {
    return `${header}\n${chalk.red("VIX level unavailable.")}`;
  }

  const color =
    dto.sentiment === "low"
      ? chalk.green
      : dto.sentiment === "normal"
        ? chalk.yellow
        : dto.sentiment === "elevated"
          ? chalk.hex("#FFA500")
          : chalk.red;
  const rule = chalk.gray("─".repeat(50));

  return [
    header,
    rule,
    `VIX:      ${color(dto.level.toFixed(2))}`,
    `Sentiment: ${color(SENTIMENT_LABELS[dto.sentiment])}`,
    rule,
    "",
  ].join("\n");
}

export async function handleVix(json = false): Promise<void> {
  const api = await apiClient();
  const dto = toVixDto(await api.getVixLevel());
  console.log(json ? JSON.stringify(dto, null, 2) : renderVix(dto));
}
