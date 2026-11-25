// Reports: charts for the whole year. Loaded on demand, so ECharts doesn't slow down
// the rest of the app. Every chart has a table with the same numbers under it.
// With more than one person, they can show one person's entries; balances stay in "All people".

import { useSignal, useSignalEffect } from "@preact/signals";
import type { ComponentChildren } from "preact";
import {
  MONTH_SHORT, balanceSeries, cardSpending, earningsByMonth, hasLoanAccount, moneyFlow, monthlySummaries, ratio, shortDate, spendingByMonth, subscriptionTags, subscriptions, taggedWith, itemKey, ledgerOf, forMember, localToday, weeklyEarnings, weeklySpending,
  type Cadence, type FlowGroup, type Ledger,
} from "../derive";
// Every amount on this page goes through these, so Hide the numbers covers them all.
import { maskedCents as formatCents, maskedCompact as formatCompact } from "../hide-numbers";
import { formatPercent } from "../money";
import { membersOf } from "../setup";
import { current, ledger, loansLeftOut, years } from "../state";
import { IncludeLoans } from "./dashboard";
import { Chart, axisStyle, baseOption, escapeHtml, money, moneyAxis, narrowScreen, seriesColors, token, tooltipDot, tooltipRow, type ChartOption } from "./chart";
import { CardTitle } from "./help";
import { showInLedger } from "./ledger";
import { MemberPicker, viewedLedger, viewedMember } from "./people";
import { NoData } from "./no-data";
import type { Expense, Tag } from "../types";
import { loadYear, type YearData } from "../db";
import { dayBefore, firstMonth, yearStart } from "../year";

/** How many categories get their own colour in the stacked chart; the rest fold into "Everything else". */
const TOP_CATEGORIES = 6;

/** How many credit cards get their own slice in Credit card usage; the rest fold into "Other cards". */
const TOP_CARDS = 10;

/** A stacked bar segment, rounded at the top only when it's the bar's top segment. */
const stackSegment = (value: number, isTop: boolean) => ({ value, itemStyle: { borderRadius: isTop ? [4, 4, 0, 0] : 0 } });

export function ReportsView() {
  const all = ledger.value;
  const l = viewedLedger();
  const member = viewedMember();
  const data = current.value;
  if (!all || !l || !data) {
    return (
      <section class="panel">
        <h2>Reports</h2>
        <NoData />
      </section>
    );
  }
  const year = data.setup.year;
  const start = yearStart(data.setup);
  // The same months and weeks for everyone, so one person's charts line up with the household's.
  const dates = [...all.expenses, ...all.earnings, ...all.transfers].map((e) => e.date);
  const lastDate = dates.reduce((a, b) => (a > b ? a : b), start);
  // Subscriptions are judged on the latest entry not after today: one dated ahead doesn't stop them all.
  const today = localToday();
  const asOf = dates.filter((d) => d <= today).reduce((a, b) => (a > b ? a : b), start);
  // Balances over time also runs to the latest investment balance update, so one made after the last entry shows.
  const balancesEnd = all.accounts.flatMap((a) => a.valuations ?? []).reduce((d, v) => (v.date > d ? v.date : d), lastDate);
  // Only show months that have been tracked: from the start month (January, unless the year
  // began partway through) to the last month with entries, or December once a year is closed.
  const months = { first: firstMonth(data.setup), last: data.setup.closed ? 12 : Number(lastDate.slice(5, 7)) };

  return (
    <div class="reports">
      {membersOf(data.setup).length > 1 && <div class="filters"><MemberPicker /></div>}
      {member && <p class="muted member-note">{member.name}’s entries only. Account balances are shared, so they’re under All people.</p>}
      {/* First: where the balances stand. Account balances are shared, so it's left out for one person. */}
      {!member && <BalancesCard ledger={l} year={year} start={start} lastDate={balancesEnd} />}
      <MoneyFlowCard ledger={l} year={year} />
      <CashFlowCard ledger={l} months={months} />
      <ReportTabs title="Earning reports" id="earning" tabs={{
        category: { label: "Earnings by category", body: <CategoryCard ledger={l} months={months} kind="earning" /> },
        weekly: { label: "Weekly earnings", body: <WeeklyEarningCard ledger={l} year={year} start={start} lastDate={lastDate} /> },
      }} />
      <ReportTabs title="Expense reports" id="expense" tabs={{
        category: { label: "Spending by category", body: <CategoryCard ledger={l} months={months} kind="expense" /> },
        weekly: { label: "Weekly spending", body: <WeeklyCard ledger={l} year={year} start={start} lastDate={lastDate} /> },
        subscriptions: { label: "Subscriptions", body: <SubscriptionsCard ledger={l} months={months} tags={data.setup.tags} asOf={asOf} year={year} /> },
        cards: { label: "Credit card usage", body: <CardUsageCard ledger={l} /> },
      }} />
      <ReportTabs title="Savings and investment reports" id="saving" tabs={{
        savings: { label: "Monthly savings", body: <SavingsCard ledger={l} months={months} /> },
        investment: { label: "Monthly investment", body: <InvestmentCard ledger={l} months={months} /> },
      }} />
    </div>
  );
}

