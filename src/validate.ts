// Checks that an imported JSON file really is a money-tracker YearFile before it
// touches the database. Returns every problem found, not just the first, so a
// broken file can be fixed in one go.

import type { AccountType, YearFile } from "./types";

export type ValidationResult = { ok: true; file: YearFile } | { ok: false; errors: string[] };

const ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "cash", "credit", "investment", "loan"];
const EXPENSE_ROLES = ["charity"];
const EARNING_ROLES = ["paycheck", "income", "offset"];
const TRANSFER_ROLES = [
  "cc_payment", "savings_in", "savings_out", "invest_retirement",
  "invest_taxable", "cash_withdrawal", "loan_payment", "general",
];

// The checks below read fields off objects whose shape isn't known yet.
type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCents(v: unknown): v is number {
  return Number.isSafeInteger(v);
}

/** A real calendar date in the given year, as "YYYY-MM-DD". */
export function isDateInYear(v: unknown, year: number): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return d.toISOString().slice(0, 10) === v && d.getUTCFullYear() === year;
}

/** A real calendar date in any year, as "YYYY-MM-DD". */
export function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-/.test(v) && isDateInYear(v, Number(v.slice(0, 4)));
}

/** A yearly interest rate as a percentage: 0 to 100, at most 3 decimals (6.125). */
export function isRate(v: unknown): v is number {
  return typeof v === "number" && v >= 0 && v <= 100 && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
}

/** A copy of the list with `key` removed from the objects where it holds `value`. Anything else passes through. */
function withoutKeyWhere(list: unknown[], key: string, value: unknown): unknown[] {
  return list.map((r) => {
    if (!isObj(r) || r[key] !== value) return r;
    const { [key]: _gone, ...keep } = r;
    return keep;
  });
}

/** A copy of the list with `key` removed from every object in it. Anything else passes through. */
function withoutKey(list: unknown, key: string): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((r) => {
    if (!isObj(r) || !(key in r)) return r;
    const { [key]: _gone, ...keep } = r;
    return keep;
  });
}

/**
 * Files saved before people were dropped can hold `people`, expense `owed` shares, earning
 * `person`s and a "reimbursement" earning role. Strip them, and make reimbursement "offset"
 * (money paid back now lowers spending), so those files still import. Files from before loan
 * payments were transfers can have a "loan" expense role: those categories become regular.
 */
function withoutLegacyPeople(data: Obj): Obj {
  const { people: _people, ...rest } = data;
  const cats = rest.categories;
  let categories = isObj(cats) && Array.isArray(cats.earning)
    ? { ...cats, earning: cats.earning.map((c) => (isObj(c) && c.role === "reimbursement" ? { ...c, role: "offset" } : c)) }
    : cats;
  if (isObj(categories) && Array.isArray(categories.expense)) {
    categories = { ...categories, expense: withoutKeyWhere(categories.expense, "role", "loan") };
  }
  return { ...rest, categories, expenses: withoutKey(rest.expenses, "owed"), earnings: withoutKey(rest.earnings, "person") };
}

