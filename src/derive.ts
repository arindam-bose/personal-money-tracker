// Everything the app shows that isn't typed in by the user is computed here, from the
// raw tables. Nothing computed is ever stored. See the project brief, §4.
//
// These are plain functions with no UI code, so tests can check them directly
// against the totals Notion computed (tests/derive.test.ts, tests/real-data.test.ts).

import type {
  Account, Budgets, Cents, Earning, EarningRole, Expense, ExpenseRole, IsoDate, Transfer, TransferRole, Valuation, YearFile, YearSetup,
} from "./types";
import { monthShare } from "./year";

/**
 * The parts of a year the calculations read. A YearFile, or YearData flattened, fits.
 * Loans need the year and its start to know when interest is due; without them a loan only moves with its entries.
 */
export type Ledger = Pick<YearFile, "accounts" | "categories" | "expenses" | "earnings" | "transfers">
  & Partial<Pick<YearFile, "year" | "start">>;

/** Month 1-12, or omitted for the whole year so far. */
export type Month = number | undefined;

/** Category id -> role, one lookup per kind. Categories without a role map to undefined. */
interface Roles {
  expense: Map<string, ExpenseRole | undefined>;
  earning: Map<string, EarningRole | undefined>;
  transfer: Map<string, TransferRole | undefined>;
}

function rolesOf(ledger: Ledger): Roles {
  const { expense, earning, transfer } = ledger.categories;
  return {
    expense: new Map(expense.map((c) => [c.id, c.role])),
    earning: new Map(earning.map((c) => [c.id, c.role])),
    transfer: new Map(transfer.map((c) => [c.id, c.role])),
  };
}

/** A stored year (its setup and entries) as a ledger, with the year and start loans need. */
export function ledgerOf(data: { setup: YearSetup; expenses: Expense[]; earnings: Earning[]; transfers: Transfer[] }): Ledger {
  const { setup, expenses, earnings, transfers } = data;
  return { accounts: setup.accounts, categories: setup.categories, expenses, earnings, transfers, year: setup.year, start: setup.start };
}

/**
 * The ledger with only one member's entries, for their own dashboard and reports.
 * Accounts and categories stay whole: accounts are shared by the household.
 */
export function forMember(ledger: Ledger, member: string, defaultMember: string): Ledger {
  const mine = <T extends { member?: string }>(list: T[]) => list.filter((e) => (e.member ?? defaultMember) === member);
  return { ...ledger, expenses: mine(ledger.expenses), earnings: mine(ledger.earnings), transfers: mine(ledger.transfers) };
}

/** True if a "YYYY-MM-DD" date falls in the month (or always, for the whole year). */
export function inMonth(date: IsoDate, month: Month): boolean {
  return month === undefined || Number(date.slice(5, 7)) === month;
}

