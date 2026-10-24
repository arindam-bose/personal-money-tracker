// Everything the app shows that isn't typed in by the user is computed here, from the
// raw tables. Nothing computed is ever stored. See the project brief, §4 and §5.
//
// These are plain functions with no UI code, so tests can check them directly
// against the totals Notion computed (tests/derive.test.ts, tests/real-data.test.ts).

import type {
  Account, Budgets, Cents, EarningRole, ExpenseRole, IsoDate, TransferRole, YearFile,
} from "./types";

/** The parts of a year the calculations read. A YearFile, or YearData flattened, fits. */
export type Ledger = Pick<YearFile, "accounts" | "categories" | "expenses" | "earnings" | "transfers">;

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

/** True if a "YYYY-MM-DD" date falls in the month (or always, for the whole year). */
export function inMonth(date: IsoDate, month: Month): boolean {
  return month === undefined || Number(date.slice(5, 7)) === month;
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
  /** Every other earning, including offsets and reimbursements. */
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
  loan: Cents;

  /** Earnings that reduce spending instead of counting as income (refunds, points). */
  offsets: Cents;
  /** Money people paid back (reimbursement role, §5). */
  reimbursed: Cents;
  /** The parts of expenses that other people owe back (§5). */
  owed: Cents;

  /** What you really spent on yourself: spent − offsets − owed shares. */
  netSpent: Cents;
  /** What you really earned: earned − offsets − reimbursements. */
  netIncome: Cents;
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

  let spent = 0, charity = 0, loan = 0, owed = 0;
  const spentBySource: Record<SpendSource, Cents> = { bank: 0, card: 0, cash: 0 };
  for (const e of ledger.expenses) {
    if (!inMonth(e.date, month)) continue;
    spent += e.amount;
    spentBySource[spendSource(accountType.get(e.account) ?? "checking")] += e.amount;
    const role = roles.expense.get(e.cat);
    if (role === "charity") charity += e.amount;
    if (role === "loan") loan += e.amount;
    owed += e.owed?.amount ?? 0;
  }

  let earned = 0, paycheck = 0, offsets = 0, reimbursed = 0, netEarnings = 0;
  const counted = netEarningCategories(ledger);
  for (const i of ledger.earnings) {
    if (!inMonth(i.date, month)) continue;
    earned += i.amount;
    if (counted.has(i.cat)) netEarnings += i.amount;
    const role = roles.earning.get(i.cat);
    if (role === "paycheck") paycheck += i.amount;
    if (role === "offset") offsets += i.amount;
    if (role === "reimbursement") reimbursed += i.amount;
  }

  let ccPayments = 0, netSavings = 0, investRetirement = 0, investTaxable = 0;
  for (const t of ledger.transfers) {
    if (!inMonth(t.date, month)) continue;
    switch (roles.transfer.get(t.cat)) {
      case "cc_payment": ccPayments += t.amount; break;
      case "savings_in": netSavings += t.amount; break;
      case "savings_out": netSavings -= t.amount; break;
      case "invest_retirement": investRetirement += t.amount; break;
      case "invest_taxable": investTaxable += t.amount; break;
    }
  }

  const investment = investRetirement + investTaxable;
  return {
    earned, paycheck, otherEarned: earned - paycheck,
    spent, spentBySource,
    surplus: earned - spent,
    ccPayments, netSavings, investRetirement, investTaxable, investment,
    charity, loan,
    offsets, reimbursed, owed,
    netSpent: spent - offsets - owed,
    netIncome: earned - offsets - reimbursed,
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
  /** Shares of those expenses owed by other people. */
  owed: Cents;
  /** Offsets aimed at this category (refunds with `offsets` set to it). */
  offsets: Cents;
  /** gross − owed − offsets: what the budget compares against. */
  net: Cents;
}

/**
 * Spending per expense category id. Every expense category is present, even at 0.
 * Offsets with `offsets: null` don't belong to a category, so they only reduce the
 * total (Summary.netSpent), not any row here.
 */
export function spendByCategory(ledger: Ledger, month?: number): Map<string, CategorySpend> {
  const out = new Map<string, CategorySpend>();
  for (const c of ledger.categories.expense) out.set(c.id, { gross: 0, owed: 0, offsets: 0, net: 0 });
  const row = (cat: string) => {
    let r = out.get(cat);
    if (!r) out.set(cat, (r = { gross: 0, owed: 0, offsets: 0, net: 0 }));
    return r;
  };

  for (const e of ledger.expenses) {
    if (!inMonth(e.date, month)) continue;
    const r = row(e.cat);
    r.gross += e.amount;
    r.owed += e.owed?.amount ?? 0;
  }
  const roles = rolesOf(ledger);
  for (const i of ledger.earnings) {
    if (inMonth(i.date, month) && roles.earning.get(i.cat) === "offset" && i.offsets) row(i.offsets).offsets += i.amount;
  }
  for (const r of out.values()) r.net = r.gross - r.owed - r.offsets;
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
 * Balance of every account id, using the net-worth sign (a card that owes money is negative):
 * balance = opening + money in − money out. Pass `through` to get balances at the end of that day.
 */
export function balances(ledger: Ledger, through?: IsoDate): Map<string, Cents> {
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
  return bal;
}

export interface CardStatus {
  account: Account;
  /** Amount owed, positive. 0 if the card is paid off or in credit. */
  debt: Cents;
  /** debt ÷ limit, or null for a card without a limit. */
  utilization: number | null;
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
  /** Available cash − card debt. Investments are left out (only contributions are tracked). */
  netTangibleAssets: Cents;
  /** Contributions made this year, per investment account. */
  invested: Map<string, Cents>;
}

export function accountsOverview(ledger: Ledger, through?: IsoDate): AccountsOverview {
  const bal = balances(ledger, through);
  const balOf = (a: Account) => bal.get(a.id) ?? 0;

  let availableCash = 0, cardDebt = 0, cardLimit = 0;
  const cards: CardStatus[] = [];
  const invested = new Map<string, Cents>();
  for (const a of ledger.accounts) {
    switch (a.type) {
      case "checking":
      case "savings":
      case "cash":
        availableCash += balOf(a);
        break;
      case "credit": {
        cardDebt -= balOf(a);
        cardLimit += a.limit ?? 0;
        const debt = Math.max(0, -balOf(a));
        cards.push({ account: a, debt, utilization: a.limit ? debt / a.limit : null });
        break;
      }
      case "investment":
        // Investment accounts open at 0 each year, so the balance is this year's contributions.
        invested.set(a.id, balOf(a) - a.opening);
        break;
    }
  }
  return {
    balances: bal,
    availableCash, cardDebt, cardLimit,
    utilization: ratio(cardDebt, cardLimit),
    cards,
    netTangibleAssets: availableCash - cardDebt,
    invested,
  };
}

/** How much more can go into retirement accounts this year. Never below 0. */
export function remainingRetirement(ledger: Ledger, annualLimit: Cents): Cents {
  return Math.max(0, annualLimit - summarize(ledger).investRetirement);
}

// --- Shared expenses (§5) ---

/** Person id -> what they still owe: owed shares minus what they paid back. Negative = overpaid. */
export function receivables(ledger: Ledger): Map<string, Cents> {
  const out = new Map<string, Cents>();
  const add = (person: string, amount: Cents) => out.set(person, (out.get(person) ?? 0) + amount);
  for (const e of ledger.expenses) if (e.owed) add(e.owed.person, e.owed.amount);
  const roles = rolesOf(ledger);
  for (const i of ledger.earnings) {
    if (roles.earning.get(i.cat) === "reimbursement" && i.person) add(i.person, -i.amount);
  }
  return out;
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
    return { date, availableCash: o.availableCash, cardDebt: o.cardDebt, invested, saved };
  });
}

