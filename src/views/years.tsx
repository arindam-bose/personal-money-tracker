// Over the years: each Dashboard figure for every stored year, one small chart per figure.
// Always the household's totals across all years, whatever year is open. Loaded on demand
// with ECharts, like Reports.

import { useSignal, useSignalEffect } from "@preact/signals";
import type { YearData } from "../db";
import { ledgerOf, ratio, summarize, type Summary } from "../derive";
import { formatCents, formatCompact, formatPercent } from "../money";
import { current, loadAllYears, years, type YearSummary } from "../state";
import { Chart, axisStyle, baseOption, money, moneyAxis, seriesColors, token, type ChartOption } from "./chart";
import { CardTitle, PageHelp } from "./help";

/** The Dashboard's tiles, in its order. Colours match Reports: earning, spending, savings, investing, loans. */
const MEASURES: { key: keyof Summary; label: string; color: (c: string[], value: number) => string }[] = [
  { key: "earned", label: "Earned", color: (c) => c[0]! },
  { key: "netEarnings", label: "Net earnings", color: (c) => c[0]! },
  { key: "spent", label: "Spent", color: (c) => c[1]! },
  { key: "netSpent", label: "Net spending", color: (c) => c[1]! },
  // Green or red per year, as in Monthly cash flow.
  { key: "surplus", label: "Surplus", color: (_, v) => token(v < 0 ? "--expense" : "--earning") },
  { key: "netSavings", label: "Savings", color: (c) => c[2]! },
  { key: "investment", label: "Investment", color: (c) => c[3]! },
  { key: "ccPayments", label: "Credit card payments", color: () => token("--transfer") },
  { key: "charity", label: "Charity", color: (c) => c[1]! },
  { key: "loanPayments", label: "Loan payments", color: (c) => c[5]! },
];

/** A year still under way: not closed, and not over yet. Its figures are so far, marked with an asterisk. */
const inProgress = (d: YearData) => !d.setup.closed && d.setup.year >= new Date().getFullYear();

export function YearsView() {
  // Each load remembers the list of years it was for: one made before the list changed is never shown.
  const loaded = useSignal<{ list: YearSummary[]; data: YearData[] } | null>(null);
  // Reload when years are added or removed, or the open year changes. A load overtaken by a newer one is dropped.
  useSignalEffect(() => {
    const list = years.value;
    void current.value;
    let overtaken = false;
    loadAllYears().then((data) => { if (!overtaken) loaded.value = { list, data }; });
    return () => { overtaken = true; };
  });

  const all = loaded.value?.list === years.value ? loaded.value.data : null;
  if (years.value.length < 2 || (all && all.length < 2)) {
    return (
      <section class="panel">
        <h2>Over the years</h2>
        <p>This page compares years once there are two or more. Go to <a href="#/settings">Settings</a> to import or start another year.</p>
      </section>
    );
  }
  if (!all) return <p class="muted">Loading years…</p>;

  const sums = all.map((d) => summarize(ledgerOf(d)));
  const labels = all.map((d) => `${d.setup.year}${inProgress(d) ? "*" : ""}`);
  const ongoing = all.filter(inProgress).map((d) => d.setup.year);
  const colors = seriesColors();
  const value = (s: Summary, key: keyof Summary) => s[key] as number;
  const last = sums.length - 1;
  // Past four years, the axes say '24 to fit; the table keeps the full year.
  const short = (y: string) => (all.length > 4 ? `’${y.slice(2)}` : y);

  return (
    <div class="over-years">
      <PageHelp>
        Each Dashboard figure for every year, everyone together.
        {ongoing.length > 0 && <> * {ongoing.join(", ")} so far.</>}
      </PageHelp>
      <div class={`year-charts${all.length > 4 ? " many" : ""}`}>
        {MEASURES.map((m) => {
          const values = sums.map((s) => value(s, m.key));
          const option: ChartOption = {
            ...baseOption(),
            legend: undefined,
            grid: { ...(baseOption().grid as object), top: 24 },
            tooltip: {
              ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" },
              valueFormatter: money,
            },
            // Every year named, even when the chart is narrow.
            xAxis: { type: "category", data: labels, ...axisStyle(), axisLabel: { color: token("--muted"), interval: 0, fontSize: 11, formatter: short }, splitLine: { show: false } },
            yAxis: { ...moneyAxis(), splitNumber: 3 },
            series: [{
              name: m.label, type: "bar", barMaxWidth: 32,
              // Only the latest year is labelled with its amount; the tooltip and the table have the rest.
              data: values.map((v, i) => ({
                value: v,
                itemStyle: { color: m.color(colors, v), borderRadius: v < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] },
                label: { show: i === last, position: v < 0 ? "bottom" : "top", color: token("--muted"), fontSize: 11, formatter: (p: { value: number }) => formatCompact(p.value) },
              })),
            }],
          };
          return (
            <section class="card report">
              <h3>{m.label}</h3>
              <Chart option={option} height={200} label={`${m.label} by year: ${labels.map((y, i) => `${y} ${formatCents(values[i]!)}`).join(", ")}`} />
            </section>
          );
        })}
      </div>
      <section class="card report">
        <CardTitle title="All figures">Change is {labels[last]} against {labels[last - 1]}.</CardTitle>
        <div class="heatmap-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Figure</th>
                {labels.map((y) => <th class="num">{y}</th>)}
                <th class="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {MEASURES.map((m) => {
                const now = value(sums[last]!, m.key);
                const before = value(sums[last - 1]!, m.key);
                // Against a negative year (a deficit, or more taken out of savings) a percentage means little.
                const change = before > 0 ? ratio(now - before, before) : null;
                return (
                  <tr>
                    <td>{m.label}</td>
                    {sums.map((s) => <td class="num">{formatCents(value(s, m.key))}</td>)}
                    <td class="num">{change === null ? "–" : `${change > 0 ? "+" : ""}${formatPercent(change)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