/**
 * A titled section of reports, one shown at a time under tabs (Earning, Expense, Savings and investment reports).
 * Each section's tab lasts until the browser tab is closed.
 */
function ReportTabs(props: { title: string; id: string; tabs: Record<string, { label: string; body: ComponentChildren }> }) {
  const keys = Object.keys(props.tabs);
  const key = `reports-tab-${props.id}`;
  const tab = useSignal((() => {
    try {
      const saved = sessionStorage.getItem(key);
      return saved && keys.includes(saved) ? saved : keys[0]!;
    } catch {
      return keys[0]!;
    }
  })());
  useSignalEffect(() => {
    try {
      sessionStorage.setItem(key, tab.value);
    } catch {
      // Not kept; the tabs still work.
    }
  });
  return (
    <section class="report-tabs" aria-labelledby={`${props.id}-title`}>
      <h2 class="section-title" id={`${props.id}-title`}>{props.title}</h2>
      <div class="tab-bar" role="tablist" aria-labelledby={`${props.id}-title`}>
        {keys.map((k) => (
          <button type="button" role="tab" id={`${props.id}-tab-${k}`} aria-selected={tab.value === k} aria-controls={`${props.id}-panel-${k}`}
            class={tab.value === k ? "active" : ""} onClick={() => (tab.value = k)}>
            {props.tabs[k]!.label}
          </button>
        ))}
      </div>
      {/* Only the open tab is drawn, so hidden charts cost nothing. */}
      <div class="tab-panel" role="tabpanel" id={`${props.id}-panel-${tab.value}`} aria-labelledby={`${props.id}-tab-${tab.value}`}>
        {props.tabs[tab.value]!.body}
      </div>
    </section>
  );
}

