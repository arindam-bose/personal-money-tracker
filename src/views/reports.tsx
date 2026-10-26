// Reports: charts for the whole year. Loaded on demand, so ECharts doesn't slow down
// the rest of the app. Every chart has a table with the same numbers under it.
// With more than one person, they can show one person's entries; balances stay in "All people".

import type { ComponentChildren } from "preact";
import {
  MONTH_SHORT, balanceSeries, moneyFlow, monthlySummaries, shortDate, spendingByMonth, weeklySpending,
  type FlowGroup, type Ledger,
} from "../derive";
import { formatCents, formatCompact } from "../money";
import { membersOf } from "../setup";
import { current, ledger, netWorthWithoutLoans } from "../state";
import { IncludeLoans } from "./dashboard";
import { Chart, axisStyle, baseOption, seriesColors, token, type ChartOption } from "./chart";
import { showInLedger } from "./ledger";
import { MemberPicker, viewedLedger, viewedMember } from "./people";
import { dayBefore, firstMonth, yearStart } from "../year";

/** How many categories get their own colour in the stacked chart; the rest fold into "Other". */
const TOP_CATEGORIES = 6;

/** Tooltip values in dollars and cents. */
const money = (v: unknown) => formatCents(Number(v));

export function ReportsView() {
  const all = ledger.value;
  const l = viewedLedger();
  const member = viewedMember();
  const data = current.value;
  if (!all || !l || !data) {
    return (
      <section class="panel">
        <h2>Reports</h2>
        <p>No data yet. Go to <a href="#/settings">Settings</a> to import a year or start one from scratch.</p>
      </section>
    );
  }
  const year = data.setup.year;
  const start = yearStart(data.setup);
  // The same months and weeks for everyone, so one person's charts line up with the household's.
  const dates = [...all.expenses, ...all.earnings, ...all.transfers].map((e) => e.date);
  const lastDate = dates.reduce((a, b) => (a > b ? a : b), start);
  // Balances over time also runs to the latest investment balance update, so one made after the last entry shows.
  const balancesEnd = all.accounts.flatMap((a) => a.valuations ?? []).reduce((d, v) => (v.date > d ? v.date : d), lastDate);
  // Only show months that have been tracked: from the start month (January, unless the year
  // began partway through) to the last month with entries, or December once a year is closed.
  const months = { first: firstMonth(data.setup), last: data.setup.closed ? 12 : Number(lastDate.slice(5, 7)) };

  return (
    <div class="reports">
      {membersOf(data.setup).length > 1 && <div class="filters"><MemberPicker /></div>}
      {member && <p class="muted member-note">{member.name}’s entries only. Account balances are shared, so they’re under All people.</p>}
      <MoneyFlowCard ledger={l} year={year} />
      <CashFlowCard ledger={l} months={months} />
      <CategoryCard ledger={l} months={months} />
      <WeeklyCard ledger={l} year={year} start={start} lastDate={lastDate} />
      {!member && <BalancesCard ledger={l} year={year} start={start} lastDate={balancesEnd} />}
    </div>
  );
}

function Card(props: { title: string; subtitle: string; action?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="card report">
      {props.action ? (
        <div class="card-head">
          <h3>{props.title}</h3>
          {props.action}
        </div>
      ) : <h3>{props.title}</h3>}
      <p class="muted small">{props.subtitle}</p>
      {props.children}
    </section>
  );
}

/** The months a report shows, 1 to 12: from the first tracked month to the last one with entries. */
interface MonthRange {
  first: number;
  last: number;
}

/** One value per month in the range, from a January-to-December list. */
const inRange = <T,>(list: T[], r: MonthRange) => list.slice(r.first - 1, r.last);

