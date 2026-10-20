// Everything the app shows that isn't typed in by the user is computed here, from the
// raw tables. Nothing computed is ever stored. See the project brief, §4 and §5.
//
// These are plain functions with no UI code, so tests can check them directly
// against the totals Notion computed (tests/derive.test.ts, tests/real-data.test.ts).

import type {
  Account, Cents, EarningRole, ExpenseRole, IsoDate, TransferRole, YearFile,
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

  let earned = 0, paycheck = 0, offsets = 0, reimbursed = 0;
  for (const i of ledger.earnings) {
    if (!inMonth(i.date, month)) continue;
    earned += i.amount;
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
    savingsRate: ratio(netSavings, paycheck),
    investmentRate: ratio(investment, paycheck),
    charityRate: ratio(charity, paycheck),
  };
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