function Card(props: { title: string; subtitle: string; action?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="card report">
      {props.action ? (
        <div class="card-head">
          <CardTitle title={props.title}>{props.subtitle}</CardTitle>
          {props.action}
        </div>
      ) : <CardTitle title={props.title}>{props.subtitle}</CardTitle>}
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
      <div class="table-scroll">
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
      </div>
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
        const name = (id?: string) => escapeHtml(flow.nodes.find((n) => n.id === id)?.name ?? id ?? "");
        return p.dataType === "edge"
          ? `${name(p.data.source)} → ${name(p.data.target)}<br><b>${formatCents(p.data.value)}</b>`
          : `${escapeHtml(p.name)}<br><b>${formatCents(value.get((p.data as unknown as { id: string }).id) ?? 0)}</b>`;
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
      {/* Its labels need the width: on a phone it keeps it, and scrolls sideways. */}
      <div class="wide-chart">
        <Chart option={option} height={height} label={`Money flow for ${year}: ${formatCents(total)} in total`} />
      </div>
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
  const surface = token("--surface");
  // Net is part of the whole (net earnings of Earned, net spending of Spent), so each bar shows
  // the net amount solid, topped up in a lighter shade to the whole: the bar's height is the whole.
  // Net spending dips below zero in a month refunds outweigh spending; the bar can't show that,
  // so it's drawn as zero there, and the tooltip and table give the real figure.
  const pair = (stack: string, color: string, net: string, whole: string, nets: number[], wholes: number[]) => {
    const shown = nets.map((n, m) => Math.max(0, Math.min(n, wholes[m]!)));
    return [
      { name: net, type: "bar", stack, data: shown.map((v, m) => stackSegment(v, v >= wholes[m]!)),
        itemStyle: { color, borderColor: surface, borderWidth: 1 }, barMaxWidth: 24, barGap: "15%" },
      { name: whole, type: "bar", stack, data: shown.map((v, m) => stackSegment(wholes[m]! - v, true)),
        itemStyle: { color, opacity: 0.4, borderColor: surface, borderWidth: 1 }, barMaxWidth: 24 },
    ];
  };
  // Each month's background: green when it ended in surplus, red in deficit, none when even.
  // The axis's split areas take one colour per month, in order.
  const tint = (tone: string) => `${token(tone)}1f`; // the token's hex, at 12% opacity
  const bands = sums.map((s) => (s.surplus > 0 ? tint("--earning") : s.surplus < 0 ? tint("--expense") : "transparent"));
  const row = (marker: string, name: string, cents: number) => tooltipRow(marker, name, formatCents(cents));
  const option: ChartOption = {
    ...baseOption(),
    tooltip: {
      ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" },
      // The real figures, not the segments: the lighter segment is only the difference.
      formatter: (params: { dataIndex: number }[]) => {
        const m = params[0]!.dataIndex;
        const s = sums[m]!;
        return `<div style="margin-bottom:4px">${labels[m]}</div>`
          + row(tooltipDot(c1!, true), "Earned", s.earned) + row(tooltipDot(c1!, false), "Net earned", s.netEarnings)
          + row(tooltipDot(c2!, true), "Spent", s.spent) + row(tooltipDot(c2!, false), "Net spending", s.netSpent)
          + (s.surplus === 0 ? "" : row(tooltipDot(token(s.surplus > 0 ? "--earning" : "--expense"), true), s.surplus > 0 ? "Surplus" : "Deficit", Math.abs(s.surplus)));
      },
    },
    legend: { ...(baseOption().legend as object), data: ["Earned", "Net earned", "Spent", "Net spending"] },
    xAxis: {
      type: "category", data: labels, ...axisStyle(),
      // A gap in the card's colour between months, so two green months don't run together.
      splitLine: { show: true, interval: 0, lineStyle: { color: surface, width: 3 } },
      splitArea: { show: true, interval: 0, areaStyle: { color: bands } },
    },
    yAxis: moneyAxis(),
    series: [
      ...pair("earned", c1!, "Net earned", "Earned", sums.map((s) => s.netEarnings), sums.map((s) => s.earned)),
      ...pair("spent", c2!, "Net spending", "Spent", sums.map((s) => s.netSpent), sums.map((s) => s.spent)),
    ],
  };
  const keys = ["earned", "netEarnings", "spent", "netSpent", "surplus"] as const;
  return (
    <Card title="Monthly cash flow" subtitle="Earned and spent each month. The solid part of each bar is the net amount: net earned within Earned, net spending within Spent. A green month ended in surplus, a red one in deficit.">
      <Chart option={option} height={300} label="Earned and net earned, spent and net spending, per month" />
      <TableView head={["Month", "Earned", "Net earned", "Spent", "Net spending", "Surplus"]}
        rows={sums.map((s, i) => [labels[i]!, ...keys.map((k) => formatCents(s[k]))])}
        foot={["Total", ...keys.map((k) => formatCents(sums.reduce((a, s) => a + s[k], 0)))]} />
    </Card>
  );
}

// --- Spending (or earnings) by category: stacked chart + heatmap table ---

function CategoryCard({ ledger: l, months, kind }: { ledger: Ledger; months: MonthRange; kind: "expense" | "earning" }) {
  // Each category's totals for the months shown only.
  const all = kind === "expense" ? spendingByMonth(l) : earningsByMonth(l);
  const byMonth = new Map([...all].map(([id, list]) => [id, inRange(list, months)]));
  const labels = inRange(MONTH_SHORT, months);
  const names = new Map(l.categories[kind].map((c) => [c.id, c.name]));
  const what = kind === "expense" ? "spending" : "earnings";
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
      name: "Everything else", color: token("--series-other"),
      data: labels.map((_, m) => rest.reduce((a, id) => a + byMonth.get(id)![m]!, 0)),
    }] : []),
  ];
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: labels, ...axisStyle(), splitLine: { show: false } },
    yAxis: moneyAxis(),
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
    <Card title={kind === "expense" ? "Spending by category" : "Earnings by category"}
      subtitle={`The ${top.length} biggest categories of the year${rest.length ? ", plus everything else" : ""}. Click a cell in the table to see its entries.`}>
      <Chart option={option} height={320} label={`Monthly ${what} stacked by category`} />
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
                      onClick={() => v && showInLedger({ cat: id, kind, month: String(m + 1), member: viewedMember()?.id ?? "" })}
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
    yAxis: moneyAxis(),
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

