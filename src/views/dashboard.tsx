// Dashboard: the month (or year so far) at a glance. Mostly figures and simple bars;
// the charts live on the Reports page. With more than one person, it can show one
// person's figures; balances and budgets are the household's, so those stay in "All people".

import type { ComponentChildren } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import {
  MONTH_NAMES, accountsOverview, hasLoanAccount, budgetView, earningsByCategory, localToday, monthProgress, netEarningNames, remainingRetirement, shortDate, spendingOffsetCategories, spendByCategory, summarize, tagTotal,
} from "../derive";
// Every amount on this page goes through this, so Hide the numbers covers them all.
import { maskedCents as formatCents } from "../hide-numbers";
import { formatPercent } from "../money";
import { current, iraLimit, ledger, loansLeftOut, pins, saveLoansLeftOut, savePins } from "../state";
import type { Ledger } from "../derive";
import type { Account } from "../types";
import { firstMonth, yearStart } from "../year";
import { BudgetBar } from "./budget";
import { FIGURE_CONCEPT as FIG, PINNED_CONCEPT, surplusConcept, type Concept } from "./concepts";
import { PinTotal } from "./pin-total";
import { showInLedger } from "./ledger";
import { NoData } from "./no-data";
import { MemberPicker, viewedLedger, viewedMember } from "./people";