// --- Money flow (Sankey) ---

export type FlowGroup = "income" | "hub" | "spending" | "savings" | "investment" | "balance";

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
 *   taken from savings ─┼─▶  Income  ─▶ ├─ savings, investments
 *   drawn from balances ┘                └─ left over in accounts
 * Transfers between your own accounts (card payments, cash withdrawals) don't appear:
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

  // Whatever is left balances the two sides.
  const left = s.earned + Math.max(0, -s.netSavings) - s.spent - Math.max(0, s.netSavings) - s.investment;
  outOf("left-over", "Left over", "balance", left);
  into("drawn", "Drawn from balances", "balance", -left);
  return { nodes, links };
}

// --- Budgets (§6) ---

/** The budgets key for a month: 2026, 3 -> "2026-03". */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** A category's target for one month: that month's override if set, else the usual target. */
export function budgetTarget(budgets: Budgets, year: number, month: number, cat: string): Cents | undefined {
  return budgets[monthKey(year, month)]?.[cat] ?? budgets.default[cat];
}

export interface BudgetLine {
  cat: string;
  /** Sum of the targets over the months shown; undefined if the category has no budget. */
  target: Cents | undefined;
  /** True when a single month is shown and it overrides the usual target. */
  overridden: boolean;
  /** Net spending: expenses minus owed shares and refunds aimed at this category. */
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

/** Budgeted against spent for the given months (one month, or January up to some month). */
export function budgetView(ledger: Ledger, budgets: Budgets, year: number, months: number[]): BudgetView {
  const roles = rolesOf(ledger);
  const spent = new Map<string, Cents>();
  let untargetedOffsets = 0;
  for (const m of months) {
    for (const [cat, c] of spendByCategory(ledger, m)) spent.set(cat, (spent.get(cat) ?? 0) + c.net);
    for (const i of ledger.earnings) {
      if (inMonth(i.date, m) && roles.earning.get(i.cat) === "offset" && !i.offsets) untargetedOffsets += i.amount;
    }
  }

  const single = months.length === 1 ? months[0] : undefined;
  let budgeted = 0, spentBudgeted = 0, spentUnbudgeted = 0;
  const lines = ledger.categories.expense.map((c): BudgetLine => {
    const targets = months.map((m) => budgetTarget(budgets, year, m, c.id));
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
 * 0.5 on the 15th of a 30-day month. Null if the day isn't in that month.
 */
export function monthProgress(year: number, month: number, today: IsoDate): number | null {
  if (today.slice(0, 7) !== monthKey(year, month)) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number(today.slice(8, 10)) / days;
}