export function validateYearFile(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (!isObj(raw)) return { ok: false, errors: ["The file is not a JSON object."] };
  const data = withoutLegacyPeople(raw);
  if (data.app !== "money-tracker") return { ok: false, errors: ["This is not a Money Tracker file."] };
  if (data.schema !== 1) return { ok: false, errors: [`Unsupported file version: ${String(data.schema)}.`] };

  const year = data.year;
  if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 2999) {
    return { ok: false, errors: ["The file has no valid year."] };
  }
  const y = year as number;
  if (data.start !== undefined && !isDateInYear(data.start, y)) {
    return { ok: false, errors: [`"start" must be a date in ${y}, like "${y}-07-14".`] };
  }
  const start = data.start as string | undefined;

  for (const key of ["accounts", "tags", "expenses", "earnings", "transfers"]) {
    if (!Array.isArray(data[key])) err(`"${key}" must be a list.`);
  }
  if (data.members !== undefined && !Array.isArray(data.members)) err(`"members" must be a list.`);
  if (!isObj(data.categories)) err(`"categories" is missing.`);
  if (!isObj(data.budgets) || !isObj(data.budgets.default)) err(`"budgets.default" is missing.`);
  if (data.closed !== undefined && typeof data.closed !== "boolean") err(`"closed" must be true or false.`);
  if (data.iraLimit !== undefined && !(isCents(data.iraLimit) && data.iraLimit >= 0)) err(`"iraLimit" is not whole cents.`);
  if (data.iraBeforeStart !== undefined && !(isCents(data.iraBeforeStart) && data.iraBeforeStart >= 0)) {
    err(`"iraBeforeStart" is not whole cents.`);
  }
  if (data.settings !== undefined) {
    const pinned = isObj(data.settings) ? data.settings.pinnedTags : undefined;
    if (!isObj(data.settings)) err(`"settings" must be an object.`);
    else if (pinned !== undefined && !(Array.isArray(pinned) && pinned.every((t) => typeof t === "string"))) {
      err(`"settings.pinnedTags" must be a list of tag ids.`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const cats = data.categories as Obj;
  for (const kind of ["expense", "earning", "transfer"]) {
    if (!Array.isArray(cats[kind])) err(`"categories.${kind}" must be a list.`);
  }
  if (errors.length) return { ok: false, errors };

  /** Collects the ids of a list, reporting entries without an id and duplicates. */
  function ids(list: unknown[], label: string, nameRequired: boolean): Set<string> {
    const seen = new Set<string>();
    list.forEach((x, i) => {
      if (!isObj(x) || typeof x.id !== "string" || !x.id) {
        err(`${label} #${i + 1} has no id.`);
        return;
      }
      if (seen.has(x.id)) err(`${label} id "${x.id}" is used twice.`);
      seen.add(x.id);
      if (nameRequired && (typeof x.name !== "string" || !x.name.trim())) err(`${label} "${x.id}" has no name.`);
    });
    return seen;
  }

  const accounts = data.accounts as unknown[];
  const accountIds = ids(accounts, "Account", true);
  const expenseCats = ids(cats.expense as unknown[], "Expense category", true);
  const earningCats = ids(cats.earning as unknown[], "Earning category", true);
  const transferCats = ids(cats.transfer as unknown[], "Transfer category", true);
  const tagIds = ids(data.tags as unknown[], "Tag", true);
  const memberIds = ids((data.members ?? []) as unknown[], "Member", true);

  for (const a of accounts.filter(isObj)) {
    if (!ACCOUNT_TYPES.includes(a.type as AccountType)) err(`Account "${a.id}" has unknown type "${String(a.type)}".`);
    if (typeof a.ref !== "string") err(`Account "${a.id}" has no ref.`);
    if (!isCents(a.opening)) err(`Account "${a.id}" opening balance is not whole cents.`);
    if (a.limit !== undefined && !(isCents(a.limit) && a.limit >= 0)) err(`Account "${a.id}" limit is not whole cents.`);
    if (a.type === "loan") {
      if (!isDate(a.loanStart) || Number(a.loanStart.slice(0, 4)) > y) err(`Loan "${a.id}" needs a start date in ${y} or earlier.`);
      else if (a.opening !== 0 && a.loanStart >= (start ?? `${y}-01-01`)) {
        err(`Loan "${a.id}" began after tracking started, so it must open at 0: its amount is added on its start date.`);
      }
      if (!(isCents(a.loanAmount) && a.loanAmount > 0)) err(`Loan "${a.id}" amount is not whole cents.`);
      if (!isRate(a.rate)) err(`Loan "${a.id}" interest rate must be a percentage from 0 to 100.`);
    } else if (a.loanStart !== undefined || a.loanAmount !== undefined || a.rate !== undefined) {
      err(`Account "${a.id}" isn't a loan, so it can't have a loan start, amount or rate.`);
    }
  }

  // Earning and transfer categories drive the reports, so they must have a role.
  // Expense categories only have one when they are special (charity, loan).
  const roleChecks: [string, string[], boolean][] = [
    ["expense", EXPENSE_ROLES, false],
    ["earning", EARNING_ROLES, true],
    ["transfer", TRANSFER_ROLES, true],
  ];
  for (const [kind, roles, required] of roleChecks) {
    for (const c of (cats[kind] as unknown[]).filter(isObj)) {
      if (c.role === undefined) {
        if (required) err(`${kind} category "${c.name}" has no role.`);
      } else if (!roles.includes(c.role as string)) {
        err(`${kind} category "${c.name}" has unknown role "${String(c.role)}".`);
      }
      if (c.net !== undefined && (kind !== "earning" || typeof c.net !== "boolean")) {
        err(`${kind} category "${c.name}": "net" must be true or false, on earning categories only.`);
      }
    }
  }

  /** Fields every entry has: id, date, item, amount, notes. */
  function checkEntry(r: Obj, label: string) {
    if (!isDateInYear(r.date, y)) err(`${label} "${r.id}" date "${String(r.date)}" is not a date in ${y}.`);
    else if (start && (r.date as string) < start) {
      err(`${label} "${r.id}" is dated ${String(r.date)}, before ${y}'s tracking starts (${start}). The opening balances already include it.`);
    }
    if (typeof r.item !== "string") err(`${label} "${r.id}" has no item.`);
    if (!isCents(r.amount)) err(`${label} "${r.id}" amount is not whole cents.`);
    else if (r.amount < 0) err(`${label} "${r.id}" amount is negative (${r.amount / 100}). Record refunds as an earning that lowers spending.`);
    if (typeof r.notes !== "string") err(`${label} "${r.id}" notes must be text.`);
    if (r.member !== undefined && !memberIds.has(r.member as string)) err(`${label} "${r.id}" belongs to unknown member "${String(r.member)}".`);
  }

  const expenses = data.expenses as unknown[];
  ids(expenses, "Expense", false);
  for (const r of expenses.filter(isObj)) {
    checkEntry(r, "Expense");
    if (!accountIds.has(r.account as string)) err(`Expense "${r.id}" uses unknown account "${String(r.account)}".`);
    if (!expenseCats.has(r.cat as string)) err(`Expense "${r.id}" uses unknown category "${String(r.cat)}".`);
    if (!Array.isArray(r.tags)) err(`Expense "${r.id}" tags must be a list.`);
    else for (const t of r.tags) if (!tagIds.has(t as string)) err(`Expense "${r.id}" uses unknown tag "${String(t)}".`);
  }

  const earnings = data.earnings as unknown[];
  ids(earnings, "Earning", false);
  for (const r of earnings.filter(isObj)) {
    checkEntry(r, "Earning");
    if (!accountIds.has(r.account as string)) err(`Earning "${r.id}" uses unknown account "${String(r.account)}".`);
    if (!earningCats.has(r.cat as string)) err(`Earning "${r.id}" uses unknown category "${String(r.cat)}".`);
    if (r.offsets != null && !expenseCats.has(r.offsets as string)) err(`Earning "${r.id}" offsets unknown category "${String(r.offsets)}".`);
  }

  const transfers = data.transfers as unknown[];
  ids(transfers, "Transfer", false);
  for (const r of transfers.filter(isObj)) {
    checkEntry(r, "Transfer");
    if (!accountIds.has(r.from as string)) err(`Transfer "${r.id}" comes from unknown account "${String(r.from)}".`);
    if (!accountIds.has(r.to as string)) err(`Transfer "${r.id}" goes to unknown account "${String(r.to)}".`);
    if (r.from === r.to) err(`Transfer "${r.id}" goes from an account to itself.`);
    if (!transferCats.has(r.cat as string)) err(`Transfer "${r.id}" uses unknown category "${String(r.cat)}".`);
  }

  for (const [month, targets] of Object.entries(data.budgets as Obj)) {
    if (month !== "default" && !/^\d{4}-\d{2}$/.test(month)) err(`Budget key "${month}" must be "default" or "YYYY-MM".`);
    if (!isObj(targets)) { err(`Budget "${month}" must be an object.`); continue; }
    for (const [cat, amount] of Object.entries(targets)) {
      if (!expenseCats.has(cat)) err(`Budget "${month}" uses unknown category "${cat}".`);
      if (!(isCents(amount) && amount >= 0)) err(`Budget "${month}" for "${cat}" is not whole cents.`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, file: data as unknown as YearFile };
}