// --- Dates ---

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
/** "Jan" to "Dec". */
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** Today in the browser's time zone, "YYYY-MM-DD". */
export function localToday(now = new Date()): IsoDate {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "2026-03-09" -> "Mar 9". */
export function shortDate(iso: IsoDate): string {
  return `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/**
 * The same day n months earlier, as "YYYY-MM-DD": the start of "the last n months" up to `date`.
 * A day the earlier month doesn't have becomes its last day: "2026-03-31" minus 1 -> "2026-02-28".
 */
export function monthsBefore(date: IsoDate, n: number): IsoDate {
  const months = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 - n;
  const year = Math.floor(months / 12), month = (months % 12) + 1;
  const day = Math.min(Number(date.slice(8, 10)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Where the money for an expense came from, by the debited account's type. */
export type SpendSource = "bank" | "card" | "cash";

export function spendSource(type: Account["type"]): SpendSource {
  return type === "credit" ? "card" : type === "cash" ? "cash" : "bank";
}

/** a / b as a fraction (0.25 = 25%), or null when b is 0 and the ratio means nothing. */
export function ratio(a: Cents, b: Cents): number | null {
  return b === 0 ? null : a / b;
}

// --- Period summary (one month, or the whole year) ---

export interface Summary {
  /** All earnings, as Notion counts them (gross). */
  earned: Cents;
  /** Earnings in a paycheck-role category. */
  paycheck: Cents;
  /** Every other earning, including refunds and points. */
  otherEarned: Cents;

  /** All expenses, as Notion counts them (gross). */
  spent: Cents;
  spentBySource: Record<SpendSource, Cents>;

  /** Earned − spent. */
  surplus: Cents;

  /** Credit card payments (transfers, so not spending). */
  ccPayments: Cents;
  /** Money moved into savings minus money taken out. */
  netSavings: Cents;
  investRetirement: Cents;
  investTaxable: Cents;
  /** Retirement + taxable investment. */
  investment: Cents;

  charity: Cents;
  /** Transfers in a loan-payment category: paying down a loan, so not spending. */
  loanPayments: Cents;

  /** Earnings that lower spending instead of counting as income: see spendingOffsetCategories. */
  offsets: Cents;

  /** What you really spent: spent − offsets. */
  netSpent: Cents;
  /** Earnings in categories that count toward net earnings (see countsInNetEarnings). */
  netEarnings: Cents;

  /** As fractions of paycheck income; null when there was no paycheck. */
  savingsRate: number | null;
  investmentRate: number | null;
  charityRate: number | null;
}

export function summarize(ledger: Ledger, month?: number): Summary {
  const roles = rolesOf(ledger);
  const accountType = new Map(ledger.accounts.map((a) => [a.id, a.type]));

  let spent = 0, charity = 0;
  const spentBySource: Record<SpendSource, Cents> = { bank: 0, card: 0, cash: 0 };
  for (const e of ledger.expenses) {
    if (!inMonth(e.date, month)) continue;
    spent += e.amount;
    spentBySource[spendSource(accountType.get(e.account) ?? "checking")] += e.amount;
    if (roles.expense.get(e.cat) === "charity") charity += e.amount;
  }

  let earned = 0, paycheck = 0, offsets = 0, netEarnings = 0;
  const counted = netEarningCategories(ledger);
  const lowering = spendingOffsetCategories(ledger);
  for (const i of ledger.earnings) {
    if (!inMonth(i.date, month)) continue;
    earned += i.amount;
    if (counted.has(i.cat)) netEarnings += i.amount;
    if (lowering.has(i.cat)) offsets += i.amount;
    if (roles.earning.get(i.cat) === "paycheck") paycheck += i.amount;
  }

  let ccPayments = 0, netSavings = 0, investRetirement = 0, investTaxable = 0, loanPayments = 0;
  for (const t of ledger.transfers) {
    if (!inMonth(t.date, month)) continue;
    switch (roles.transfer.get(t.cat)) {
      case "cc_payment": ccPayments += t.amount; break;
      case "savings_in": netSavings += t.amount; break;
      case "savings_out": netSavings -= t.amount; break;
      case "invest_retirement": investRetirement += t.amount; break;
      case "invest_taxable": investTaxable += t.amount; break;
      case "loan_payment": loanPayments += t.amount; break;
    }
  }

  const investment = investRetirement + investTaxable;
  return {
    earned, paycheck, otherEarned: earned - paycheck,
    spent, spentBySource,
    surplus: earned - spent,
    ccPayments, netSavings, investRetirement, investTaxable, investment,
    charity, loanPayments,
    offsets,
    netSpent: spent - offsets,
    netEarnings,
    savingsRate: ratio(netSavings, paycheck),
    investmentRate: ratio(investment, paycheck),
    charityRate: ratio(charity, paycheck),
  };
}

/**
 * Whether an earning category counts toward net earnings: paycheck and income
 * categories do, unless switched off (net: false). Refunds and paybacks never do.
 */
export function countsInNetEarnings(c: { role?: EarningRole; net?: boolean }): boolean {
  return (c.role === "paycheck" || c.role === "income") && c.net !== false;
}

/** Ids of the earning categories that count toward net earnings. */
export function netEarningCategories(ledger: Ledger): Set<string> {
  return new Set(ledger.categories.earning.filter(countsInNetEarnings).map((c) => c.id));
}

/**
 * Ids of the earning categories that lower net spending: those whose role is "Lowers spending"
 * (refunds, points, money paid back). Unticking Net on pay or income only takes it out of net earnings.
 */
export function spendingOffsetCategories(ledger: Ledger): Set<string> {
  return new Set(ledger.categories.earning.filter((c) => c.role === "offset").map((c) => c.id));
}

/** Summaries for January to December, index 0 = January. */
export function monthlySummaries(ledger: Ledger): Summary[] {
  return Array.from({ length: 12 }, (_, i) => summarize(ledger, i + 1));
}

/** Total of expenses carrying a tag, e.g. "Sent to India" (pinned tag totals on the dashboard). */
export function tagTotal(ledger: Ledger, tagId: string, month?: number): Cents {
  let total = 0;
  for (const e of ledger.expenses) if (inMonth(e.date, month) && e.tags.includes(tagId)) total += e.amount;
  return total;
}

// --- Spending per category (category breakdown and budgets) ---

export interface CategorySpend {
  /** Sum of expense amounts in the category. */
  gross: Cents;
  /** Offsets aimed at this category (refunds with `offsets` set to it). */
  offsets: Cents;
  /** gross − offsets: what the budget compares against. */
  net: Cents;
}

/**
 * Spending per expense category id. Every expense category is present, even at 0.
 * Offsets with `offsets: null` don't belong to a category, so they only reduce the
 * total (Summary.netSpent), not any row here.
 */
export function spendByCategory(ledger: Ledger, month?: number): Map<string, CategorySpend> {
  const out = new Map<string, CategorySpend>();
  for (const c of ledger.categories.expense) out.set(c.id, { gross: 0, offsets: 0, net: 0 });
  const row = (cat: string) => {
    let r = out.get(cat);
    if (!r) out.set(cat, (r = { gross: 0, offsets: 0, net: 0 }));
    return r;
  };

  for (const e of ledger.expenses) if (inMonth(e.date, month)) row(e.cat).gross += e.amount;
  const lowering = spendingOffsetCategories(ledger);
  for (const i of ledger.earnings) {
    if (inMonth(i.date, month) && lowering.has(i.cat) && i.offsets) row(i.offsets).offsets += i.amount;
  }
  for (const r of out.values()) r.net = r.gross - r.offsets;
  return out;
}

/** Earnings per earning category id, gross (refunds and paybacks included). Every category is present, even at 0. */
export function earningsByCategory(ledger: Ledger, month?: number): Map<string, Cents> {
  const out = new Map<string, Cents>(ledger.categories.earning.map((c) => [c.id, 0]));
  for (const i of ledger.earnings) if (inMonth(i.date, month)) out.set(i.cat, (out.get(i.cat) ?? 0) + i.amount);
  return out;
}

// --- Accounts ---

/**
 * Balance of every account id, using the net-worth sign (a card or loan that owes money is negative):
 * balance = opening + money in − money out, and for a loan − interest (see loanStatus).
 * Pass `through` to get balances at the end of that day. Without it, every entry counts and
 * loan interest runs to `today`, or to the end of the year if that comes first.
 */
export function balances(ledger: Ledger, through?: IsoDate, today = localToday()): Map<string, Cents> {
  return balancesAndLoans(ledger, through, today).bal;
}

/** balances, plus each loan's status, so callers that need both work each loan out once. */
function balancesAndLoans(ledger: Ledger, through: IsoDate | undefined, today: IsoDate) {
  const bal = new Map(ledger.accounts.map((a) => [a.id, a.opening]));
  const add = (id: string, amount: Cents) => bal.set(id, (bal.get(id) ?? 0) + amount);
  const keep = (date: IsoDate) => through === undefined || date <= through;
  for (const e of ledger.expenses) if (keep(e.date)) add(e.account, -e.amount);
  for (const i of ledger.earnings) if (keep(i.date)) add(i.account, i.amount);
  for (const t of ledger.transfers) {
    if (!keep(t.date)) continue;
    add(t.from, -t.amount);
    add(t.to, t.amount);
  }
  const loans = new Map<string, LoanStatus>();
  for (const a of ledger.accounts) {
    if (a.type !== "loan") continue;
    const s = loanStatus(ledger, a, through, today);
    loans.set(a.id, s);
    bal.set(a.id, s.balance);
  }
  return { bal, loans };
}

/** The same day n months later, or the month's last day if it's shorter: "2026-01-31" plus 1 -> "2026-02-28". */
function monthsAfter(date: IsoDate, n: number): IsoDate {
  return monthsBefore(date, -n);
}

/** A loan's interest days from `from` through `to`: each monthly anniversary of the day it began. */
export function loanDueDates(loanStart: IsoDate, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let n = 1, due = monthsAfter(loanStart, 1); due <= to; due = monthsAfter(loanStart, ++n)) {
    if (due >= from) out.push(due);
  }
  return out;
}

export interface LoanStatus {
  /** Net-worth sign, so what's owed is −balance. */
  balance: Cents;
  /** Interest added this year, through the day asked for. */
  interest: Cents;
}

/**
 * A loan's balance, walked day by day through the year:
 * - it opens at what was owed the morning tracking started; a loan taken out since then
 *   opens at 0 and its amount is added on its start date;
 * - on each monthly anniversary of the start date, rate ÷ 12 of what's still owed is added
 *   (rounded to the cent), before that day's entries;
 * - money in (a payment) lowers what's owed, money out raises it.
 * Without the year, there's no interest or loan amount to add: only the opening and entries count.
 */
export function loanStatus(ledger: Ledger, account: Account, through?: IsoDate, today = localToday()): LoanStatus {
  const flows = new Map<IsoDate, Cents>();
  const add = (date: IsoDate, amount: Cents) => flows.set(date, (flows.get(date) ?? 0) + amount);
  for (const e of ledger.expenses) if (e.account === account.id) add(e.date, -e.amount);
  for (const i of ledger.earnings) if (i.account === account.id) add(i.date, i.amount);
  for (const t of ledger.transfers) {
    if (t.from === account.id) add(t.date, -t.amount);
    if (t.to === account.id) add(t.date, t.amount);
  }

  const dueDates: IsoDate[] = [];
  const { loanStart, loanAmount, rate } = account;
  if (ledger.year !== undefined && loanStart) {
    const from = ledger.start ?? `${ledger.year}-01-01`;
    const yearEnd = `${ledger.year}-12-31`;
    const end = through ?? (today < yearEnd ? today : yearEnd);
    if (loanStart >= from && loanStart <= end && loanAmount) add(loanStart, -loanAmount);
    if (rate) dueDates.push(...loanDueDates(loanStart, from, end));
  }

  let balance = account.opening, interest = 0;
  const days = [...new Set([...flows.keys(), ...dueDates])].sort();
  const due = new Set(dueDates);
  for (const day of days) {
    if (through !== undefined && day > through) break;
    if (due.has(day) && balance < 0) {
      const charge = Math.round((-balance * rate!) / 1200);
      balance -= charge;
      interest += charge;
    }
    balance += flows.get(day) ?? 0;
  }
  return { balance, interest };
}

export interface CardStatus {
  account: Account;
  /** Amount owed, positive. 0 if the card is paid off or in credit. */
  debt: Cents;
  /** debt ÷ limit, or null for a card without a limit. */
  utilization: number | null;
}

export interface LoanOverview {
  account: Account;
  /** Amount still owed, positive. 0 once it's paid off. */
  owed: Cents;
  /** Interest added so far this year. */
  interest: Cents;
}

/** True if the account is closed on or before `through` (or at all, without a day). */
export function isClosed(account: Account, through?: IsoDate): boolean {
  return account.closedOn !== undefined && (through === undefined || account.closedOn <= through);
}

/**
 * Whether the year has a loan account, open or closed. It decides, the same way on every page,
 * whether the Include loans switch and the loan figures show.
 */
export function hasLoanAccount(accounts: Account[]): boolean {
  return accounts.some((a) => a.type === "loan");
}

/** Account types whose value comes from the user's updates rather than from entries. */
export function hasValuations(type: Account["type"]): boolean {
  return type === "investment" || type === "asset";
}

/** An investment or asset account's latest update on or before `through` (or its latest), or null if there's none. */
export function valuationOf(account: Account, through?: IsoDate): Valuation | null {
  // From the day it's closed (sold, say), it's worth nothing.
  if (isClosed(account, through)) return null;
  const list = (account.valuations ?? []).filter((v) => through === undefined || v.date <= through);
  return list.length ? list.reduce((a, b) => (b.date > a.date ? b : a)) : null;
}

export interface AccountsOverview {
  balances: Map<string, Cents>;
  /** Checking + savings + cash. */
  availableCash: Cents;
  /** What all cards owe together (a card in credit reduces it). */
  cardDebt: Cents;
  cardLimit: Cents;
  /** cardDebt ÷ cardLimit. */
  utilization: number | null;
  cards: CardStatus[];
  /** What all loans still owe together. */
  loanDebt: Cents;
  loans: LoanOverview[];
  /** Available cash − card debt − loan debt + investments worth + assets worth. */
  netWorth: Cents;
  /** The same with loans left out, for the Include loans switch. */
  netWorthWithoutLoans: Cents;
  /** Contributions made this year, per investment account. */
  invested: Map<string, Cents>;
  /** Accounts closed by then. They're at 0, so they only matter for what's listed. */
  closed: Set<string>;
  /** Each investment and asset account's latest update, for those that have one. */
  valuations: Map<string, Valuation>;
  /** What the investment accounts' latest updates add up to. Accounts without one aren't counted. */
  investmentsWorth: Cents;
  /** The same for asset accounts. */
  assetsWorth: Cents;
}

export function accountsOverview(ledger: Ledger, through?: IsoDate, today = localToday()): AccountsOverview {
  const { bal, loans: loanStatuses } = balancesAndLoans(ledger, through, today);
  const balOf = (a: Account) => bal.get(a.id) ?? 0;

  let availableCash = 0, cardDebt = 0, cardLimit = 0, loanDebt = 0, investmentsWorth = 0, assetsWorth = 0;
  const valuations = new Map<string, Valuation>();
  const cards: CardStatus[] = [];
  const loans: LoanOverview[] = [];
  const invested = new Map<string, Cents>();
  const closed = new Set(ledger.accounts.filter((a) => isClosed(a, through)).map((a) => a.id));
  // At the opening (the day before tracking starts), an investment or asset is worth what was noted
  // on the first day: that's what it was worth when tracking began.
  const first = ledger.year === undefined ? undefined : ledger.start ?? `${ledger.year}-01-01`;
  const valuedBy = through !== undefined && first !== undefined && through < first ? first : through;
  for (const a of ledger.accounts) {
    switch (a.type) {
      case "checking":
      case "savings":
      case "cash":
        availableCash += balOf(a);
        break;
      case "credit": {
        cardDebt -= balOf(a);
        // A closed card has no limit left to use.
        if (closed.has(a.id)) break;
        cardLimit += a.limit ?? 0;
        const debt = Math.max(0, -balOf(a));
        cards.push({ account: a, debt, utilization: a.limit ? debt / a.limit : null });
        break;
      }
      case "investment": {
        // Investment accounts open at 0 each year, so the balance is this year's contributions.
        invested.set(a.id, balOf(a) - a.opening);
        // What it's worth is only known from the balances the user enters.
        const v = valuationOf(a, valuedBy);
        if (v) {
          valuations.set(a.id, v);
          investmentsWorth += v.amount;
        }
        break;
      }
      case "asset": {
        const v = valuationOf(a, valuedBy);
        if (v) {
          valuations.set(a.id, v);
          assetsWorth += v.amount;
        }
        break;
      }
      case "loan":
        loanDebt -= balOf(a);
        if (!closed.has(a.id)) loans.push({ account: a, owed: Math.max(0, -balOf(a)), interest: loanStatuses.get(a.id)!.interest });
        break;
    }
  }
  return {
    balances: bal, closed,
    availableCash, cardDebt, cardLimit,
    utilization: ratio(cardDebt, cardLimit),
    cards,
    loanDebt, loans,
    netWorth: availableCash - cardDebt - loanDebt + investmentsWorth + assetsWorth,
    netWorthWithoutLoans: availableCash - cardDebt + investmentsWorth + assetsWorth,
    invested, valuations, investmentsWorth, assetsWorth,
  };
}

/**
 * How much more can go into retirement accounts this year. Never below 0. `before` is what
 * went in earlier in a year whose tracking started partway through.
 */
export function remainingRetirement(ledger: Ledger, annualLimit: Cents, before: Cents = 0): Cents {
  return Math.max(0, annualLimit - before - summarize(ledger).investRetirement);
}

// --- Report series ---

/** Gross spending per expense category id, for each month (index 0 = January). */
export function spendingByMonth(ledger: Ledger): Map<string, Cents[]> {
  const out = new Map<string, Cents[]>(ledger.categories.expense.map((c) => [c.id, new Array<Cents>(12).fill(0)]));
  for (const e of ledger.expenses) {
    let row = out.get(e.cat);
    if (!row) out.set(e.cat, (row = new Array<Cents>(12).fill(0)));
    row[Number(e.date.slice(5, 7)) - 1]! += e.amount;
  }
  return out;
}

/** "YYYY-MM-DD" for a UTC date. */
function iso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/**
 * The Monday-to-Sunday weeks that cover a year. The first week starts on the Monday
 * on or before January 1, the last ends on the Sunday on or after December 31.
 */
export function weeksOf(year: number): { start: IsoDate; end: IsoDate }[] {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const monday = new Date(jan1);
  monday.setUTCDate(jan1.getUTCDate() - ((jan1.getUTCDay() + 6) % 7));
  const weeks: { start: IsoDate; end: IsoDate }[] = [];
  for (const d = monday; d.getUTCFullYear() <= year; d.setUTCDate(d.getUTCDate() + 7)) {
    const end = new Date(d);
    end.setUTCDate(d.getUTCDate() + 6);
    weeks.push({ start: iso(d), end: iso(end) });
  }
  return weeks;
}

export interface WeekSpend {
  start: IsoDate;
  end: IsoDate;
  bySource: Record<SpendSource, Cents>;
}

/** Spending per week of the year, split by where the money came from. */
export function weeklySpending(ledger: Ledger, year: number): WeekSpend[] {
  const weeks: WeekSpend[] = weeksOf(year).map((w) => ({ ...w, bySource: { bank: 0, card: 0, cash: 0 } }));
  const accountType = new Map(ledger.accounts.map((a) => [a.id, a.type]));
  for (const e of ledger.expenses) {
    const week = weeks.find((w) => e.date >= w.start && e.date <= w.end);
    if (week) week.bySource[spendSource(accountType.get(e.account) ?? "checking")] += e.amount;
  }
  return weeks;
}

export interface BalancePoint {
  date: IsoDate;
  availableCash: Cents;
  cardDebt: Cents;
  loanDebt: Cents;
  /** Investment accounts' latest balance updates so far (AccountsOverview.investmentsWorth). */
  investmentsWorth: Cents;
  /** Asset accounts' latest values so far (AccountsOverview.assetsWorth). */
  assetsWorth: Cents;
  /** Available cash − card debt − loan debt + investments and assets worth (AccountsOverview.netWorth). */
  netWorth: Cents;
  /** The same with loans left out (AccountsOverview.netWorthWithoutLoans). */
  netWorthWithoutLoans: Cents;
  /** Contributions to investment accounts so far this year. */
  invested: Cents;
  /** Net savings so far this year: moved into savings minus taken out (Summary.netSavings to date). */
  saved: Cents;
}

/** Account totals at the end of each given day. */
export function balanceSeries(ledger: Ledger, dates: IsoDate[]): BalancePoint[] {
  const roles = rolesOf(ledger);
  return dates.map((date) => {
    const o = accountsOverview(ledger, date);
    let invested = 0;
    for (const v of o.invested.values()) invested += v;
    let saved = 0;
    for (const t of ledger.transfers) {
      if (t.date > date) continue;
      const role = roles.transfer.get(t.cat);
      if (role === "savings_in") saved += t.amount;
      if (role === "savings_out") saved -= t.amount;
    }
    return { date, availableCash: o.availableCash, cardDebt: o.cardDebt, loanDebt: o.loanDebt, investmentsWorth: o.investmentsWorth, assetsWorth: o.assetsWorth, netWorth: o.netWorth, netWorthWithoutLoans: o.netWorthWithoutLoans, invested, saved };
  });
}

// --- Money flow (Sankey) ---

export type FlowGroup = "income" | "hub" | "spending" | "savings" | "investment" | "loan" | "balance";

export interface FlowNode {
  id: string;
  name: string;
  group: FlowGroup;
}

export interface FlowLink {
  source: string;
  target: string;
  value: Cents;
}

export interface MoneyFlow {
  nodes: FlowNode[];
  links: FlowLink[];
}

/**
 * Where the money came from and where it went, through one "Income" hub:
 *   earning categories ─┐                ┌─ expense categories
 *   taken from savings ─┼─▶  Income  ─▶ ├─ savings, investments, loan payments
 *   drawn from balances ┘                └─ left over in accounts
 * Other transfers between your own accounts (card payments, cash withdrawals) don't appear:
 * they move money without earning or spending it. Inflows always equal outflows.
 */
export function moneyFlow(ledger: Ledger, month?: number): MoneyFlow {
  const s = summarize(ledger, month);
  const nodes: FlowNode[] = [{ id: "hub", name: "Income", group: "hub" }];
  const links: FlowLink[] = [];
  const into = (id: string, name: string, group: FlowGroup, value: Cents) => {
    if (value <= 0) return;
    nodes.push({ id, name, group });
    links.push({ source: id, target: "hub", value });
  };
  const outOf = (id: string, name: string, group: FlowGroup, value: Cents) => {
    if (value <= 0) return;
    nodes.push({ id, name, group });
    links.push({ source: "hub", target: id, value });
  };

  const earnedBy = earningsByCategory(ledger, month);
  for (const c of ledger.categories.earning) into(c.id, c.name, "income", earnedBy.get(c.id) ?? 0);
  into("from-savings", "Taken from savings", "savings", -s.netSavings);

  const spentBy = spendByCategory(ledger, month);
  for (const c of ledger.categories.expense) outOf(c.id, c.name, "spending", spentBy.get(c.id)?.gross ?? 0);
  outOf("to-savings", "Savings", "savings", s.netSavings);
  outOf("to-retirement", "Retirement investing", "investment", s.investRetirement);
  outOf("to-taxable", "Taxable investing", "investment", s.investTaxable);
  outOf("to-loans", "Loan payments", "loan", s.loanPayments);

  // Whatever is left balances the two sides.
  const left = s.earned + Math.max(0, -s.netSavings) - s.spent - Math.max(0, s.netSavings) - s.investment - s.loanPayments;
  outOf("left-over", "Left over", "balance", left);
  into("drawn", "Drawn from balances", "balance", -left);
  return { nodes, links };
}

// --- Budgets (§6) ---

/** The budgets key for a month: 2026, 3 -> "2026-03". */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * A category's target for a month: that month's own target, else the usual one. `share` scales
 * the usual target for a month only partly tracked (see monthShare); a month's own target is
 * taken as given.
 */
export function budgetTarget(budgets: Budgets, year: number, month: number, cat: string, share = 1): Cents | undefined {
  const own = budgets[monthKey(year, month)]?.[cat];
  const usual = budgets.default[cat];
  return own ?? (usual === undefined ? undefined : Math.round(usual * share));
}

export interface BudgetLine {
  cat: string;
  /** Sum of the targets over the months shown; undefined if the category has no budget. */
  target: Cents | undefined;
  /** True when a single month is shown and it overrides the usual target. */
  overridden: boolean;
  /** Net spending: expenses minus refunds aimed at this category. */
  spent: Cents;
  /** target − spent; negative means over budget. Undefined without a target. */
  remaining: Cents | undefined;
}

export interface BudgetView {
  /** Every expense category, in setup order. */
  lines: BudgetLine[];
  /** Total of all targets. */
  budgeted: Cents;
  /** Net spending in categories that have a budget. */
  spentBudgeted: Cents;
  /** Net spending in categories without one. */
  spentUnbudgeted: Cents;
  /** Refunds and points not aimed at a category: they lower the total, not any line. */
  untargetedOffsets: Cents;
  /** All lines − untargeted offsets. Equals Summary.netSpent for the same months. */
  netSpent: Cents;
}

/**
 * Budgeted against spent for the given months (one month, or January up to some month).
 * For a year that starts partway through (`start`), months before it are left out, and the
 * start month's usual targets are scaled to the days it covers. A target set for that month
 * only is taken as given: it was set for the part of the month there is.
 */
export function budgetView(ledger: Ledger, budgets: Budgets, year: number, wanted: number[], start?: IsoDate): BudgetView {
  const setup = { year, start };
  const months = wanted.filter((m) => monthShare(setup, m) > 0);
  const lowering = spendingOffsetCategories(ledger);
  const spent = new Map<string, Cents>();
  let untargetedOffsets = 0;
  for (const m of months) {
    for (const [cat, c] of spendByCategory(ledger, m)) spent.set(cat, (spent.get(cat) ?? 0) + c.net);
    for (const i of ledger.earnings) {
      if (inMonth(i.date, m) && lowering.has(i.cat) && !i.offsets) untargetedOffsets += i.amount;
    }
  }

  const single = months.length === 1 ? months[0] : undefined;
  let budgeted = 0, spentBudgeted = 0, spentUnbudgeted = 0;
  const lines = ledger.categories.expense.map((c): BudgetLine => {
    const targets = months.map((m) => budgetTarget(budgets, year, m, c.id, monthShare(setup, m)));
    const target = targets.every((t) => t === undefined) ? undefined : targets.reduce<number>((a, t) => a + (t ?? 0), 0);
    const s = spent.get(c.id) ?? 0;
    if (target === undefined) spentUnbudgeted += s;
    else {
      budgeted += target;
      spentBudgeted += s;
    }
    return {
      cat: c.id,
      target,
      overridden: single !== undefined && budgets[monthKey(year, single)]?.[c.id] !== undefined,
      spent: s,
      remaining: target === undefined ? undefined : target - s,
    };
  });
  return {
    lines, budgeted, spentBudgeted, spentUnbudgeted, untargetedOffsets,
    netSpent: spentBudgeted + spentUnbudgeted - untargetedOffsets,
  };
}

/**
 * How far through a month a day is, for the "where you should be by now" mark:
 * 0.5 on the 15th of a 30-day month. Null if the day isn't in that month. In the month a
 * year's tracking starts, it counts from the start day.
 */
export function monthProgress(year: number, month: number, today: IsoDate, start?: IsoDate): number | null {
  if (today.slice(0, 7) !== monthKey(year, month)) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // In the month tracking starts, the month begins on the start day.
  const from = start && start.slice(0, 7) === today.slice(0, 7) ? Number(start.slice(8, 10)) : 1;
  return Math.max(0, Number(today.slice(8, 10)) - from + 1) / (days - from + 1);
}
