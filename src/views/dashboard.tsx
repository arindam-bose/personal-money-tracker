// Dashboard: the month (or year so far) at a glance. Mostly figures and simple bars;
// the charts live on the Reports page. With more than one person, it can show one
// person's figures; balances and budgets are the household's, so those stay in "All people".

import { useSignal, useSignalEffect } from "@preact/signals";
import {
  MONTH_NAMES, accountsOverview, budgetView, earningsByCategory, localToday, monthProgress, netEarningCategories, remainingRetirement, shortDate, spendingOffsetCategories, spendByCategory, summarize, tagTotal,
} from "../derive";
import { formatCents, formatPercent } from "../money";
import { current, iraLimit, ledger, ntaWithoutLoans, pinnedTags, saveNtaWithoutLoans, savePinnedTags } from "../state";

/** The switch for whether net tangible assets counts loans. One setting, shared by the Dashboard and Reports. */
export function IncludeLoans() {
  return (
    <label class="hero-toggle" title="Untick to see net tangible assets without what loans and mortgages owe">
      <input type="checkbox" checked={!ntaWithoutLoans.value} onChange={(e) => saveNtaWithoutLoans(!e.currentTarget.checked)} />
      <span>Include loans</span>
    </label>
  );
}
import type { Ledger } from "../derive";
import type { Account } from "../types";
import { firstMonth, yearStart } from "../year";
import { BudgetBar } from "./budget";
import { showInLedger } from "./ledger";
import { MemberPicker, viewedLedger, viewedMember } from "./people";

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
  const all = ledger.value;
  const l = viewedLedger();
  const member = viewedMember();
  if (!data || !all || !l) {
    return (
      <section class="panel">
        <h2>Dashboard</h2>
        <p>No data yet. Go to <a href="#/settings">Settings</a> to import a year or start one from scratch.</p>
      </section>
    );
  }
  // A year of entries is small: computing on every render is fast and always current.
  const { setup } = data;
  const sum = summarize(l, month);
  const cats = spendByCategory(l, month);
  // Balances come from every entry: accounts are shared.
  const accounts = accountsOverview(all, month ? monthEnd(setup.year, month) : undefined);
  const lastMonth = Math.max(0, ...[...all.expenses, ...all.earnings, ...all.transfers].map((e) => Number(e.date.slice(5, 7))));
  // A past year is complete; only the current one is "so far".
  const pastYear = setup.closed || setup.year < new Date().getFullYear();
  const periodName = month ? `${MONTH_NAMES[month - 1]} ${setup.year}` : pastYear ? `${setup.year}` : `${setup.year} so far`;
  const asOf = month ? `End of ${MONTH_NAMES[month - 1]}` : pastYear ? `End of ${setup.year}` : "Today";
  // Loans can be left out of net tangible assets, to see it without them. The switch only shows once there's a loan.
  const hasLoans = accounts.loans.length > 0;
  const withoutLoans = hasLoans && ntaWithoutLoans.value;
  const nta = withoutLoans ? accounts.netTangibleAssets + accounts.loanDebt : accounts.netTangibleAssets;
  // Clicking a category opens the ledger with the same period and person.
  const inLedger = { month: period.value, member: member?.id ?? "" };

  const earningsCard = (
    <section class="card">
      <h3>Earnings by category</h3>
      <p class="muted small">{periodName}, including refunds, points and money paid back. Click a category to see its entries.</p>
      <CategoryBars tone="earning" amounts={earningsByCategory(l, month)}
        names={new Map(setup.categories.earning.map((c) => [c.id, c.name]))} empty="No earnings in this period."
        onPick={(cat) => showInLedger({ ...inLedger, cat, kind: "earning" })} />
    </section>
  );
  const spendingCard = (
    <section class="card">
      <h3>Spending by category</h3>
      <p class="muted small">{periodName}. Click a category to see its entries.</p>
      <CategoryBars tone="expense" amounts={new Map([...cats].map(([id, c]) => [id, c.gross]))}
        names={new Map(setup.categories.expense.map((c) => [c.id, c.name]))} empty="No spending in this period."
        onPick={(cat) => showInLedger({ ...inLedger, cat, kind: "expense" })} />
    </section>
  );

  return (
    <div class="dashboard">
      <div class="filters">
        <select value={period.value} onChange={(e) => (period.value = e.currentTarget.value)} aria-label="Period">
          <option value="">{pastYear ? "Whole year" : "Year to date"}</option>
          {MONTH_NAMES.slice(0, Math.max(lastMonth, month ?? 0)).map((m, i) => i + 1 >= firstMonth(setup) && <option value={String(i + 1)}>{m}</option>)}
        </select>
        <MemberPicker />
      </div>

      {member ? (
        <p class="muted member-note">
          {member.name}’s entries only. Account balances and budgets are shared, so they’re under All people.
        </p>
      ) : (
        <section class="hero card">
          <div class="tile-label">
            <span>Net tangible assets · {asOf}</span>
            {hasLoans && <IncludeLoans />}
          </div>
          <div class={`hero-value ${nta < 0 ? "neg" : ""}`}>{formatCents(nta)}</div>
          <div class="muted">
            Available cash {formatCents(accounts.availableCash)} − card debt {formatCents(accounts.cardDebt)}
            {hasLoans && (withoutLoans ? <> · loans ({formatCents(accounts.loanDebt)} owed) left out</> : <> − loans owed {formatCents(accounts.loanDebt)}</>)}
            {accounts.valuations.size > 0 && <> + investments {formatCents(accounts.investmentsWorth)}</>}
          </div>
        </section>
      )}

      <div class="tiles">
        <Tile label="Earned" value={formatCents(sum.earned)}
          detail={`Paychecks ${formatCents(sum.paycheck)} · other ${formatCents(sum.otherEarned)}`} />
        <Tile label="Spent" value={formatCents(sum.spent)}
          detail={`Bank ${formatCents(sum.spentBySource.bank)} · card ${formatCents(sum.spentBySource.card)} · cash ${formatCents(sum.spentBySource.cash)}`} />
        <Tile label="Net earnings" value={formatCents(sum.netEarnings)} detail={netEarningsDetail(l)} />
        <Tile label="Net spending" value={formatCents(sum.netSpent)}
          detail={netSpendingDetail(l, sum.offsets)} />
        <Tile label="Surplus" value={formatCents(sum.surplus)} tone={sum.surplus > 0 ? "pos" : sum.surplus < 0 ? "neg" : undefined}
          detail={`Earned ${formatCents(sum.earned)} − spent ${formatCents(sum.spent)}`} />
        <Tile label="Savings" value={formatCents(sum.netSavings)}
          detail={`${formatPercent(sum.savingsRate)} of paychecks`} />
        <Tile label="Investment" value={formatCents(sum.investment)}
          detail={`${formatPercent(sum.investmentRate)} of paychecks · retirement ${formatPercent(sum.investment ? sum.investRetirement / sum.investment : null)}, taxable ${formatPercent(sum.investment ? sum.investTaxable / sum.investment : null)}`} />
        <Tile label="Credit card payments" value={formatCents(sum.ccPayments)} detail="Transfers, not counted in spending" />
        <Tile label="Charity" value={formatCents(sum.charity)} detail={`${formatPercent(sum.charityRate)} of paychecks`} />
        <Tile label="Loan payments" value={formatCents(sum.loanPayments)} detail="Transfers to loans, not counted in spending" />
        {pinnedTags.value.map((id) => {
          const tag = setup.tags.find((t) => t.id === id);
          return tag ? (
            <Tile label={tag.name} value={formatCents(tagTotal(l, id, month))} detail="Pinned tag"
              onRemove={() => savePinnedTags(pinnedTags.value.filter((t) => t !== id))} />
          ) : null;
        })}
        <PinTag />
      </div>

      {member ? (
        <div class="columns">
          {earningsCard}
          {spendingCard}
        </div>
      ) : (
        <div class="columns">
          <div class="stack">
            {earningsCard}
            {spendingCard}
            <BudgetCard month={month} lastMonth={Math.max(1, lastMonth)} />
          </div>

          <section class="card">
            <h3>Accounts</h3>
            <p class="muted small">{asOf}</p>
            <AccountsTable overview={accounts} accounts={setup.accounts} withoutLoans={withoutLoans} />
            <RetirementRoom left={remainingRetirement(all, iraLimit.value, setup.iraBeforeStart)} limit={iraLimit.value}
              before={setup.iraBeforeStart} start={yearStart(setup)} />
          </section>
        </div>
      )}
    </div>
  );
}

