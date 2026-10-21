// Dashboard: the month (or year so far) at a glance. Mostly figures and simple bars;
// the charts live on the Reports page.

import { useSignal, useSignalEffect } from "@preact/signals";
import {
  accountsOverview, budgetView, earningsByCategory, monthProgress, netEarningCategories, receivables, remainingRetirement, spendByCategory, summarize, tagTotal,
} from "../derive";
import { formatCents, formatPercent } from "../money";
import { current, iraLimit, ledger, pinnedTags, savePinnedTags } from "../state";
import type { Ledger } from "../derive";
import type { Account } from "../types";
import { BudgetBar } from "./budget";
import { showInLedger } from "./ledger";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const PERIOD_KEY = "dashboard-period";

function loadPeriod(): string {
  try {
    return sessionStorage.getItem(PERIOD_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Last day of a month as "YYYY-MM-DD". */
function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function DashboardView() {
  /** "" = year so far, "1".."12" = that month. */
  const period = useSignal(loadPeriod());
  useSignalEffect(() => {
    try {
      sessionStorage.setItem(PERIOD_KEY, period.value);
    } catch {
      // Not kept; the dashboard still works.
    }
  });

  const month = period.value ? Number(period.value) : undefined;
  const data = current.value;
  const l = ledger.value;
  if (!data || !l) {
    return (
      <section class="panel">
        <h2>Dashboard</h2>
        <p>No data yet. Go to <a href="#/data">Data</a> to import a year.</p>
      </section>
    );
  }
  // A year of entries is small: computing on every render is fast and always current.
  const { setup } = data;
  const sum = summarize(l, month);
  const cats = spendByCategory(l, month);
  const accounts = accountsOverview(l, month ? monthEnd(setup.year, month) : undefined);
  const lastMonth = Math.max(0, ...[...l.expenses, ...l.earnings, ...l.transfers].map((e) => Number(e.date.slice(5, 7))));
  const periodName = month ? `${MONTHS[month - 1]} ${setup.year}` : `${setup.year} so far`;

  return (
    <div class="dashboard">
      <div class="filters">
        <select value={period.value} onChange={(e) => (period.value = e.currentTarget.value)} aria-label="Period">
          <option value="">Year to date</option>
          {MONTHS.slice(0, Math.max(lastMonth, month ?? 0)).map((m, i) => <option value={String(i + 1)}>{m}</option>)}
        </select>
      </div>

      <section class="hero card">
        <div class="tile-label">Surplus · {periodName}</div>
        <div class={`hero-value ${sum.surplus < 0 ? "neg" : ""}`}>{formatCents(sum.surplus)}</div>
        <div class="muted">
          Earned {formatCents(sum.earned)} − spent {formatCents(sum.spent)}
        </div>
      </section>

      <div class="tiles">
        <Tile label="Earned" value={formatCents(sum.earned)}
          detail={`Paychecks ${formatCents(sum.paycheck)} · other ${formatCents(sum.otherEarned)}`} />
        <Tile label="Spent" value={formatCents(sum.spent)}
          detail={`Bank ${formatCents(sum.spentBySource.bank)} · card ${formatCents(sum.spentBySource.card)} · cash ${formatCents(sum.spentBySource.cash)}`} />
        <Tile label="Net earnings" value={formatCents(sum.netEarnings)} detail={netEarningsDetail(l)} />
        <Tile label="Net spending" value={formatCents(sum.netSpent)}
          detail={`After ${formatCents(sum.offsets)} of refunds and points${sum.owed ? ` and ${formatCents(sum.owed)} owed to you` : ""}`} />
        <Tile label="Savings rate" value={formatPercent(sum.savingsRate)}
          detail={`${formatCents(sum.netSavings)} saved, of paychecks`} />
        <Tile label="Investment rate" value={formatPercent(sum.investmentRate)}
          detail={`${formatCents(sum.investment)} invested: retirement ${formatPercent(sum.investment ? sum.investRetirement / sum.investment : null, 0)}, taxable ${formatPercent(sum.investment ? sum.investTaxable / sum.investment : null, 0)}`} />
        <Tile label="Charity" value={formatCents(sum.charity)} detail={`${formatPercent(sum.charityRate)} of paychecks`} />
        <Tile label="Loan payments" value={formatCents(sum.loan)} detail="Counted in spending" />
        {pinnedTags.value.map((id) => {
          const tag = setup.tags.find((t) => t.id === id);
          return tag ? (
            <Tile label={tag.name} value={formatCents(tagTotal(l, id, month))} detail="Pinned tag"
              onRemove={() => savePinnedTags(pinnedTags.value.filter((t) => t !== id))} />
          ) : null;
        })}
        <PinTag />
      </div>

      <div class="columns">
        <div class="stack">
        <section class="card">
          <h3>Earnings by category</h3>
          <p class="muted small">{periodName}, including refunds, points and money paid back. Click a category to see its entries.</p>
          <CategoryBars tone="earning" amounts={earningsByCategory(l, month)}
            names={new Map(setup.categories.earning.map((c) => [c.id, c.name]))} empty="No earnings in this period."
            onPick={(cat) => showInLedger({ cat, kind: "earning", month: period.value })} />
        </section>

        <section class="card">
          <h3>Spending by category</h3>
          <p class="muted small">{periodName}. Click a category to see its entries.</p>
          <CategoryBars tone="expense" amounts={new Map([...cats].map(([id, c]) => [id, c.gross]))}
            names={new Map(setup.categories.expense.map((c) => [c.id, c.name]))} empty="No spending in this period."
            onPick={(cat) => showInLedger({ cat, kind: "expense", month: period.value })} />
        </section>

        <BudgetCard month={month} lastMonth={Math.max(1, lastMonth)} />
        </div>

        <section class="card">
          <h3>Accounts</h3>
          <p class="muted small">{month ? `At the end of ${MONTHS[month - 1]}` : "Today"}</p>
          <AccountsTable overview={accounts} accounts={setup.accounts} />
          <RetirementRoom left={remainingRetirement(l, iraLimit.value)} limit={iraLimit.value} />
          <Owed />
        </section>
      </div>
    </div>
  );
}

/** Which categories make up net earnings, e.g. "Paycheck + Interest + Tax Refund". */
function netEarningsDetail(l: Ledger): string {
  const ids = netEarningCategories(l);
  const names = l.categories.earning.filter((c) => ids.has(c.id)).map((c) => c.name);
  return names.length ? names.join(" + ") : "No categories count. Choose them on the Accounts page.";
}

function Tile(props: { label: string; value: string; detail?: string; onRemove?: () => void }) {
  return (
    <div class="tile card">
      <div class="tile-label">
        {props.label}
        {props.onRemove && (
          <button type="button" class="unpin" aria-label={`Unpin ${props.label}`} onClick={props.onRemove}>×</button>
        )}
      </div>
      <div class="tile-value">{props.value}</div>
      {props.detail && <div class="tile-detail">{props.detail}</div>}
    </div>
  );
}

/** A tile-sized control to pin another tag's total to the dashboard. */
function PinTag() {
  const setup = current.value!.setup;
  const choices = setup.tags.filter((t) => !pinnedTags.value.includes(t.id));
  if (!choices.length) return null;
  return (
    <label class="tile card pin-tile">
      <span class="tile-label">Pin a tag total</span>
      <select value="" onChange={(e) => e.currentTarget.value && savePinnedTags([...pinnedTags.value, e.currentTarget.value])}>
        <option value="">Choose a tag…</option>
        {choices.map((t) => <option value={t.id}>{t.name}</option>)}
      </select>
    </label>
  );
}

/** Horizontal bars, one hue: the job is comparing amounts, not telling categories apart. */
function CategoryBars(props: {
  /** Bar colour: green for earnings, red for spending, matching the ledger. */
  tone: "earning" | "expense";
  /** Category id -> amount. Categories at 0 are left out. */
  amounts: Map<string, number>;
  names: Map<string, string>;
  empty: string;
  onPick: (cat: string) => void;
}) {
  const rows = [...props.amounts].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <p class="muted">{props.empty}</p>;
  const max = rows[0]![1];
  const total = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <ul class="hbars">
      {rows.map(([id, v]) => (
        <li>
          <button type="button" onClick={() => props.onPick(id)}>
            <span class="hbar-name">{props.names.get(id) ?? id}</span>
            <span class="hbar-track">
              <span class={`hbar-fill ${props.tone}`} style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <span class="hbar-value">{formatCents(v)}</span>
            <span class="hbar-share">{formatPercent(v / total, 0)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AccountsTable(props: { overview: ReturnType<typeof accountsOverview>; accounts: Account[] }) {
  const o = props.overview;
  const bal = (a: Account) => o.balances.get(a.id) ?? 0;
  const live = props.accounts.filter((a) => !a.archived || bal(a) !== 0);
  const group = (types: Account["type"][]) => live.filter((a) => types.includes(a.type));
  const cardStatus = new Map(o.cards.map((c) => [c.account.id, c]));

  return (
    <table class="acct-table">
      <tbody>
        {group(["checking", "savings", "cash"]).map((a) => (
          <tr>
            <td>{a.name}</td>
            <td class="num">{formatCents(bal(a))}</td>
          </tr>
        ))}
        <tr class="subtotal">
          <td>Available cash</td>
          <td class="num">{formatCents(o.availableCash)}</td>
        </tr>
        {group(["credit"]).map((a) => {
          const c = cardStatus.get(a.id)!;
          return (
            <tr>
              <td>
                {a.name}
                <Meter fraction={c.utilization} />
              </td>
              <td class="num">
                {c.debt ? `${formatCents(c.debt)} owed` : bal(a) > 0 ? `${formatCents(bal(a))} credit` : "Paid off"}
                <div class="tile-detail">{formatPercent(c.utilization)} used</div>
              </td>
            </tr>
          );
        })}
        <tr class="subtotal">
          <td>Card debt · {formatPercent(o.utilization, 2)} of limits</td>
          <td class="num">{formatCents(o.cardDebt)}</td>
        </tr>
        <tr class="total">
          <td>Net tangible assets</td>
          <td class="num">{formatCents(o.netTangibleAssets)}</td>
        </tr>
        {group(["investment"]).map((a) => (
          <tr>
            <td>{a.name} <span class="muted small">invested this year</span></td>
            <td class="num">{formatCents(o.invested.get(a.id) ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Utilization as a thin bar. Over 30% shows as a warning, with the percentage beside it in text. */
function Meter({ fraction }: { fraction: number | null }) {
  if (fraction === null) return null;
  const pct = Math.min(1, fraction) * 100;
  return (
    <span class={`meter ${fraction > 0.3 ? "high" : ""}`} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function RetirementRoom({ left, limit }: { left: number; limit: number }) {
  return (
    <p class="note">
      Retirement room left this year: <b>{formatCents(left)}</b> of the {formatCents(limit)} limit{" "}
      <a href="#/data" class="small">change</a>
    </p>
  );
}

function Owed() {
  const l = ledger.value!;
  const people = current.value!.setup.people ?? [];
  const owed = [...receivables(l)].filter(([, v]) => v !== 0);
  if (!owed.length) return null;
  return (
    <div class="owed">
      <h4>Owed to you</h4>
      <ul>
        {owed.map(([id, v]) => (
          <li>
            {people.find((p) => p.id === id)?.name ?? id}{" "}
            {v > 0 ? <>owes you <b>{formatCents(v)}</b></> : <>paid you <b>{formatCents(-v)}</b> more than owed</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Budget progress for the period: one bar per budgeted category, plus the total. */
function BudgetCard({ month, lastMonth }: { month: number | undefined; lastMonth: number }) {
  const l = ledger.value!;
  const { setup } = current.value!;
  const months = month ? [month] : Array.from({ length: lastMonth }, (_, i) => i + 1);
  const view = budgetView(l, setup.budgets, setup.year, months);
  const lines = view.lines.filter((x) => x.target !== undefined);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const pace = month ? monthProgress(setup.year, month, today) : null;
  const names = new Map(setup.categories.expense.map((c) => [c.id, c.name]));
  const left = view.budgeted - view.spentBudgeted;

  return (
    <section class="card">
      <h3>Budget</h3>
      {lines.length === 0 ? (
        <p class="muted small">No budgets yet. <a href="#/budget">Set monthly targets</a> to track spending against them.</p>
      ) : (
        <>
          <p class="muted small">
            {formatCents(view.spentBudgeted)} of {formatCents(view.budgeted)} ·{" "}
            {left < 0 ? <span class="over">over by {formatCents(-left)}</span> : `${formatCents(left)} left`}
            {pace !== null && " · the tick marks today"}
          </p>
          <ul class="budget-list">
            {lines.map((line) => (
              <li>
                <span class="hbar-name">{names.get(line.cat) ?? line.cat}</span>
                <BudgetBar line={line} pace={pace} />
                <span class="num small">
                  {line.remaining! < 0 ? <span class="over">{formatCents(-line.remaining!)} over</span> : `${formatCents(line.remaining!)} left`}
                </span>
              </li>
            ))}
          </ul>
          <a href="#/budget" class="small">Open budget</a>
        </>
      )}
    </section>
  );
}
