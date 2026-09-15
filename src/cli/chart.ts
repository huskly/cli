import chalk from "chalk";
import { format, subDays, addDays } from "date-fns";
import open from "open";
import { apiClient, asciichart } from "./shared.js";
import { closes, toPriceSeriesDto, type PriceSeriesDto } from "./priceSeries.js";

export function renderChart(dto: PriceSeriesDto, height: number): string {
  const header = chalk.bold(`\n📈 Price Chart: ${dto.symbol} (${String(dto.days)} days)\n`);
  if (dto.latest === null || dto.high === null || dto.low === null) {
    return `${header}\n${chalk.yellow("No price history available")}`;
  }

  const change = dto.changePercent ?? 0;
  const changeStr =
    change >= 0 ? chalk.green("+" + change.toFixed(2) + "%") : chalk.red(change.toFixed(2) + "%");
  const rule = chalk.gray("─".repeat(70));
  const chart = asciichart.plot(closes(dto), {
    height,
    colors: [change >= 0 ? asciichart.green : asciichart.red],
    format: (x: number) => ("$" + x.toFixed(2)).padStart(10),
  });

  // Date axis labels, aligned past the 11-column y-axis gutter.
  const chartWidth = chart.split("\n")[0]?.length ?? 70;
  const startLabel = format(subDays(new Date(), dto.days), "MMM dd");
  const endLabel = format(new Date(), "MMM dd");
  const padding = chartWidth - 11 - startLabel.length - endLabel.length;

  return [
    header,
    rule,
    `  ${chalk.white("$" + dto.latest.toFixed(2))} ${changeStr}  │  ` +
      `High: ${chalk.green("$" + dto.high.toFixed(2))}  │  ` +
      `Low: ${chalk.red("$" + dto.low.toFixed(2))}`,
    rule,
    chart,
    " ".repeat(11) + chalk.gray(startLabel + " ".repeat(Math.max(0, padding)) + endLabel),
    "",
  ].join("\n");
}

export async function handleChart(
  symbol: string,
  days: number,
  height: number,
  useImage = false,
  json = false
): Promise<void> {
  if (useImage && json) {
    throw new Error("Use either --image or --json, not both.");
  }

  const api = await apiClient();
  const dto = toPriceSeriesDto(symbol, days, await api.getPriceHistory({ symbol, days }));

  if (json) {
    console.log(JSON.stringify(dto, null, 2));
    return;
  }
  if (useImage) {
    if (dto.latest === null || dto.high === null || dto.low === null) {
      console.log(chalk.yellow("No price history available"));
      return;
    }
    await renderImageChart(
      symbol,
      closes(dto),
      subDays(new Date(), days),
      days,
      dto.changePercent ?? 0,
      dto.low,
      dto.high,
      dto.latest
    );
    return;
  }
  console.log(renderChart(dto, height));
}

/**
 * Generates a chart image using QuickChart.io and opens it in the browser.
 */
async function renderImageChart(
  symbol: string,
  prices: number[],
  startDate: Date,
  days: number,
  change: number,
  min: number,
  max: number,
  latest: number
): Promise<void> {
  // Generate date labels for x-axis (sample to avoid overcrowding)
  const labelCount = Math.min(prices.length, 10);
  const step = Math.floor(prices.length / labelCount);
  const labels: string[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i % step === 0 || i === prices.length - 1) {
      const date = addDays(startDate, i);
      labels.push(format(date, "MMM dd"));
    } else {
      labels.push("");
    }
  }

  const lineColor = change >= 0 ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)";
  const fillColor = change >= 0 ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)";
  const changeStr = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;

  const chartConfig = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${symbol} Price`,
          data: prices,
          borderColor: lineColor,
          backgroundColor: fillColor,
          fill: true,
          tension: 0.1,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `${symbol} - $${latest.toFixed(2)} (${changeStr}) - ${String(days)} days`,
          font: { size: 18, weight: "bold" },
        },
        subtitle: {
          display: true,
          text: `High: $${max.toFixed(2)} | Low: $${min.toFixed(2)}`,
          font: { size: 14 },
        },
        legend: { display: false },
      },
      scales: {
        y: {
          ticks: {
            callback: (value: number) => `$${value.toFixed(2)}`,
          },
          grid: { color: "rgba(0,0,0,0.1)" },
        },
        x: {
          grid: { display: false },
        },
      },
    },
  };

  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=800&h=500&bkg=white`;

  console.log(chalk.green("Opening chart in browser..."));
  console.log(chalk.gray(`URL: ${chartUrl.substring(0, 80)}...`));

  await open(chartUrl);
}
