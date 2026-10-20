// Checks that an imported JSON file really is a money-tracker YearFile before it
// touches the database. Returns every problem found, not just the first, so a
// broken file can be fixed in one go.

import type { AccountType, YearFile } from "./types";

export type ValidationResult = { ok: true; file: YearFile } | { ok: false; errors: string[] };

const ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "cash", "credit", "investment"];
const EXPENSE_ROLES = ["charity", "loan"];
const EARNING_ROLES = ["paycheck", "income", "offset", "reimbursement"];
const TRANSFER_ROLES = [
  "cc_payment", "savings_in", "savings_out", "invest_retirement",
  "invest_taxable", "cash_withdrawal", "general",
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
function isDateInYear(v: unknown, year: number): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return d.toISOString().slice(0, 10) === v && d.getUTCFullYear() === year;
}

export function validateYearFile(data: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (!isObj(data)) return { ok: false, errors: ["The file is not a JSON object."] };
  if (data.app !== "money-tracker") return { ok: false, errors: ["This is not a Money Tracker file."] };
  if (data.schema !== 1) return { ok: false, errors: [`Unsupported file version: ${String(data.schema)}.`] };

  const year = data.year;
  if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 2999) {
    return { ok: false, errors: ["The file has no valid year."] };
  }
  const y = year as number;

  for (const key of ["accounts", "tags", "expenses", "earnings", "transfers"]) {
    if (!Array.isArray(data[key])) err(`"${key}" must be a list.`);
  }
  if (data.people !== undefined && !Array.isArray(data.people)) err(`"people" must be a list.`);
  if (!isObj(data.categories)) err(`"categories" is missing.`);
  if (!isObj(data.budgets) || !isObj(data.budgets.default)) err(`"budgets.default" is missing.`);
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
  const personIds = ids((data.people ?? []) as unknown[], "Person", true);

  for (const a of accounts.filter(isObj)) {
    if (!ACCOUNT_TYPES.includes(a.type as AccountType)) err(`Account "${a.id}" has unknown type "${String(a.type)}".`);
    if (typeof a.ref !== "string") err(`Account "${a.id}" has no ref.`);
    if (!isCents(a.opening)) err(`Account "${a.id}" opening balance is not whole cents.`);
    if (a.limit !== undefined && !(isCents(a.limit) && a.limit >= 0)) err(`Account "${a.id}" limit is not whole cents.`);
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
    }
  }

  /** Fields every entry has: id, date, item, amount, notes. */
  function checkEntry(r: Obj, label: string) {
    if (!isDateInYear(r.date, y)) err(`${label} "${r.id}" date "${String(r.date)}" is not a date in ${y}.`);
    if (typeof r.item !== "string") err(`${label} "${r.id}" has no item.`);
    if (!(isCents(r.amount) && r.amount >= 0)) err(`${label} "${r.id}" amount is not whole cents.`);
    if (typeof r.notes !== "string") err(`${label} "${r.id}" notes must be text.`);
  }

  const expenses = data.expenses as unknown[];
  ids(expenses, "Expense", false);
  for (const r of expenses.filter(isObj)) {
    checkEntry(r, "Expense");
    if (!accountIds.has(r.account as string)) err(`Expense "${r.id}" uses unknown account "${String(r.account)}".`);
    if (!expenseCats.has(r.cat as string)) err(`Expense "${r.id}" uses unknown category "${String(r.cat)}".`);
    if (!Array.isArray(r.tags)) err(`Expense "${r.id}" tags must be a list.`);
    else for (const t of r.tags) if (!tagIds.has(t as string)) err(`Expense "${r.id}" uses unknown tag "${String(t)}".`);
    if (r.owed !== undefined) {
      const o = r.owed;
      if (!isObj(o) || !personIds.has(o.person as string)) err(`Expense "${r.id}" is owed by an unknown person.`);
      else if (!(isCents(o.amount) && o.amount >= 0 && o.amount <= (r.amount as number))) {
        err(`Expense "${r.id}" owed amount must be between 0 and the expense amount.`);
      }
    }
  }

  const earnings = data.earnings as unknown[];
  ids(earnings, "Earning", false);
  for (const r of earnings.filter(isObj)) {
    checkEntry(r, "Earning");
    if (!accountIds.has(r.account as string)) err(`Earning "${r.id}" uses unknown account "${String(r.account)}".`);
    if (!earningCats.has(r.cat as string)) err(`Earning "${r.id}" uses unknown category "${String(r.cat)}".`);
    if (r.offsets != null && !expenseCats.has(r.offsets as string)) err(`Earning "${r.id}" offsets unknown category "${String(r.offsets)}".`);
    if (r.person !== undefined && !personIds.has(r.person as string)) err(`Earning "${r.id}" names unknown person "${String(r.person)}".`);
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