/** The switch for whether net worth counts loans. One setting, shared by the Dashboard and Reports. */
export function IncludeLoans() {
  return (
    <label class="hero-toggle" title="Untick to see net worth without what loans and mortgages owe">
      <input type="checkbox" checked={!loansLeftOut.value} onChange={(e) => saveLoansLeftOut(!e.currentTarget.checked)} />
      <span>Include loans</span>
    </label>
  );
}
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
        <NoData />
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
  // Loans can be left out of net worth, to see it without them. The switch only shows once there's a loan.
  const hasLoans = hasLoanAccount(setup.accounts);
  const withoutLoans = hasLoans && loansLeftOut.value;
  const worth = withoutLoans ? accounts.netWorthWithoutLoans : accounts.netWorth;
  // Investments and assets only add to it once they have a value.
  const valued = (type: Account["type"]) => setup.accounts.some((a) => a.type === type && accounts.valuations.has(a.id));
  // Clicking a category opens the ledger with the same period and person.
  const inLedger = { month: period.value, member: member?.id ?? "" };

  const earningsCard = (
    <section class="card">
      <h3>Earnings by category</h3>
      <p class="muted small">{periodName}, including refunds, points and money paid back. Click a category to see its entries.</p>
      <CategoryBars tone="income" amounts={earningsByCategory(l, month)}
        names={new Map(setup.categories.earning.map((c) => [c.id, c.name]))} empty="No earnings in this period."
        onPick={(cat) => showInLedger({ ...inLedger, cat, kind: "earning" })} />
    </section>
  );
  const spendingCard = (
    <section class="card">
      <h3>Spending by category</h3>
      <p class="muted small">{periodName}. Click a category to see its entries.</p>
      <CategoryBars tone="spending" amounts={new Map([...cats].map(([id, c]) => [id, c.gross]))}
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
            <span>Net worth · {asOf}</span>
            {hasLoans && <IncludeLoans />}
          </div>
          <div class={`hero-value ${worth < 0 ? "neg" : ""}`}>{formatCents(worth)}</div>
          {/* What you own, then what you owe. */}
          <div class="muted">
            Available cash <b>{formatCents(accounts.availableCash)}</b>
            {valued("investment") && <> + investments <b>{formatCents(accounts.investmentsWorth)}</b></>}
            {valued("asset") && <> + assets <b>{formatCents(accounts.assetsWorth)}</b></>}
            {" "}− card debt <b>{formatCents(accounts.cardDebt)}</b>
            {hasLoans && (withoutLoans ? <> · loans (<b>{formatCents(accounts.loanDebt)}</b> owed) left out</> : <> − loans owed <b>{formatCents(accounts.loanDebt)}</b></>)}
          </div>
        </section>
      )}

      <div class="tiles">
        <Tile label="Earned" concept={FIG.earned} value={formatCents(sum.earned)}
          detail={[`Paychecks ${formatCents(sum.paycheck)}`, `Other ${formatCents(sum.otherEarned)}`]} />
        <Tile label="Net earnings" concept={FIG.netEarnings} value={formatCents(sum.netEarnings)} detail={netEarningsDetail(l)} />
        <Tile label="Spent" concept={FIG.spent} value={formatCents(sum.spent)}
          detail={[`Bank ${formatCents(sum.spentBySource.bank)}`, `Card ${formatCents(sum.spentBySource.card)}`, `Cash ${formatCents(sum.spentBySource.cash)}`]} />
        <Tile label="Net spending" concept={FIG.netSpent} value={formatCents(sum.netSpent)}
          detail={netSpendingDetail(l, sum.offsets)} />
        <Tile label="Surplus" concept={surplusConcept(sum.surplus)} value={formatCents(sum.surplus)} tone={sum.surplus > 0 ? "pos" : sum.surplus < 0 ? "neg" : undefined}
          detail={`Earned ${formatCents(sum.earned)} − spent ${formatCents(sum.spent)}`} />
        <Tile label="Savings" concept={FIG.netSavings} value={formatCents(sum.netSavings)}
          detail={`${formatPercent(sum.savingsRate)} of paychecks`} />
        <Tile label="Investment" concept={FIG.investment} value={formatCents(sum.investment)}
          detail={[`${formatPercent(sum.investmentRate)} of paychecks`, `Retirement ${formatPercent(sum.investment ? sum.investRetirement / sum.investment : null)}`, `Taxable ${formatPercent(sum.investment ? sum.investTaxable / sum.investment : null)}`]} />
        <Tile label="Credit card payments" concept={FIG.ccPayments} value={formatCents(sum.ccPayments)} detail="Transfers, not counted in spending" />
        <Tile label="Charity" concept={FIG.charity} value={formatCents(sum.charity)} detail={`${formatPercent(sum.charityRate)} of paychecks`} />
        <Tile label="Loan payments" concept={FIG.loanPayments} value={formatCents(sum.loanPayments)} detail="Transfers to loans, not counted in spending" />
        {pins.pinnedTags.value.map((id) => {
          const tag = setup.tags.find((t) => t.id === id);
          return tag ? (
            <Tile label={tag.name} concept={PINNED_CONCEPT} value={formatCents(tagTotal(l, id, month))} detail="Pinned tag"
              onRemove={() => savePins("pinnedTags", pins.pinnedTags.value.filter((t) => t !== id))} />
          ) : null;
        })}
        {/* All spending in the category, before refunds, as in Spending by category. */}
        {pins.pinnedCategories.value.map((id) => {
          const cat = setup.categories.expense.find((c) => c.id === id);
          return cat ? (
            <Tile label={cat.name} concept={PINNED_CONCEPT} value={formatCents(cats.get(id)?.gross ?? 0)} detail="Pinned category"
              onRemove={() => savePins("pinnedCategories", pins.pinnedCategories.value.filter((c) => c !== id))} />
          ) : null;
        })}
        <PinTotal categories={new Map(setup.categories.expense.map((c) => [c.id, c.name]))} tags={new Map(setup.tags.map((t) => [t.id, t.name]))}
          keys={{ cat: "pinnedCategories", tag: "pinnedTags" }} class="tile" label="Category or tag to pin" />
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
            <p class="muted small">{asOf}. Click an account to see its entries.</p>
            <AccountsTable overview={accounts} accounts={setup.accounts} withoutLoans={withoutLoans}
              // A balance is a running total, so the entries behind it run from the year's start to the
              // period's end: with a month picked, to that month's last day. Accounts are shared, so
              // everyone's entries.
              onPick={(account) => showInLedger(month ? { account, month: "range", from: yearStart(setup), to: monthEnd(setup.year, month) } : { account })}
              retirement={{ left: remainingRetirement(all, iraLimit.value, setup.iraBeforeStart), limit: iraLimit.value, before: setup.iraBeforeStart, start: yearStart(setup) }} />
          </section>
        </div>
      )}
    </div>
  );
}

/** Which categories make up net earnings, e.g. "Paycheck + Interest + Tax Refund + Other". */
function netEarningsDetail(l: Ledger): string {
  const names = netEarningNames(l);
  return names.length ? names.join(" + ") : "No categories count. Choose them on the Accounts page.";
}

/** What net spending takes off, e.g. "After $26,273.42 of Expenses Remunerated + Redeemed CC Points + Refunds". */
function netSpendingDetail(l: Ledger, offsets: number): string {
  const ids = spendingOffsetCategories(l);
  const names = l.categories.earning.filter((c) => ids.has(c.id)).map((c) => c.name);
  return names.length ? `After ${formatCents(offsets)} of ${names.join(" + ")}` : "No earning category lowers spending, so nothing comes off.";
}