/** The numbers behind a chart, folded away under it. */
function TableView(props: { head: string[]; rows: (string | number)[][]; foot?: (string | number)[] }) {
  return (
    <details class="table-view">
      <summary>Show as a table</summary>
      <table class="data-table">
        <thead>
          <tr>{props.head.map((h, i) => <th class={i ? "num" : ""}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {props.rows.map((r) => <tr>{r.map((c, i) => <td class={i ? "num" : ""}>{c}</td>)}</tr>)}
        </tbody>
        {props.foot && (
          <tfoot>
            <tr>{props.foot.map((c, i) => <td class={i ? "num" : ""}>{c}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </details>
  );
}

// --- Money flow ---

const GROUP_LABEL: Partial<Record<FlowGroup, string>> = {
  income: "Income", spending: "Spending", savings: "Savings", investment: "Investing", loan: "Loan payments", balance: "Accounts",
};

function MoneyFlowCard({ ledger: l, year }: { ledger: Ledger; year: number }) {
  const flow = moneyFlow(l);
  const [c1, c2, c3, c4, , c6] = seriesColors();
  const neutral = token("--series-other");
  const color: Record<FlowGroup, string> = {
    income: c1!, hub: neutral, spending: c2!, savings: c3!, investment: c4!, loan: c6!, balance: neutral,
  };
  const value = new Map<string, number>();
  for (const link of flow.links) value.set(link.source === "hub" ? link.target : link.source, link.value);
  const total = flow.links.filter((x) => x.target === "hub").reduce((s, x) => s + x.value, 0);
  value.set("hub", total);

  // Biggest first on each side; layoutIterations: 0 keeps this order.
  const groupOrder: FlowGroup[] = ["income", "savings", "balance", "hub", "spending", "investment", "loan"];
  const nodes = [...flow.nodes].sort((a, b) =>
    groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || (value.get(b.id) ?? 0) - (value.get(a.id) ?? 0));
  const usedGroups = (Object.keys(GROUP_LABEL) as FlowGroup[]).filter((g) => flow.nodes.some((n) => n.group === g));

  const option: ChartOption = {
    ...baseOption(),
    legend: undefined,
    tooltip: {
      ...(baseOption().tooltip as object),
      trigger: "item",
      formatter: (p: { dataType: string; name: string; data: { source?: string; target?: string; value: number } }) => {
        const name = (id?: string) => flow.nodes.find((n) => n.id === id)?.name ?? id;
        return p.dataType === "edge"
          ? `${name(p.data.source)} → ${name(p.data.target)}<br><b>${formatCents(p.data.value)}</b>`
          : `${p.name}<br><b>${formatCents(value.get((p.data as unknown as { id: string }).id) ?? 0)}</b>`;
      },
    },
    series: [{
      type: "sankey",
      // Room on the right for the longest label ("Transfer to external account  $15K").
      left: 8, right: 240, top: 8, bottom: 8,
      nodeWidth: 10,
      // At least one label's height, so tiny nodes (a few dollars of interest) don't overlap.
      nodeGap: 14,
      layoutIterations: 0,
      draggable: false,
      emphasis: { focus: "adjacency" },
      data: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        itemStyle: { color: color[n.group], borderWidth: 0 },
      })),
      links: flow.links.map((x) => ({ ...x })),
      lineStyle: { color: "target", opacity: 0.28, curveness: 0.5 },
      label: {
        color: token("--text"),
        fontSize: 12,
        formatter: (p: { data: { id: string; name: string } }) => `${p.data.name}  {v|${formatCompact(value.get(p.data.id) ?? 0)}}`,
        rich: { v: { color: token("--muted"), fontSize: 12 } },
      },
    }],
  };

  const height = Math.max(320, flow.nodes.filter((n) => n.group === "spending" || n.group === "investment").length * 34 + 60);
  return (
    <Card title="Where the money went" subtitle={`${year < new Date().getFullYear() ? year : `${year} so far`}. Card payments and other moves between your own accounts aren't shown: they don't earn or spend anything.`}>
      <ul class="legend" aria-label="Colours">
        {usedGroups.map((g) => <li><span class="swatch" style={{ background: color[g] }} />{GROUP_LABEL[g]}</li>)}
      </ul>
      <Chart option={option} height={height} label={`Money flow for ${year}: ${formatCents(total)} in total`} />
      <TableView head={["From", "To", "Amount"]}
        rows={flow.links.map((x) => [
          flow.nodes.find((n) => n.id === x.source)!.name,
          flow.nodes.find((n) => n.id === x.target)!.name,
          formatCents(x.value),
        ])} />
    </Card>
  );
}

// --- Monthly cash flow ---

function CashFlowCard({ ledger: l, months }: { ledger: Ledger; months: MonthRange }) {
  const sums = inRange(monthlySummaries(l), months);
  const labels = inRange(MONTH_SHORT, months);
  const [c1, c2] = seriesColors();
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: labels, ...axisStyle(), splitLine: { show: false } },
    yAxis: { type: "value", ...axisStyle(), axisLine: { show: false }, axisLabel: { color: token("--muted"), formatter: formatCompact } },
    series: [
      { name: "Earned", type: "bar", data: sums.map((s) => s.earned), itemStyle: { color: c1, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 24, barGap: "15%" },
      { name: "Spent", type: "bar", data: sums.map((s) => s.spent), itemStyle: { color: c2, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 24 },
    ],
  };
  return (
    <Card title="Monthly cash flow" subtitle="Everything earned and spent each month (refunds count as earnings, as in Notion).">
      <Chart option={option} height={300} label="Earned and spent per month" />
      <TableView head={["Month", "Earned", "Spent", "Surplus"]}
        rows={sums.map((s, i) => [labels[i]!, formatCents(s.earned), formatCents(s.spent), formatCents(s.surplus)])}
        foot={["Total", ...(["earned", "spent", "surplus"] as const).map((k) => formatCents(sums.reduce((a, s) => a + s[k], 0)))]} />
    </Card>
  );
}

// --- Spending by category: stacked chart + heatmap table ---

function CategoryCard({ ledger: l, months }: { ledger: Ledger; months: MonthRange }) {
  // Each category's spending for the months shown only.
  const byMonth = new Map([...spendingByMonth(l)].map(([id, list]) => [id, inRange(list, months)]));
  const labels = inRange(MONTH_SHORT, months);
  const names = new Map(l.categories.expense.map((c) => [c.id, c.name]));
  const yearTotal = (id: string) => byMonth.get(id)!.reduce((a, b) => a + b, 0);
  const ranked = [...byMonth.keys()].filter((id) => yearTotal(id) > 0).sort((a, b) => yearTotal(b) - yearTotal(a));
  // Colours follow the category's rank for the whole year, so they never change with the view.
  const top = ranked.slice(0, TOP_CATEGORIES);
  const rest = ranked.slice(TOP_CATEGORIES);
  const colors = seriesColors();
  const surface = token("--surface");

  const stacks = [
    ...top.map((id, i) => ({ name: names.get(id) ?? id, color: colors[i]!, data: byMonth.get(id)! })),
    ...(rest.length ? [{
      name: "Other", color: token("--series-other"),
      data: labels.map((_, m) => rest.reduce((a, id) => a + byMonth.get(id)![m]!, 0)),
    }] : []),
  ];
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: labels, ...axisStyle(), splitLine: { show: false } },
    yAxis: { type: "value", ...axisStyle(), axisLine: { show: false }, axisLabel: { color: token("--muted"), formatter: formatCompact } },
    series: stacks.map((st, i) => ({
      name: st.name, type: "bar", stack: "spend", data: st.data, barMaxWidth: 24,
      // A thin surface-coloured edge makes the 2px gap between stacked segments.
      itemStyle: { color: st.color, borderColor: surface, borderWidth: 1, borderRadius: i === stacks.length - 1 ? [4, 4, 0, 0] : 0 },
    })),
  };

  // Heatmap: one hue, darker = more. Shading is relative to the biggest cell.
  const max = Math.max(1, ...ranked.flatMap((id) => byMonth.get(id)!));
  const heat = token("--heat");
  return (
    <Card title="Spending by category" subtitle={`The ${top.length} biggest categories of the year, plus everything else. Click a cell in the table to see its entries.`}>
      <Chart option={option} height={320} label="Monthly spending stacked by category" />
      <div class="heatmap-wrap">
        <table class="data-table heatmap">
          <thead>
            <tr>
              <th>Category</th>
              {labels.map((m) => <th class="num">{m}</th>)}
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((id) => (
              <tr>
                <td>{names.get(id) ?? id}</td>
                {byMonth.get(id)!.map((v, i) => {
                  const m = months.first - 1 + i; // 0 = January
                  const a = v / max;
                  return (
                    <td class="num cell" style={{ background: v ? `rgba(${heat}, ${0.08 + a * 0.82})` : undefined, color: a > 0.5 ? "#fff" : undefined }}
                      onClick={() => v && showInLedger({ cat: id, kind: "expense", month: String(m + 1), member: viewedMember()?.id ?? "" })}
                      title={v ? `${names.get(id)}, ${labels[i]}: ${formatCents(v)}` : undefined}>
                      {v ? formatCompact(v) : ""}
                    </td>
                  );
                })}
                <td class="num"><b>{formatCompact(yearTotal(id))}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --- Weekly spending by source ---

function WeeklyCard({ ledger: l, year, start, lastDate }: { ledger: Ledger; year: number; start: string; lastDate: string }) {
  // Weeks from the one tracking starts in; the first is labelled with the start day.
  const weeks = weeklySpending(l, year).filter((w) => w.end >= start && w.start <= lastDate);
  const [c1, c2, c3] = seriesColors();
  const surface = token("--surface");
  const label = (from: string) => shortDate(from < start ? start : from);
  const sources = [
    { key: "bank", name: "Bank", color: c1 },
    { key: "card", name: "Card", color: c2 },
    { key: "cash", name: "Cash", color: c3 },
  ] as const;
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: weeks.map((w) => label(w.start)), ...axisStyle(), splitLine: { show: false } },
    yAxis: { type: "value", ...axisStyle(), axisLine: { show: false }, axisLabel: { color: token("--muted"), formatter: formatCompact } },
    series: sources.map((src, i) => ({
      name: src.name, type: "bar", stack: "week", barMaxWidth: 24,
      data: weeks.map((w) => w.bySource[src.key]),
      itemStyle: { color: src.color, borderColor: surface, borderWidth: 1, borderRadius: i === sources.length - 1 ? [4, 4, 0, 0] : 0 },
    })),
  };
  return (
    <Card title="Weekly spending" subtitle="Monday to Sunday, by where the money came from. Big one-off weeks stand out here.">
      <Chart option={option} height={300} label="Spending per week by bank, card and cash" />
      <TableView head={["Week of", "Bank", "Card", "Cash", "Total"]}
        rows={weeks.map((w) => [label(w.start), formatCents(w.bySource.bank), formatCents(w.bySource.card), formatCents(w.bySource.cash),
          formatCents(w.bySource.bank + w.bySource.card + w.bySource.cash)])} />
    </Card>
  );
}

// --- Balances over time ---

function BalancesCard({ ledger: l, year, start, lastDate }: { ledger: Ledger; year: number; start: string; lastDate: string }) {
  // The opening balances (the day before tracking starts), then the end of every week up to the last entry.
  const opening = dayBefore(start);
  const points = [opening, ...weeklySpending(l, year).map((w) => (w.end > lastDate ? lastDate : w.end)).filter((d) => d >= start)]
    .filter((d, i, all) => all.indexOf(d) === i && d <= lastDate);
  const hasLoans = l.accounts.some((a) => a.type === "loan");
  // The Include loans switch (shared with the Dashboard) can leave loans out of net worth.
  const withoutLoans = hasLoans && netWorthWithoutLoans.value;
  const series = balanceSeries(l, points).map((p) => (withoutLoans ? { ...p, netWorth: p.netWorth + p.loanDebt } : p));
  const [c1, c2, c3, c4, c5, c6] = seriesColors();
  // Once an investment account has a balance update, what it's worth gets a line; contributions go dashed beside it.
  const hasWorth = l.accounts.some((a) => a.type === "investment" && a.valuations?.length);
  const hasAssets = l.accounts.some((a) => a.type === "asset" && a.valuations?.length);
  const lines = [
    { key: "availableCash", name: "Available cash", color: c1 },
    { key: "cardDebt", name: "Card debt", color: c2 },
    ...(hasLoans ? [{ key: "loanDebt", name: "Loans owed", color: c6 }] as const : []),
    { key: "netWorth", name: "Net worth", color: c5 },
    ...(hasWorth ? [{ key: "investmentsWorth", name: "Investments worth", color: c3 }] as const : []),
    { key: "invested", name: "Invested this year", color: c3, dashed: hasWorth },
    ...(hasAssets ? [{ key: "assetsWorth", name: "Assets worth", color: token("--series-other") }] as const : []),
    { key: "saved", name: "Saved this year", color: c4 },
  ] as const;
  const label = (d: string) => (d === opening ? "Start" : shortDate(d));
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", valueFormatter: money },
    xAxis: { type: "category", boundaryGap: false, data: series.map((p) => label(p.date)), ...axisStyle(), splitLine: { show: false } },
    yAxis: { type: "value", ...axisStyle(), axisLine: { show: false }, axisLabel: { color: token("--muted"), formatter: formatCompact } },
    series: lines.map((ln) => ({
      name: ln.name, type: "line", data: series.map((p) => p[ln.key]),
      showSymbol: false, symbolSize: 8, itemStyle: { color: ln.color },
      lineStyle: { width: 2, color: ln.color, type: "dashed" in ln && ln.dashed ? "dashed" : "solid" },
      // With five to seven lines, each is named at its end as well as in the legend.
      endLabel: {
        show: true, color: token("--muted"),
        formatter: (p: { seriesName: string; value: number }) => `${p.seriesName} ${formatCompact(p.value)}`,
      },
      // Net worth ends close to available cash: nudge labels apart instead of overlapping.
      labelLayout: { moveOverlap: "shiftY" },
    })),
    grid: { ...(baseOption().grid as object), right: 200 },
  };
  return (
    <Card title="Balances over time" action={hasLoans && <IncludeLoans />}
      subtitle={`At the end of each week. Net worth is available cash minus card debt${hasLoans ? (withoutLoans ? ", with loans left out" : " and what loans still owe") : ""}${hasWorth || hasAssets ? `, plus ${hasWorth && hasAssets ? "investments and assets" : hasWorth ? "investments" : "assets"} at what you last updated them to` : ""}. ${hasWorth ? "Invested this year is what you put in." : "Investments count what you put in this year, not market value."} Saved is what went into savings minus what came out.`}>
      <Chart option={option} height={320} label={`Available cash, card debt, ${hasLoans ? "loans owed, " : ""}net worth, ${hasWorth ? "investments worth, " : ""}investments, ${hasAssets ? "assets worth, " : ""}and savings over the year`} />
      <TableView head={["Date", ...lines.map((x) => x.name)]}
        rows={series.map((p) => [label(p.date), ...lines.map((x) => formatCents(p[x.key]))])} />
    </Card>
  );
}
