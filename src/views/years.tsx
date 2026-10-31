// Over the years: each Dashboard figure for every stored year, one small chart per figure.
// Always the household's totals across all years, whatever year is open. Loaded on demand
// with ECharts, like Reports.

import { useSignal, useSignalEffect } from "@preact/signals";
import type { YearData } from "../db";
import { ledgerOf, ratio, spendByCategory, summarize, tagTotal, type Summary } from "../derive";
import { formatCents, formatCompact, formatPercent } from "../money";
import {
  current, loadAllYears, pinnedYearCategories, pinnedYearTags, savePinnedYearCategories, savePinnedYearTags, years, type YearSummary,
} from "../state";
import { Chart, axisStyle, baseOption, money, moneyAxis, seriesColors, token, type ChartOption } from "./chart";
import { CardTitle, PageHelp } from "./help";
import { SearchSelect } from "./search-select";

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

/** One chart, and one row of the table: a Dashboard figure, or a pinned tag's total. */
interface Figure {
  key: string;
  label: string;
  /** One per year, oldest first. */
  values: number[];
  color: (value: number) => string;
  /** For a pinned tag: takes it off the page. */
  onRemove?: () => void;
}

type Named = { id: string; name: string };
/** A year's tags, or its spending categories: what can be pinned. */
const tagsOf = (d: YearData): Named[] => d.setup.tags;
const categoriesOf = (d: YearData): Named[] => d.setup.categories.expense;

/** Everything of one kind in any year, by id, under its newest name. */
function namesInAllYears(all: YearData[], list: (d: YearData) => Named[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const d of [...all].reverse()) for (const x of list(d)) if (!names.has(x.id)) names.set(x.id, x.name);
  return names;
}

/**
 * A pinned tag or category in one year: the same id, or else one of the same name. Each year
 * has its own, and one made separately in two years can have different ids.
 */
function idIn(list: Named[], id: string, name: string): string | undefined {
  return list.find((x) => x.id === id)?.id ?? list.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id;
}

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

  const tagNames = namesInAllYears(all, tagsOf);
  const categoryNames = namesInAllYears(all, categoriesOf);
  /** Charts for pinned tags or categories. They're spending, so they take Spent's colour; one deleted from every year drops out. */
  const pinned = (ids: string[], names: Map<string, string>, list: (d: YearData) => Named[], kind: string,
    total: (d: YearData, id: string) => number, save: (ids: string[]) => void): Figure[] =>
    ids.flatMap((id) => {
      const name = names.get(id);
      if (name === undefined) return [];
      return [{
        key: `${kind}:${id}`, label: name, color: () => colors[1]!,
        values: all.map((d) => {
          const own = idIn(list(d), id, name);
          return own ? total(d, own) : 0;
        }),
        onRemove: () => save(ids.filter((x) => x !== id)),
      }];
    });
  const figures: Figure[] = [
    ...MEASURES.map((m) => ({ key: m.key, label: m.label, values: sums.map((s) => value(s, m.key)), color: (v: number) => m.color(colors, v) })),
    // All spending in the category, before refunds, as in Spending by category.
    ...pinned(pinnedYearCategories.value, categoryNames, categoriesOf, "cat",
      (d, id) => spendByCategory(ledgerOf(d)).get(id)?.gross ?? 0, savePinnedYearCategories),
    ...pinned(pinnedYearTags.value, tagNames, tagsOf, "tag", (d, id) => tagTotal(ledgerOf(d), id), savePinnedYearTags),
  ];
  const choices = [
    ...[...categoryNames].filter(([id]) => !pinnedYearCategories.value.includes(id))
      .map(([id, name]) => ({ value: `cat:${id}`, label: name, group: "Spending categories" })),
    ...[...tagNames].filter(([id]) => !pinnedYearTags.value.includes(id)).map(([id, name]) => ({ value: `tag:${id}`, label: name, group: "Tags" })),
  ];

  return (
    <div class="over-years">
      <PageHelp>
        Each Dashboard figure for every year, everyone together.
        {ongoing.length > 0 && <> * {ongoing.join(", ")} so far.</>}
      </PageHelp>
      <div class={`year-charts${all.length > 4 ? " many" : ""}`}>
        {figures.map((f) => {
          const values = f.values;
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
              name: f.label, type: "bar", barMaxWidth: 32,
              // Only the latest year is labelled with its amount; the tooltip and the table have the rest.
              data: values.map((v, i) => ({
                value: v,
                itemStyle: { color: f.color(v), borderRadius: v < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] },
                label: { show: i === last, position: v < 0 ? "bottom" : "top", color: token("--muted"), fontSize: 11, formatter: (p: { value: number }) => formatCompact(p.value) },
              })),
            }],
          };
          return (
            <section class="card report" key={f.key}>
              <div class="year-chart-head">
                <h3>{f.label}</h3>
                {f.onRemove && <button type="button" class="unpin" aria-label={`Unpin ${f.label}`} title="Unpin" onClick={f.onRemove}>×</button>}
              </div>
              <Chart option={option} height={200} label={`${f.label} by year: ${labels.map((y, i) => `${y} ${formatCents(values[i]!)}`).join(", ")}`} />
            </section>
          );
        })}
        {choices.length > 0 && (
          <label class="card pin-tile">
            <span class="tile-label">Pin a total</span>
            <SearchSelect value="" placeholder="Category or tag…" aria-label="Category or tag to chart over the years" choices={choices}
              onChange={(v) => {
                const [kind, id] = [v.slice(0, 3), v.slice(4)];
                if (kind === "cat") savePinnedYearCategories([...pinnedYearCategories.value, id]);
                else savePinnedYearTags([...pinnedYearTags.value, id]);
              }} />
          </label>
        )}
      </div>
      <section class="card report">
        <CardTitle title="All figures">† Change is {labels[last]} against {labels[last - 1]}.</CardTitle>
        <div class="heatmap-wrap">
          <table class="data-table all-figures">
            <thead>
              <tr>
                <th>Figure</th>
                {labels.map((y) => <th class="num">{y}</th>)}
                <th class="num">Change<sup aria-hidden="true">†</sup></th>
              </tr>
            </thead>
            <tbody>
              {figures.map((f) => {
                const now = f.values[last]!;
                const before = f.values[last - 1]!;
                // Against a negative year (a deficit, or more taken out of savings) a percentage means little.
                const change = before > 0 ? ratio(now - before, before) : null;
                return (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    {f.values.map((v) => <td class="num">{formatCents(v)}</td>)}
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