/**
 * A dashboard figure. A detail given as a list shows one "• item" per line. A concept adds a colour
 * stripe, the same colour as the figure's Over the years chart (see concepts.ts).
 */
function Tile(props: {
  label: string; value: string; detail?: string | string[]; concept?: Concept;
  tone?: "pos" | "neg"; onRemove?: () => void;
}) {
  return (
    <div class={`tile card ${props.concept ? `tile-${props.concept}` : ""}`}>
      <div class="tile-label">
        {props.label}
        {props.onRemove && (
          <button type="button" class="unpin" aria-label={`Unpin ${props.label}`} onClick={props.onRemove}>×</button>
        )}
      </div>
      <div class={`tile-value ${props.tone ?? ""}`}>{props.value}</div>
      {Array.isArray(props.detail) ? (
        <ul class="tile-detail tile-lines">{props.detail.map((d) => <li><Figures text={d} /></li>)}</ul>
      ) : (
        props.detail && <div class="tile-detail"><Figures text={props.detail} /></div>
      )}
    </div>
  );
}

/**
 * Dollar amounts and percentages exactly as formatCents and formatPercent write them, always with
 * two decimals ("-$1,234.56", "13.36%"), so a name like "5% Match" or "$50 Bonus" isn't bolded.
 * Hidden amounts ("$•••••") stay bold too.
 */
const FIGURE = /(-?\$\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}%|\$•+)/;

/** Text with its amounts and percentages in bold. */
function Figures(props: { text: string }) {
  // Splitting on a capturing group puts the figures at the odd indexes.
  return <>{props.text.split(FIGURE).map((part, i) => (i % 2 ? <b>{part}</b> : part))}</>;
}