// --- Weekly earnings: net and the rest ---

function WeeklyEarningCard({ ledger: l, year, start, lastDate }: { ledger: Ledger; year: number; start: string; lastDate: string }) {
  const weeks = weeklyEarnings(l, year).filter((w) => w.end >= start && w.start <= lastDate);
  const [c1] = seriesColors();
  const surface = token("--surface");
  const label = (from: string) => shortDate(from < start ? start : from);
  // The same shading as Monthly cash flow: net earned solid, the rest lighter on top.
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: weeks.map((w) => label(w.start)), ...axisStyle(), splitLine: { show: false } },
    yAxis: moneyAxis(),
    series: [
      { name: "Net earned", type: "bar", stack: "week", barMaxWidth: 24, data: weeks.map((w) => stackSegment(w.net, w.other === 0)),
        itemStyle: { color: c1, borderColor: surface, borderWidth: 1 } },
      { name: "Other earnings", type: "bar", stack: "week", barMaxWidth: 24, data: weeks.map((w) => stackSegment(w.other, true)),
        itemStyle: { color: c1, opacity: 0.4, borderColor: surface, borderWidth: 1 } },
    ],
  };
  return (
    <Card title="Weekly earnings" subtitle="Monday to Sunday. Net earned is solid; refunds, points, money paid back and one-offs are lighter on top.">
      <Chart option={option} height={300} label="Earnings per week, net and other" />
      <TableView head={["Week of", "Net earned", "Other earnings", "Total"]}
        rows={weeks.map((w) => [label(w.start), formatCents(w.net), formatCents(w.other), formatCents(w.net + w.other)])} />
    </Card>
  );
}

// --- Credit card usage: a ring of what each card paid ---

