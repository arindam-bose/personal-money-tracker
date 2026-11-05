// Over the years: each Dashboard figure for every stored year, one small chart per figure.
// Always the household's totals across all years, whatever year is open. Loaded on demand
// with ECharts, like Reports.

import { useSignal, useSignalEffect } from "@preact/signals";
import type { YearData } from "../db";
import { ledgerOf, ratio, spendByCategory, summarize, tagTotal, type Summary } from "../derive";
// Every amount on this page goes through these, so Hide the numbers covers them all.
import { maskedCents as formatCents, maskedCompact as formatCompact } from "../hide-numbers";
import { formatPercent } from "../money";
import { current, loadAllYears, pins, savePins, years, type YearSummary } from "../state";
import type { PinSetting } from "../types";
import { Chart, axisStyle, baseOption, money, moneyAxis, token, type ChartOption } from "./chart";
import { CONCEPT_TOKEN, FIGURE_CONCEPT, PINNED_CONCEPT, surplusConcept, type Concept } from "./concepts";
import { CardTitle, PageHelp } from "./help";
import { PinTotal } from "./pin-total";

/** The Dashboard's tiles, in its order. */
const MEASURES: { key: keyof typeof FIGURE_CONCEPT | "surplus"; label: string }[] = [
  { key: "earned", label: "Earned" },
  { key: "netEarnings", label: "Net earnings" },
  { key: "spent", label: "Spent" },
  { key: "netSpent", label: "Net spending" },
  { key: "surplus", label: "Surplus" },
  { key: "netSavings", label: "Savings" },
  { key: "investment", label: "Investment" },
  { key: "ccPayments", label: "Credit card payments" },
  { key: "charity", label: "Charity" },
  { key: "loanPayments", label: "Loan payments" },
];

/** A concept's colour, read from the page so it follows light or dark. */
const colorOf = (concept: Concept) => token(CONCEPT_TOKEN[concept]);

/** A year still under way: not closed, and not over yet. Its figures are so far, marked with an asterisk. */
const inProgress = (d: YearData) => !d.setup.closed && d.setup.year >= new Date().getFullYear();

/** One chart, and one row of the table: a Dashboard figure, or a pinned tag's total. */
interface Figure {
  key: string;
  label: string;
  /** One per year, oldest first. */
  values: number[];
  color: (value: number) => string;
  /** For a pinned category or tag: takes it off the page. */
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
 * has its own, and one made separately in two years can have different ids. A same-named one
 * that was renamed since (its newest name, in `names`, differs) belongs to the chart for that
 * name instead, so no year's spending is counted twice.
 */
function idIn(list: Named[], id: string, name: string, names: Map<string, string>): string | undefined {
  const same = (n: string) => n.toLowerCase() === name.toLowerCase();
  return list.find((x) => x.id === id)?.id ?? list.find((x) => same(x.name) && same(names.get(x.id) ?? x.name))?.id;
}


export function YearsView() {
  // Each load remembers the list of years it was for: one made before the list changed is never shown.
  const loaded = useSignal<{ list: YearSummary[]; data: YearData[] } | null>(null);
  const failed = useSignal<string | null>(null);
  // Reload when years are added or removed, or the open year changes. A load overtaken by a newer one is dropped.
  useSignalEffect(() => {
    const list = years.value;
    void current.value;
    let overtaken = false;
    loadAllYears().then(
      (data) => { if (!overtaken) { loaded.value = { list, data }; failed.value = null; } },
      (e) => { if (!overtaken) failed.value = e instanceof Error ? e.message : String(e); },
    );
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
  if (!all) {
    return failed.value ? (
      <p class="form-error" role="alert">
        The years couldn't be loaded: {failed.value}{" "}
        <button type="button" class="link" onClick={() => location.reload()}>Reload</button>
      </p>
    ) : <p class="muted">Loading years…</p>;
  }

  const ledgers = all.map(ledgerOf);
  const sums = ledgers.map((l) => summarize(l));
  const labels = all.map((d) => `${d.setup.year}${inProgress(d) ? "*" : ""}`);
  // The same on the page itself, where the mark can be raised; charts draw plain text.
  const marked = all.map((d) => <>{d.setup.year}{inProgress(d) && <sup aria-hidden="true">*</sup>}</>);
  const ongoing = all.filter(inProgress).map((d) => d.setup.year);
  const value = (s: Summary, key: keyof Summary) => s[key] as number;
  const last = sums.length - 1;
  // Past four years, the axes say '24 to fit; the table keeps the full year.
  const short = (y: string) => (all.length > 4 ? `’${y.slice(2)}` : y);

  const tagNames = namesInAllYears(all, tagsOf);
  const categoryNames = namesInAllYears(all, categoriesOf);
  /** Charts for pinned tags or categories, in their tiles' colour (spending); one deleted from every year drops out. */
  const pinned = (key: PinSetting, names: Map<string, string>, list: (d: YearData) => Named[],
    total: (year: number, id: string) => number): Figure[] => {
    const ids = pins[key].value;
    return ids.flatMap((id) => {
      const name = names.get(id);
      if (name === undefined) return [];
      return [{
        key: `${key}:${id}`, label: name, color: () => colorOf(PINNED_CONCEPT),
        values: all.map((d, year) => {
          const own = idIn(list(d), id, name, names);
          return own ? total(year, own) : 0;
        }),
        onRemove: () => savePins(key, ids.filter((x) => x !== id)),
      }];
    });
  };
  // Worked out once per year, for every pinned category.
  const categorySpend = pins.pinnedYearCategories.value.length ? ledgers.map((l) => spendByCategory(l)) : [];
  const figures: Figure[] = [
    ...MEASURES.map((m) => ({ key: m.key, label: m.label, values: sums.map((s) => value(s, m.key)), 
      // Each in its tile's stripe colour (concepts.ts); Surplus green or red per year, as in Monthly cash flow.
      color: (v: number) => colorOf(m.key === "surplus" ? surplusConcept(v) : FIGURE_CONCEPT[m.key]) })),
    // All spending in the category, before refunds, as in Spending by category.
    ...pinned("pinnedYearCategories", categoryNames, categoriesOf, (year, id) => categorySpend[year]!.get(id)?.gross ?? 0),
    ...pinned("pinnedYearTags", tagNames, tagsOf, (year, id) => tagTotal(ledgers[year]!, id)),
  ];

  return (
    <div class="over-years">
      <PageHelp>
        Each Dashboard figure for every year, everyone together.
        {ongoing.length > 0 && <><br /><sup aria-hidden="true">*</sup>{ongoing.join(", ")} so far.</>}
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
        <PinTotal categories={categoryNames} tags={tagNames} keys={{ cat: "pinnedYearCategories", tag: "pinnedYearTags" }}
          label="Category or tag to chart over the years" />
      </div>
      <section class="card report">
        <CardTitle title="All figures"><sup aria-hidden="true">†</sup>Change is {marked[last]} against {marked[last - 1]}.</CardTitle>
        <div class="heatmap-wrap">
          <table class="data-table all-figures">
            <thead>
              <tr>
                <th>Figure</th>
                {marked.map((y) => <th class="num">{y}</th>)}
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
