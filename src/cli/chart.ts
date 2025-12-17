import chalk from "chalk";
import { format, subDays, addDays } from "date-fns";
import open from "open";
import { apiClient, asciichart } from "./shared.js";

export async function handleChart(
  symbol: string,
  days: number,
  height: number,
  useImage = false
): Promise<void> {
  console.log(chalk.bold(`\n📈 Price Chart: ${symbol} (${String(days)} days)\n`));

  const api = await apiClient();
  const prices = (await api.getPriceHistory({ symbol, days })).map((c) => c.close);

  if (prices.length === 0) {
    console.log(chalk.yellow("No price history available"));
    return;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const latest = prices[prices.length - 1] ?? 0;
  const first = prices[0] ?? latest;
  const change = ((latest - first) / first) * 100;

  // Calculate date range
  const today = new Date();
  const startDate = subDays(today, days);

  if (useImage) {
    await renderImageChart(symbol, prices, startDate, days, change, min, max, latest);
    return;
  }

  const changeStr =
    change >= 0 ? chalk.green("+" + change.toFixed(2) + "%") : chalk.red(change.toFixed(2) + "%");

  console.log(chalk.gray("─".repeat(70)));
  console.log(
    `  ${chalk.white("$" + latest.toFixed(2))} ${changeStr}  │  ` +
      `High: ${chalk.green("$" + max.toFixed(2))}  │  ` +
      `Low: ${chalk.red("$" + min.toFixed(2))}`
  );
  console.log(chalk.gray("─".repeat(70)));

  // Determine chart color based on overall trend
  const chartColor = change >= 0 ? asciichart.green : asciichart.red;

  // Render the ASCII chart
  const chart = asciichart.plot(prices, {
    height,
    colors: [chartColor],
    format: (x: number) => ("$" + x.toFixed(2)).padStart(10),
  });

  console.log(chart);

  // Date axis labels
  const chartWidth = chart.split("\n")[0]?.length ?? 70;
  const labelWidth = chartWidth - 11; // Account for y-axis labels
  const startLabel = format(startDate, "MMM dd");
  const endLabel = format(today, "MMM dd");
  const padding = labelWidth - startLabel.length - endLabel.length;

  console.log(
    " ".repeat(11) + chalk.gray(startLabel + " ".repeat(Math.max(0, padding)) + endLabel)
  );
  console.log();
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