function CardUsageCard({ ledger: l }: { ledger: Ledger }) {
  const colors = seriesColors(10);
  const surface = token("--surface");
  // The ten cards that paid the most get a slice; any smaller ones share "Other cards", so the
  // fold only ever hides the smallest. With ten cards or fewer, a card's colour is its place in
  // the account list, used or not, so colours never swap as amounts change. With more, the
  // colours go by the named cards' order. Slices and rows run largest first.
  const cards = cardSpending(l);
  const biggest = new Set([...cards].filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, TOP_CARDS));
  const named = cards.filter((c) => biggest.has(c)).map((c, i) => ({
    id: c.account.id, name: c.account.name, spent: c.spent, color: colors[cards.length <= TOP_CARDS ? cards.indexOf(c) : i]!,
  }));
  const others = cards.filter((c) => !biggest.has(c)).reduce((a, c) => a + c.spent, 0);
  const slices = [...named, ...(others ? [{ id: "", name: "Other cards", spent: others, color: token("--series-other") }] : [])]
    .filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent);
  const total = slices.reduce((a, c) => a + c.spent, 0);
  const member = viewedMember()?.id ?? "";

  if (!total) {
    return (
      <Card title="Credit card usage" subtitle="What each credit card paid for this year.">
        <p class="muted">{cards.length ? "No spending on credit cards yet." : "No credit card accounts. Add one on the Accounts page."}</p>
      </Card>
    );
  }
  const option: ChartOption = {
    ...baseOption(),
    tooltip: {
      ...(baseOption().tooltip as object), trigger: "item",
      formatter: (p: { color: string; name: string; value: number }) =>
        `${tooltipDot(p.color, false)}${escapeHtml(p.name)}<br><b>${formatCents(p.value)}</b> · ${formatPercent(p.value / total)}`,
    },
    legend: { ...(baseOption().legend as object), top: undefined, bottom: 0, left: "center" },
    // The total in the middle of the ring.
    title: {
      text: formatCompact(total), subtext: "On credit cards", left: "center", top: "39%", itemGap: 4,
      textStyle: { fontSize: 34, fontWeight: 600, color: token("--text") }, subtextStyle: { fontSize: 13, color: token("--muted") },
    },
    series: [{
      type: "pie", radius: ["50%", "60%"], center: ["50%", "46%"],
      // Every slice is named beside the ring: with up to ten cards, some colours are close.
      label: {
        show: true, color: token("--muted"), fontSize: 12,
        formatter: (p: { name: string; value: number }) => `${p.name}  ${formatCompact(p.value)}`,
      },
      labelLine: { length: 10, length2: 12, lineStyle: { color: token("--chart-axis") } },
      avoidLabelOverlap: true,
      itemStyle: { borderColor: surface, borderWidth: 2 }, emphasis: { scale: true, scaleSize: 4 },
      data: slices.map((c) => ({ name: c.name, value: c.spent, itemStyle: { color: c.color } })),
    }],
  };
  return (
    <Card title="Credit card usage" subtitle="What each credit card paid for this year. Click a card to see its entries.">
      <Chart option={option} height={400} label={`Spending by credit card, ${formatCents(total)} in all`}
        onPick={({ dataIndex }) => {
          const id = slices[dataIndex]?.id;
          if (id) showInLedger({ account: id, kind: "expense", member });
        }} />
      <TableView head={["Card", "Spent", "Share"]}
        rows={slices.map((c) => [c.name, formatCents(c.spent), formatPercent(c.spent / total)])}
        foot={["Total", formatCents(total), formatPercent(1)]} />
    </Card>
  );
}

// --- Subscriptions: expenses with the Subscription tag ---

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly", fortnightly: "Every two weeks", monthly: "Monthly", bimonthly: "Every two months",
  quarterly: "Quarterly", "twice-yearly": "Twice a year", yearly: "Yearly",
  irregular: "Now and then", new: "New", once: "Once a year",
};

/**
 * Last year's subscription payments, which tell how often this year's are paid. Empty until
 * loaded, when there's no last year, or when it can't be read: the card still works without.
 */
function useEarlierSubscriptions(year: number): Expense[] {
  const loaded = useSignal<{ year: number; data: YearData | null } | null>(null);
  useSignalEffect(() => {
    // Again when years are added or removed.
    const stored = years.value.some((y) => y.setup.year === year - 1);
    let overtaken = false;
    (stored ? loadYear(year - 1) : Promise.resolve(null)).then(
      (data) => { if (!overtaken) loaded.value = { year, data }; },
      () => { if (!overtaken) loaded.value = { year, data: null }; },
    );
    return () => { overtaken = true; };
  });
  const data = loaded.value?.year === year ? loaded.value.data : null;
  if (!data) return [];
  const member = viewedMember();
  const l = ledgerOf(data);
  const mine = member ? forMember(l, member.id, membersOf(data.setup)[0]!.id) : l;
  return taggedWith(mine.expenses, subscriptionTags(data.setup.tags));
}

/** "Mar 4", or "Dec 12, 2025" for a day in another year. */
const dayIn = (date: string, year: number) => (Number(date.slice(0, 4)) === year ? shortDate(date) : `${shortDate(date)}, ${date.slice(0, 4)}`);