/** Which categories make up net earnings, e.g. "Paycheck + Interest + Tax Refund". */
function netEarningsDetail(l: Ledger): string {
  const ids = netEarningCategories(l);
  const names = l.categories.earning.filter((c) => ids.has(c.id)).map((c) => c.name);
  return names.length ? names.join(" + ") : "No categories count. Choose them on the Accounts page.";
}

/** What net spending takes off, e.g. "After $26,273.42 of Expenses Remunerated + Redeemed CC Points + Refunds". */
function netSpendingDetail(l: Ledger, offsets: number): string {
  const ids = spendingOffsetCategories(l);
  const names = l.categories.earning.filter((c) => ids.has(c.id)).map((c) => c.name);
  return names.length ? `After ${formatCents(offsets)} of ${names.join(" + ")}` : "No earning category lowers spending, so nothing comes off.";
}

function Tile(props: { label: string; value: string; detail?: string; tone?: "pos" | "neg"; onRemove?: () => void }) {
  return (
    <div class="tile card">
      <div class="tile-label">
        {props.label}
        {props.onRemove && (
          <button type="button" class="unpin" aria-label={`Unpin ${props.label}`} onClick={props.onRemove}>×</button>
        )}
      </div>
      <div class={`tile-value ${props.tone ?? ""}`}>{props.value}</div>
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
            <span class="hbar-share">{formatPercent(v / total)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AccountsTable(props: { overview: ReturnType<typeof accountsOverview>; accounts: Account[]; withoutLoans: boolean }) {
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
          <td>Card debt · {formatPercent(o.utilization)} of limits</td>
          <td class="num">{formatCents(o.cardDebt)}</td>
        </tr>
        {o.loans.filter((l) => !l.account.archived || l.owed !== 0).map((l) => (
          <tr>
            <td>{l.account.name}</td>
            <td class="num">
              {l.owed ? `${formatCents(l.owed)} owed` : "Paid off"}
              <div class="tile-detail">{formatCents(l.interest)} interest this year</div>
            </td>
          </tr>
        ))}
        {o.loans.length > 0 && (
          <tr class="subtotal">
            <td>Loans owed</td>
            <td class="num">{formatCents(o.loanDebt)}</td>
          </tr>
        )}
        {group(["investment"]).map((a) => {
          // Worth what it was last updated to; without an update it only shows this year's contributions.
          const v = o.valuations.get(a.id);
          return (
            <tr>
              <td>{a.name}</td>
              <td class="num">
                {v ? formatCents(v.amount) : <span class="muted">No balance yet</span>}
                <div class="tile-detail">
                  {v ? `on ${shortDate(v.date)} · ` : ""}{formatCents(o.invested.get(a.id) ?? 0)} invested this year
                </div>
              </td>
            </tr>
          );
        })}
        {o.valuations.size > 0 && (
          <tr class="subtotal">
            <td>Investments <span class="muted small">latest balances</span></td>
            <td class="num">{formatCents(o.investmentsWorth)}</td>
          </tr>
        )}
        <tr class="total">
          <td>Net tangible assets{props.withoutLoans && <span class="muted small"> without loans</span>}</td>
          <td class="num">{formatCents(props.withoutLoans ? o.netTangibleAssets + o.loanDebt : o.netTangibleAssets)}</td>
        </tr>
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

function RetirementRoom({ left, limit, before, start }: { left: number; limit: number; before?: number; start: string }) {
  return (
    <p class="note">
      Retirement room left this year: <b>{formatCents(left)}</b> of the {formatCents(limit)} limit
      {before ? <>, after {formatCents(before)} put in before {shortDate(start)}</> : null}{" "}
      <a href="#/settings" class="small">change</a>
    </p>
  );
}

/** Budget progress for the period: one bar per budgeted category, plus the total. */
function BudgetCard({ month, lastMonth }: { month: number | undefined; lastMonth: number }) {
  const l = ledger.value!;
  const { setup } = current.value!;
  // budgetView leaves out months before tracking started, and scales the first one.
  const months = month ? [month] : Array.from({ length: lastMonth }, (_, i) => i + 1);
  const view = budgetView(l, setup.budgets, setup.year, months, yearStart(setup));
  const lines = view.lines.filter((x) => x.target !== undefined);
  const pace = month ? monthProgress(setup.year, month, localToday(), yearStart(setup)) : null;
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
