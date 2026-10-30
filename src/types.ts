// Data model for one tracked year. See the project brief, §3.
// Everything not in these types (balances, totals, budgets spent) is derived, never stored.

/** Money is always integer cents, never floats: $12.34 is 1234. */
export type Cents = number;

/** A calendar date as "YYYY-MM-DD". */
export type IsoDate = string;

export type AccountType = "checking" | "savings" | "cash" | "credit" | "investment" | "loan" | "asset";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Last 4 digits or a handle, e.g. "**0883" or "@someone". */
  ref: string;
  /**
   * Net-worth sign: a credit card that owes money opens negative, and so does a loan.
   * A loan taken out on or after the day tracking starts opens at 0: its amount is added on its start date.
   * An investment opens at 0 (its balance is this year's contributions), and an asset always does:
   * what either is worth comes from `valuations`.
   */
  opening: Cents;
  /** Credit limit, credit cards only. */
  limit?: Cents;
  /** Loans only: the day the loan began. Interest is added on each monthly anniversary of it. */
  loanStart?: IsoDate;
  /** Loans only: the amount borrowed. */
  loanAmount?: Cents;
  /** Loans only: the yearly interest rate as a percentage, e.g. 6.5. */
  rate?: number;
  /**
   * Investment and asset accounts only: what the account was worth on the days the user updated
   * it, oldest first, one per day. Between updates it's worth the last one; before the first, it's
   * left out of net worth. An investment starts each year without any; an asset (a house,
   * a car, whose value seldom changes) starts it with its last value, dated January 1.
   * An asset's value only ever comes from these: no entry can use an asset account.
   */
  valuations?: Valuation[];
  archived?: boolean;
  /**
   * The day the account was closed (sold, paid off, shut). From that day on it's left out:
   * an asset or investment is worth nothing, and no entry or update can come after it.
   * A bank, cash, card or loan account must be at 0 that day: its money moves out by a transfer.
   * The next year doesn't have it.
   */
  closedOn?: IsoDate;
}

/** An investment account's balance on a day, as the user read it from the broker. */
export interface Valuation {
  date: IsoDate;
  amount: Cents;
}

// Roles are hidden tags on categories, so users can rename categories
// and the reports still know what each one means.
export type ExpenseRole = "charity";
export type EarningRole = "paycheck" | "income" | "offset";
export type TransferRole =
  | "cc_payment"
  | "savings_in"
  | "savings_out"
  | "invest_retirement"
  | "invest_taxable"
  | "cash_withdrawal"
  | "loan_payment"
  | "general";

export interface Category<R extends string> {
  id: string;
  name: string;
  role?: R;
  /**
   * Earning categories with a paycheck or income role only: whether they count toward
   * "Net earnings" on the dashboard. Left out, they count. Set false for one-offs
   * like insurance payouts. Only "offset" categories lower net spending.
   */
  net?: boolean;
}

export interface Tag {
  id: string;
  name: string;
}

/** Someone in the household whose entries can be shown on their own. Accounts stay shared. */
export interface Member {
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
  /** Member id, set only for someone other than the first (default) member. */
  member?: string;
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
  /** Member id, set only for someone other than the first (default) member. */
  member?: string;
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
  /** Member id, set only for someone other than the first (default) member. */
  member?: string;
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
  /**
   * The day tracking began, for a year started partway through. Left out, it is January 1.
   * Opening balances are what each account held on the morning of this day, and no entry
   * can be dated before it.
   */
  start?: IsoDate;
  exportedAt: string;
  /**
   * When an entry was last added, changed or deleted (ISO timestamp): the ledger's "Last updated".
   * Of two backups of a year, the later one holds the newer data. Left out until the first change.
   */
  lastChangedAt?: string;
  /**
   * When the setup last changed (ISO timestamp): accounts, categories, tags, people, budgets,
   * the start day or IRA settings. Apart from lastChangedAt, which is only the entries; together
   * they tell the backup reminder whether anything changed since the last backup. Left out until the first change.
   */
  setupChangedAt?: string;
  /** Set by "Close year"; a closed year is read-only. Left out while the year is open. */
  closed?: boolean;
  accounts: Account[];
  categories: Categories;
  tags: Tag[];
  /** The household. Left out or empty means one default member, "Person A". */
  members?: Member[];
  expenses: Expense[];
  earnings: Earning[];
  transfers: Transfer[];
  budgets: Budgets;
  /**
   * This year's IRA contribution limit. Every backup writes it; files from before v1.0.16 leave it out,
   * and then the IRS limit for the year applies (see IRA_LIMITS).
   */
  iraLimit?: Cents;
  /**
   * A year begun partway through: IRA contributions made earlier that year, before tracking
   * started. They aren't in the ledger, but they count against the IRA limit.
   */
  iraBeforeStart?: Cents;
  /** App-wide settings at export time. Importing applies them only to a device that has none yet. */
  settings?: FileSettings;
}

/** The app-wide settings a backup carries, so a new device can be set up from it. */
export interface FileSettings {
  /** Tag ids whose totals show on the dashboard. */
  pinnedTags?: string[];
}

/** The parts of a YearFile that are set up once, not entered day to day. */
export type YearSetup = Pick<YearFile, "year" | "start" | "closed" | "accounts" | "categories" | "tags" | "members" | "budgets" | "iraLimit" | "iraBeforeStart" | "lastChangedAt" | "setupChangedAt"> & {
  /** When this year was last exported to JSON (ISO timestamp), for the backup reminder. */
  lastBackupAt?: string;
};