function SubscriptionsCard({ ledger: l, months, tags, asOf, year }: { ledger: Ledger; months: MonthRange; tags: Tag[]; asOf: string; year: number }) {
  const title = "Subscriptions";
  const earlier = useEarlierSubscriptions(year);
  const subTags = subscriptionTags(tags);
  if (!subTags.length) {
    return (
      <Card title={title} subtitle="What you pay for again and again.">
        <p class="muted">No Subscription tag. Add a tag named Subscription on the Accounts page, and put it on the expenses that are subscriptions.</p>
      </Card>
    );
  }
  const tagNames = subTags.map((t) => t.name).join(" or ");
  const subs = subscriptions(taggedWith(l.expenses, subTags), asOf, earlier);
  if (!subs.length) {
    return (
      <Card title={title} subtitle="What you pay for again and again.">
        <p class="muted">No expenses tagged {tagNames} yet.</p>
      </Card>
    );
  }
  const active = subs.filter((s) => s.active);
  const priced = active.filter((s) => s.yearlyCost !== null);
  const unpriced = active.length - priced.length;
  const paid = subs.reduce((a, s) => a + s.total, 0);
  const payments = subs.reduce((a, s) => a + s.payments, 0);
  const yearly = priced.reduce((a, s) => a + s.yearlyCost!, 0);
  const labels = inRange(MONTH_SHORT, months);
  const perMonth = labels.map((_, i) => subs.reduce((a, s) => a + s.byMonth[months.first - 1 + i]!, 0));
  const [, c2] = seriesColors();
  const member = viewedMember()?.id ?? "";
  // Exactly the entries the row counts: the same name (ignoring case and spacing) with a Subscription
  // tag, up to the day it's judged on when some are entered past it.
  const tagged = taggedWith(l.expenses, subTags);
  const open = (name: string) => {
    const key = itemKey(name);
    const later = tagged.some((e) => e.date > asOf && itemKey(e.item) === key);
    showInLedger({
      ...(subTags.length === 1 ? { tag: subTags[0]!.id } : { itemTags: subTags.map((t) => t.id).join(",") }),
      ...(later ? { month: "range", to: asOf } : {}),
      item: key, kind: "expense", member,
    });
  };
  const option: ChartOption = {
    ...baseOption(),
    legend: undefined,
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: labels, ...axisStyle(), splitLine: { show: false } },
    yAxis: moneyAxis(),
    series: [{ name: "Subscriptions", type: "bar", barMaxWidth: 24, data: perMonth, itemStyle: { color: c2, borderRadius: [4, 4, 0, 0] } }],
  };
  return (
    <Card title={title}
      subtitle={`Expenses tagged ${tagNames}. Payments with the same name are one subscription; last year's help tell how often each is paid. One that has missed its next payment, as of your latest entry (${shortDate(asOf)}), counts as stopped. Click a row to see its entries.`}>
      <div class="tiles sub-tiles">
        <div class="tile">
          <div class="tile-label">Active subscriptions</div>
          <div class="tile-value">{active.length}</div>
          <div class="tile-detail">{subs.length} in all</div>
        </div>
        <div class="tile">
          <div class="tile-label">Paid this year</div>
          <div class="tile-value">{formatCents(paid)}</div>
          <div class="tile-detail">{payments} {payments === 1 ? "payment" : "payments"}</div>
        </div>
        <div class="tile">
          <div class="tile-label">A year of the active ones</div>
          <div class="tile-value">{formatCents(yearly)}</div>
          <div class="tile-detail">
            about {formatCents(Math.round(yearly / 12))} a month, at their latest prices
            {unpriced > 0 && `, without ${unpriced} too new to tell`}
          </div>
        </div>
      </div>
      <Chart option={option} height={260} label={`Subscription payments per month, ${formatCents(paid)} in all`} />
      <div class="heatmap-wrap">
        <table class="data-table sub-table">
          <thead>
            <tr>
              <th>Subscription</th><th>How often</th><th class="num">Payments</th><th class="num">Last paid</th>
              <th class="num">Last amount</th><th class="num">This year</th><th class="num">A year costs</th>
            </tr>
          </thead>
          <tbody>
            {/* One paid only last year, still running, has no entries this year to open. */}
            {subs.map((s) => (
              <tr class={[s.active ? "" : "stopped", s.payments ? "" : "unopened"].filter(Boolean).join(" ")}
                {...(s.payments ? {
                  tabIndex: 0, title: `See ${s.name}'s entries`, onClick: () => open(s.name),
                  onKeyDown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(s.name)),
                } : {})}>
                <td>{s.name}{!s.active && <span class="badge">stopped</span>}</td>
                <td>{CADENCE_LABEL[s.cadence]}</td>
                <td class="num">{s.payments}</td>
                <td class="num">{dayIn(s.last, year)}</td>
                <td class="num">{formatCents(s.lastAmount)}</td>
                <td class="num">{formatCents(s.total)}</td>
                <td class="num">{s.active && s.yearlyCost !== null ? formatCents(s.yearlyCost) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td><td /><td class="num">{payments}</td><td /><td />
              <td class="num">{formatCents(paid)}</td><td class="num">{formatCents(yearly)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// --- Monthly savings: moved into savings minus taken out ---

function SavingsCard({ ledger: l, months }: { ledger: Ledger; months: MonthRange }) {
  const sums = inRange(monthlySummaries(l), months);
  const labels = inRange(MONTH_SHORT, months);
  const [, , c3] = seriesColors();
  const total = sums.reduce((a, s) => a + s.netSavings, 0);
  const paid = sums.reduce((a, s) => a + s.paycheck, 0);
  if (!sums.some((s) => s.netSavings)) {
    return (
      <Card title="Monthly savings" subtitle="Moved into savings minus taken out, each month.">
        <p class="muted">No savings yet. They come from transfers in categories whose role is Into savings or Out of savings (see Accounts).</p>
      </Card>
    );
  }
  // Same colour as Savings in Where the money went. A month more was taken out than put in dips below zero.
  const option: ChartOption = {
    ...baseOption(),
    legend: undefined,
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: labels, ...axisStyle(), splitLine: { show: false } },
    yAxis: moneyAxis(),
    series: [{
      name: "Saved", type: "bar", barMaxWidth: 24, itemStyle: { color: c3 },
      data: sums.map((s) => ({ value: s.netSavings, itemStyle: { borderRadius: s.netSavings < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } })),
    }],
  };
  return (
    <Card title="Monthly savings" subtitle="Moved into savings minus taken out, each month. A month more came out than went in drops below the line.">
      <Chart option={option} height={300} label={`Savings per month, ${formatCents(total)} in all`} />
      <TableView head={["Month", "Saved", "Of paychecks"]}
        rows={sums.map((s, i) => [labels[i]!, formatCents(s.netSavings), formatPercent(s.savingsRate)])}
        foot={["Total", formatCents(total), formatPercent(ratio(total, paid))]} />
    </Card>
  );
}

// --- Monthly investment: retirement and taxable ---

function InvestmentCard({ ledger: l, months }: { ledger: Ledger; months: MonthRange }) {
  const sums = inRange(monthlySummaries(l), months);
  const labels = inRange(MONTH_SHORT, months);
  const [, , , c4] = seriesColors();
  const surface = token("--surface");
  const total = sums.reduce((a, s) => a + s.investment, 0);
  const paid = sums.reduce((a, s) => a + s.paycheck, 0);
  if (!total) {
    return (
      <Card title="Monthly investment" subtitle="Retirement and taxable investing, each month.">
        <p class="muted">No investing yet. It comes from transfers in categories whose role is Retirement investing or Taxable investing (see Accounts).</p>
      </Card>
    );
  }
  // Same colour as Investing in Where the money went: retirement solid, taxable lighter on top.
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: money },
    xAxis: { type: "category", data: labels, ...axisStyle(), splitLine: { show: false } },
    yAxis: moneyAxis(),
    series: [
      { name: "Retirement", type: "bar", stack: "invest", barMaxWidth: 24, data: sums.map((s) => stackSegment(s.investRetirement, s.investTaxable === 0)),
        itemStyle: { color: c4, borderColor: surface, borderWidth: 1 } },
      { name: "Taxable", type: "bar", stack: "invest", barMaxWidth: 24, data: sums.map((s) => stackSegment(s.investTaxable, true)),
        itemStyle: { color: c4, opacity: 0.4, borderColor: surface, borderWidth: 1 } },
    ],
  };
  return (
    <Card title="Monthly investment" subtitle="Retirement and taxable investing, each month. Retirement is solid; taxable is lighter on top.">
      <Chart option={option} height={300} label={`Investment per month, retirement and taxable, ${formatCents(total)} in all`} />
      <TableView head={["Month", "Retirement", "Taxable", "Total", "Of paychecks"]}
        rows={sums.map((s, i) => [labels[i]!, formatCents(s.investRetirement), formatCents(s.investTaxable), formatCents(s.investment), formatPercent(s.investmentRate)])}
        foot={["Total", ...(["investRetirement", "investTaxable"] as const).map((k) => formatCents(sums.reduce((a, s) => a + s[k], 0))), formatCents(total), formatPercent(ratio(total, paid))]} />
    </Card>
  );
}

// --- Balances over time ---

function BalancesCard({ ledger: l, year, start, lastDate }: { ledger: Ledger; year: number; start: string; lastDate: string }) {
  // The opening balances (the day before tracking starts), then the end of every week up to the last entry.
  const opening = dayBefore(start);
  const points = [opening, ...weeklySpending(l, year).map((w) => (w.end > lastDate ? lastDate : w.end)).filter((d) => d >= start)]
    .filter((d, i, all) => all.indexOf(d) === i && d <= lastDate);
  const hasLoans = hasLoanAccount(l.accounts);
  // The Include loans switch (shared with the Dashboard) can leave loans out of net worth.
  const withoutLoans = hasLoans && loansLeftOut.value;
  const series = balanceSeries(l, points).map((p) => (withoutLoans ? { ...p, netWorth: p.netWorthWithoutLoans } : p));
  const [c1, c2, c3, c4, c5, c6] = seriesColors();
  // Colours match Where the money went: savings c3, investing c4, loans c6.
  // Once an investment account has a balance update, what it's worth gets a line; contributions go dashed beside it.
  const hasWorth = l.accounts.some((a) => a.type === "investment" && a.valuations?.length);
  const hasAssets = l.accounts.some((a) => a.type === "asset" && a.valuations?.length);
  const lines = [
    { key: "availableCash", name: "Available cash", color: c1 },
    { key: "cardDebt", name: "Card debt", color: c2 },
    ...(hasLoans ? [{ key: "loanDebt", name: "Loans owed", color: c6 }] as const : []),
    { key: "netWorth", name: "Net worth", color: c5 },
    ...(hasWorth ? [{ key: "investmentsWorth", name: "Investments worth", color: c4 }] as const : []),
    { key: "invested", name: "Invested this year", color: c4, dashed: hasWorth },
    ...(hasAssets ? [{ key: "assetsWorth", name: "Assets worth", color: token("--series-other") }] as const : []),
    { key: "saved", name: "Saved this year", color: c3 },
  ] as const;
  const label = (d: string) => (d === opening ? "Start" : shortDate(d));
  // The end labels take 200px: on a phone the lines get that room instead, and the legend
  // and tooltip still name them.
  const endLabels = !narrowScreen.value;
  const option: ChartOption = {
    ...baseOption(),
    tooltip: { ...(baseOption().tooltip as object), trigger: "axis", valueFormatter: money },
    xAxis: { type: "category", boundaryGap: false, data: series.map((p) => label(p.date)), ...axisStyle(), splitLine: { show: false } },
    yAxis: moneyAxis(),
    series: lines.map((ln) => ({
      name: ln.name, type: "line", data: series.map((p) => p[ln.key]),
      showSymbol: false, symbolSize: 8, itemStyle: { color: ln.color },
      lineStyle: { width: 2, color: ln.color, type: "dashed" in ln && ln.dashed ? "dashed" : "solid" },
      // With five to seven lines, each is named at its end as well as in the legend.
      endLabel: {
        show: endLabels, color: token("--muted"),
        formatter: (p: { seriesName: string; value: number }) => `${p.seriesName} ${formatCompact(p.value)}`,
      },
      // Net worth ends close to available cash: nudge labels apart instead of overlapping.
      labelLayout: { moveOverlap: "shiftY" },
    })),
    grid: { ...(baseOption().grid as object), right: endLabels ? 200 : 16 },
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
