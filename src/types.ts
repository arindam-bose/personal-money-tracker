// Data model for one tracked year. See the project brief, §3.
// Everything not in these types (balances, totals, budgets spent) is derived, never stored.

/** Money is always integer cents, never floats: $12.34 is 1234. */
export type Cents = number;

/** A calendar date as "YYYY-MM-DD". */
export type IsoDate = string;

export type AccountType = "checking" | "savings" | "cash" | "credit" | "investment";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Last 4 digits or a handle, e.g. "**0883" or "@someone". */
  ref: string;
  /** Net-worth sign: a credit card that owes money opens negative. */
  opening: Cents;
  /** Credit limit, credit cards only. */
  limit?: Cents;
  archived?: boolean;
}

// Roles are hidden tags on categories, so users can rename categories
// and the reports still know what each one means.
export type ExpenseRole = "charity" | "loan";
export type EarningRole = "paycheck" | "income" | "offset" | "reimbursement";
export type TransferRole =
  | "cc_payment"
  | "savings_in"
  | "savings_out"
  | "invest_retirement"
  | "invest_taxable"
  | "cash_withdrawal"
  | "general";

export interface Category<R extends string> {
  id: string;
  name: string;
  role?: R;
  /**
   * Earning categories with a paycheck or income role only: whether they count toward
   * "Net earnings" on the dashboard. Left out, they count. Set false for one-offs
   * like insurance payouts.
   */
  net?: boolean;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface Expense {
  id: string;
  date: IsoDate;
  item: string;
  amount: Cents;
  /** Account id the money left. */
  account: string;
  /** Expense category id. */
  cat: string;
  /** Tag ids. */
  tags: string[];
  notes: string;
  /** The part of this expense someone else owes back (§5). */
  owed?: { person: string; amount: Cents };
}

export interface Earning {
  id: string;
  date: IsoDate;
  item: string;
  amount: Cents;
  /** Account id the money went into. */
  account: string;
  /** Earning category id. */
  cat: string;
  notes: string;
  /** For role "offset": the expense category it reduces, or null for total spending only. */
  offsets?: string | null;
  /** For role "reimbursement": the person id who paid back. */
  person?: string;
}

export interface Transfer {
  id: string;
  date: IsoDate;
  item: string;
  amount: Cents;
  /** Account id the money left. */
  from: string;
  /** Account id the money went into. */
  to: string;
  /** Transfer category id. */
  cat: string;
  notes: string;
}

export interface Categories {
  expense: Category<ExpenseRole>[];
  earning: Category<EarningRole>[];
  transfer: Category<TransferRole>[];
}

/** Monthly targets per expense category id. "default" applies to every month; "YYYY-MM" keys override it. */
export type Budgets = { default: Record<string, Cents> } & Record<string, Record<string, Cents>>;

/** The JSON backup file for one year. It is also the shape the app imports. */
export interface YearFile {
  app: "money-tracker";
  schema: 1;
  year: number;
  exportedAt: string;
  accounts: Account[];
  categories: Categories;
  tags: Tag[];
  people?: Person[];
  expenses: Expense[];
  earnings: Earning[];
  transfers: Transfer[];
  budgets: Budgets;
}

/** The parts of a YearFile that are set up once, not entered day to day. */
export type YearSetup = Pick<YearFile, "year" | "accounts" | "categories" | "tags" | "people" | "budgets"> & {
  /** Set by "Close year"; a closed year is read-only. */
  closed?: boolean;
  /** When this year was last exported to JSON (ISO timestamp), for the backup reminder. */
  lastBackupAt?: string;
};