/** Horizontal bars, one hue: the job is comparing amounts, not telling categories apart. */
function CategoryBars(props: {
  /** Bar colour: Reports' income blue or spending orange. */
  tone: "income" | "spending";
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

function AccountsTable(props: { overview: ReturnType<typeof accountsOverview>; accounts: Account[]; withoutLoans: boolean; retirement: RetirementRoomProps; onPick: (account: string) => void }) {
  const o = props.overview;
  // An account's name opens its entries in the ledger. Not an asset's: it has none, only values.
  // Amounts in green while they hold money (zero too), red while they're owed or below zero.
  // Not net worth: it's the bottom line, and stays plain. Card debt and loans owed go below zero when
  // overpaid, so they're red only above it.
  const tone = (good: boolean) => `num ${good ? "pos" : "neg"}`;
  const name = (a: Account) => <button type="button" class="acct-link" onClick={() => props.onPick(a.id)}>{a.name}</button>;
  const bal = (a: Account) => o.balances.get(a.id) ?? 0;
  // Archived accounts show while they hold money or a value; closed ones only before the day they closed.
  const live = props.accounts.filter((a) => !o.closed.has(a.id) && (!a.archived || bal(a) !== 0 || o.valuations.has(a.id)));
  const cardStatus = new Map(o.cards.map((c) => [c.account.id, c]));
  // Each group largest first: cash by balance, cards by how much of the limit is used, loans by
  // what's owed, investments and assets by their latest value. Cards without a limit and anything not valued yet go last.
  const worth = (a: Account) => o.valuations.get(a.id)?.amount ?? -Infinity;
  const SORT_BY: Partial<Record<Account["type"], (a: Account) => number>> = {
    checking: bal, savings: bal, cash: bal,
    credit: (a) => cardStatus.get(a.id)?.utilization ?? -Infinity,
    investment: worth, asset: worth,
  };
  const group = (types: Account["type"][]) =>
    live.filter((a) => types.includes(a.type)).sort((a, b) => {
      // Compared, not subtracted: two unvalued accounts would give -Infinity - -Infinity = NaN.
      const x = SORT_BY[a.type]!(a), y = SORT_BY[b.type]!(b);
      return x > y ? -1 : x < y ? 1 : 0;
    });

  const investments = group(["investment"]);

  return (
    <>
    <table class="acct-table">
      <tbody>
        {group(["checking", "savings", "cash"]).map((a) => (
          <tr>
            <td>{name(a)}</td>
            <td class={tone(bal(a) >= 0)}>{formatCents(bal(a))}</td>
          </tr>
        ))}
        <tr class="subtotal">
          <td>Available cash</td>
          <td class={tone(o.availableCash >= 0)}>{formatCents(o.availableCash)}</td>
        </tr>
        {group(["credit"]).map((a) => {
          const c = cardStatus.get(a.id)!;
          return (
            <tr>
              <td>
                {name(a)}
                <Meter fraction={c.utilization} />
              </td>
              <td class={tone(!c.debt)}>
                {c.debt ? `${formatCents(c.debt)} owed` : bal(a) > 0 ? `${formatCents(bal(a))} credit` : "Paid off"}
                <div class="tile-detail">{formatPercent(c.utilization)} used</div>
              </td>
            </tr>
          );
        })}
        <tr class="subtotal">
          <td>Card debt · {formatPercent(o.utilization)} of limits{o.cardLimit > 0 && <sup aria-hidden="true">*</sup>}</td>
          <td class={tone(o.cardDebt <= 0)}>{formatCents(o.cardDebt)}</td>
        </tr>
        {o.loans.filter((l) => !l.account.archived || l.owed !== 0).sort((a, b) => b.owed - a.owed).map((l) => (
          <tr>
            <td>{name(l.account)}</td>
            <td class={tone(!l.owed)}>
              {l.owed ? `${formatCents(l.owed)} owed` : "Paid off"}
              <div class="tile-detail">{formatCents(l.interest)} interest this year</div>
            </td>
          </tr>
        ))}
        {o.loans.length > 0 && (
          <tr class="subtotal">
            <td>Loans owed</td>
            <td class={tone(o.loanDebt <= 0)}>{formatCents(o.loanDebt)}</td>
          </tr>
        )}
        {investments.map((a) => {
          // Worth what it was last updated to; without an update it only shows this year's contributions.
          const v = o.valuations.get(a.id);
          return (
            <tr>
              <td>{name(a)}</td>
              <td class={tone(true)}>
                {v ? formatCents(v.amount) : <span class="muted">No balance yet</span>}
                <div class="tile-detail">
                  {v ? `on ${shortDate(v.date)} · ` : ""}{formatCents(o.invested.get(a.id) ?? 0)} invested this year
                </div>
              </td>
            </tr>
          );
        })}
        <WorthSubtotal label={<>Investments<sup aria-hidden="true">†</sup></>} kind="balance" accounts={investments} valuations={o.valuations} worth={o.investmentsWorth} />
        {group(["asset"]).map((a) => {
          const v = o.valuations.get(a.id);
          return (
            <tr>
              <td>{a.name}</td>
              <td class={tone(true)}>
                {v ? formatCents(v.amount) : <span class="muted">No value yet</span>}
                {v && <div class="tile-detail">on {shortDate(v.date)}</div>}
              </td>
            </tr>
          );
        })}
        <WorthSubtotal label="Assets" kind="value" accounts={group(["asset"])} valuations={o.valuations} worth={o.assetsWorth} />
        <tr class="total">
          <td>Net worth{props.withoutLoans && <span class="muted small"> without loans</span>}</td>
          <td class="num">{formatCents(props.withoutLoans ? o.netWorthWithoutLoans : o.netWorth)}</td>
        </tr>
      </tbody>
    </table>
    {/* The notes the marks in the table point to. A mark and its note go together; the retirement room shows either way. */}
    {o.cardLimit > 0 && <p class="note"><sup aria-hidden="true">*</sup>Total credit limit: <b>{formatCents(o.cardLimit)}</b></p>}
    <RetirementRoom {...props.retirement} marked={investments.length > 0} />
    </>
  );
}

/**
 * The subtotal of investments or assets, worth what they were last updated to. Before any update it says so,
 * rather than show nothing; with only some updated, it says how many the amount (and so net worth) leaves out.
 */
function WorthSubtotal(props: { label: ComponentChildren; kind: "balance" | "value"; accounts: Account[]; valuations: Map<string, unknown>; worth: number }) {
  if (props.accounts.length === 0) return null;
  const missing = props.accounts.filter((a) => !props.valuations.has(a.id)).length;
  const valued = missing < props.accounts.length;
  return (
    <tr class="subtotal">
      <td>{props.label}{valued && <> <span class="muted small">latest {props.kind}s{missing > 0 && ` · ${missing} without a ${props.kind}`}</span></>}</td>
      {/* Green, like the investments and assets above it. */}
      <td class="num pos">{valued ? formatCents(props.worth) : <span class="muted">No {props.kind} yet</span>}</td>
    </tr>
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

interface RetirementRoomProps { left: number; limit: number; before?: number; start: string }

function RetirementRoom({ left, limit, before, start, marked }: RetirementRoomProps & { marked: boolean }) {
  return (
    <p class="note">
      {marked && <sup aria-hidden="true">†</sup>}IRA contribution room left this year: <b>{formatCents(left)}</b> of the {formatCents(limit)} limit
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
