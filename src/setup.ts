// Editing a year's setup: accounts, categories and tags. Each function checks
// the change and returns a new setup, or throws a SetupError with a message for the user.
// Everything refers to these by id, so renaming never touches a single entry.

import type { YearData } from "./db";
import { newId, slug } from "./entries";
import { membersOf } from "./members";
import { isDate, isDateInYear, isRate } from "./validate";
import { balances, hasValuations, ledgerOf, loanDueDates, loanStatus, localToday, shortDate, valuationOf } from "./derive";
import { formatCents } from "./money";
import { dayBefore, yearStart } from "./year";
import type {
  Account, Categories, Category, Cents, IsoDate, Earning, EarningRole, Expense, ExpenseRole, Member, Tag, Transfer, TransferRole, YearSetup,
} from "./types";

export { DEFAULT_MEMBER, membersOf } from "./members";

export class SetupError extends Error {}

export type CategoryKind = "expense" | "earning" | "transfer";

/** How many entries use each account, category, tag and member. Used to block unsafe deletes. */
export interface Usage {
  accounts: Map<string, number>;
  /** By account id, the expenses and earnings only: what a loan can't take. */
  spends: Map<string, number>;
  categories: Map<string, number>;
  tags: Map<string, number>;
  /** By member id; entries of the default member (no `member` set) count under "". */
  members: Map<string, number>;
}

export function usageOf(data: Pick<YearData, "expenses" | "earnings" | "transfers">): Usage {
  const u: Usage = { accounts: new Map(), spends: new Map(), categories: new Map(), tags: new Map(), members: new Map() };
  const add = (m: Map<string, number>, id: string | null | undefined) => {
    if (id) m.set(id, (m.get(id) ?? 0) + 1);
  };
  for (const e of [...data.expenses, ...data.earnings, ...data.transfers]) {
    u.members.set(e.member ?? "", (u.members.get(e.member ?? "") ?? 0) + 1);
  }
  for (const e of data.expenses) {
    add(u.accounts, e.account);
    add(u.spends, e.account);
    add(u.categories, e.cat);
    e.tags.forEach((t) => add(u.tags, t));
  }
  for (const i of data.earnings) {
    add(u.accounts, i.account);
    add(u.spends, i.account);
    add(u.categories, i.cat);
    add(u.categories, i.offsets); // a refund aimed at a spending category uses it too
  }
  for (const t of data.transfers) {
    add(u.accounts, t.from);
    add(u.accounts, t.to);
    add(u.categories, t.cat);
  }
  return u;
}

const EXPENSE_ROLES: (ExpenseRole | undefined)[] = [undefined, "charity"];
const EARNING_ROLES: EarningRole[] = ["paycheck", "income", "offset"];
const TRANSFER_ROLES: TransferRole[] = [
  "cc_payment", "savings_in", "savings_out", "invest_retirement", "invest_taxable", "cash_withdrawal", "loan_payment", "general",
];

/** A new id for a named thing, like "a_chase-checking", made unique if needed. */
export function idFor(prefix: string, name: string, taken: Set<string>): string {
  const base = `${prefix}_${slug(name) || "item"}`;
  return taken.has(base) ? newId(base, (x) => taken.has(x)) : base;
}

function cleanName(name: string, what: string): string {
  const n = name.trim();
  if (!n) throw new SetupError(`Give the ${what} a name.`);
  return n;
}

function assertUniqueName(list: { id: string; name: string }[], name: string, id: string | undefined, what: string) {
  if (list.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
    throw new SetupError(`There's already ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what} called “${name}”.`);
  }
}

/** Replace the item with the same id, or add it at the end. */
function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

// --- Accounts ---

/**
 * Add or update an account. Pass an account without an id (id: "") to add one. With the year's
 * `usage`, an account can't change to a type its entries don't fit: no entry can use an asset,
 * and a loan only takes transfers.
 */
export function saveAccount(setup: YearSetup, account: Account, usage?: Usage): YearSetup {
  const name = cleanName(account.name, "account");
  const id = account.id || idFor("a", name, new Set(setup.accounts.map((a) => a.id)));
  const before = setup.accounts.find((a) => a.id === id);
  if (usage && before && before.type !== account.type) {
    const n = account.type === "asset" ? usage.accounts.get(id) ?? 0 : account.type === "loan" ? usage.spends.get(id) ?? 0 : 0;
    if (n) {
      const what = account.type === "asset" ? `${n === 1 ? "an entry" : `${n} entries`}, and an asset can't have any`
        : `${n === 1 ? "an expense or earning" : `${n} expenses and earnings`}, and a loan only takes transfers`;
      throw new SetupError(`${before.name} has ${what}. Move ${n === 1 ? "it" : "them"} to another account first.`);
    }
  }
  assertUniqueName(setup.accounts, name, id, "account");
  if (!Number.isSafeInteger(account.opening)) throw new SetupError("The opening balance must be an amount like 1234.56.");
  const clean: Account = { id, name, type: account.type, ref: account.ref.trim(), opening: account.opening };
  if (account.type === "credit") {
    if (account.limit === undefined || !Number.isSafeInteger(account.limit) || account.limit < 0) {
      throw new SetupError("A credit card needs a credit limit.");
    }
    clean.limit = account.limit;
  }
  if (account.type === "loan") {
    const { loanStart, loanAmount, rate } = account;
    if (!isDate(loanStart) || loanStart > `${setup.year}-12-31`) throw new SetupError(`Pick the day the loan began, in ${setup.year} or earlier.`);
    if (loanAmount === undefined || !Number.isSafeInteger(loanAmount) || loanAmount <= 0) throw new SetupError("Enter the amount borrowed.");
    if (!isRate(rate)) throw new SetupError("Enter the yearly interest rate as a percentage, like 6.5.");
    // A loan taken out since tracking started is added on its start date, so it opens at 0.
    if (loanStart >= yearStart(setup)) clean.opening = 0;
    Object.assign(clean, { loanStart, loanAmount, rate });
  }
  // An asset's value only comes from its updates: no opening balance, and no entries.
  if (account.type === "asset") clean.opening = 0;
  // Updates stay with an investment or asset account through edits; they mean nothing on any other type.
  if (hasValuations(account.type) && account.valuations?.length) clean.valuations = account.valuations;
  if (account.archived) clean.archived = true;
  if (account.closedOn) clean.closedOn = account.closedOn;
  const saved = { ...setup, accounts: upsert(setup.accounts, clean) };
  // The first loan brings a category for its payments, if the year has none (years from before loans).
  return clean.type === "loan" && !account.id ? withLoanPayments(saved) : saved;
}

/** The transfer category new loans' payments are suggested into. */
export const LOAN_PAYMENTS: Category<TransferRole> = { id: "ct_loan-payments", name: "Loan Payments", role: "loan_payment" };

/** The setup with a loan-payment transfer category. The same object if it already has one. */
export function withLoanPayments(setup: YearSetup): YearSetup {
  const list = setup.categories.transfer;
  if (list.some((c) => c.role === "loan_payment")) return setup;
  const all = new Set([...setup.categories.expense, ...setup.categories.earning, ...list].map((c) => c.id));
  const taken = new Set(list.map((c) => c.name.toLowerCase()));
  let name = LOAN_PAYMENTS.name;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${LOAN_PAYMENTS.name} ${n}`;
  const cat = { ...LOAN_PAYMENTS, id: all.has(LOAN_PAYMENTS.id) ? idFor("ct", name, all) : LOAN_PAYMENTS.id, name };
  return { ...setup, categories: { ...setup.categories, transfer: [...list, cat] } };
}

/**
 * Copy an account, named "<name>_new" ("_new2", "_new3"… if that's taken), right below the
 * original. Everything else is copied as is, opening balance included; the copy is never archived
 * and has no balance updates (it doesn't hold the original's investments).
 * Returns the new setup and the copy's id.
 */
export function duplicateAccount(setup: YearSetup, id: string): { setup: YearSetup; id: string } {
  const at = setup.accounts.findIndex((a) => a.id === id);
  if (at < 0) throw new SetupError("That account no longer exists.");
  const { archived: _a, valuations: _v, closedOn: _c, ...original } = setup.accounts[at]!;
  const taken = new Set(setup.accounts.map((a) => a.name.toLowerCase()));
  let name = `${original.name}_new`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${original.name}_new${n}`;
  const copy: Account = { ...original, id: idFor("a", name, new Set(setup.accounts.map((a) => a.id))), name };
  const accounts = [...setup.accounts.slice(0, at + 1), copy, ...setup.accounts.slice(at + 1)];
  return { setup: { ...setup, accounts }, id: copy.id };
}

export function deleteAccount(setup: YearSetup, id: string, usage: Usage): YearSetup {
  const n = usage.accounts.get(id) ?? 0;
  if (n) throw new SetupError(`This account is used by ${n} ${n === 1 ? "entry" : "entries"}. Hide it instead, so new entries stop offering it.`);
  return { ...setup, accounts: setup.accounts.filter((a) => a.id !== id) };
}

// --- Investment balances ---

/**
 * Note what an investment account is worth on a day. A second update on the same day replaces
 * the first. The day must be in the tracked part of the year.
 */
export function saveValuation(setup: YearSetup, id: string, date: IsoDate, amount: Cents): YearSetup {
  const account = setup.accounts.find((a) => a.id === id);
  if (!account || !hasValuations(account.type)) throw new SetupError("Only investment and asset accounts have a value to update.");
  if (!isDateInYear(date, setup.year)) throw new SetupError(`Pick a day in ${setup.year}.`);
  if (date < yearStart(setup)) throw new SetupError(`Tracking starts on ${shortDate(yearStart(setup))}. Pick that day or later.`);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new SetupError("Enter the balance like 1234.56.");
  if (account.closedOn && date >= account.closedOn) {
    throw new SetupError(`${account.name} was closed on ${shortDate(account.closedOn)}, so it has no value from then on.`);
  }
  const valuations = [...(account.valuations ?? []).filter((v) => v.date !== date), { date, amount }]
    .sort((a, b) => a.date.localeCompare(b.date));
  return { ...setup, accounts: upsert(setup.accounts, { ...account, valuations }) };
}

/** Remove the balance update an investment account has on a day. */
export function deleteValuation(setup: YearSetup, id: string, date: IsoDate): YearSetup {
  const account = setup.accounts.find((a) => a.id === id);
  if (!account) throw new SetupError("That account no longer exists.");
  const { valuations: old = [], ...rest } = account;
  const valuations = old.filter((v) => v.date !== date);
  return { ...setup, accounts: upsert(setup.accounts, valuations.length ? { ...rest, valuations } : rest) };
}

// --- Closing an account ---

/**
 * Close an account on a day: sold, paid off or shut. From that day on it's left out of net
 * worth, and nothing can be entered for it after. An asset or investment is simply
 * worth nothing from then. A bank, cash, card or loan account must be at 0 at the end of that
 * day, or its money would vanish: move it out with a transfer first.
 */
export function closeAccount(
  data: Pick<YearData, "setup" | "expenses" | "earnings" | "transfers">, id: string, date: IsoDate, today = localToday(),
): YearSetup {
  const { setup } = data;
  const account = setup.accounts.find((a) => a.id === id);
  if (!account) throw new SetupError("That account no longer exists.");
  if (!isDateInYear(date, setup.year)) throw new SetupError(`Pick a day in ${setup.year}.`);
  if (date < yearStart(setup)) throw new SetupError(`Tracking starts on ${shortDate(yearStart(setup))}. Pick that day or later.`);
  // Not ahead of time: until the day comes, the account is still open and counts.
  if (date > today) throw new SetupError(`Close it on the day it happens: pick today or earlier.`);
  const later = [
    ...data.expenses.filter((e) => e.account === id), ...data.earnings.filter((e) => e.account === id),
    ...data.transfers.filter((t) => t.from === id || t.to === id),
  ].filter((e) => e.date > date);
  if (later.length) {
    const first = later.reduce((a, b) => (b.date < a.date ? b : a));
    throw new SetupError(`${account.name} has entries after ${shortDate(date)} (the first on ${shortDate(first.date)}). Close it on that day or later, or move them.`);
  }
  if (account.valuations?.some((v) => v.date >= date)) {
    throw new SetupError(`${account.name} has a ${account.type === "asset" ? "value" : "balance"} update on or after ${shortDate(date)}. Delete it first, or close it later.`);
  }
  if (!hasValuations(account.type)) {
    const left = balances(ledgerOf(data), date).get(id) ?? 0;
    if (left !== 0) {
      throw new SetupError(`${account.name} ${leftText(left)} on ${shortDate(date)}. Move it with a transfer first, so it isn't lost from your net worth.`);
    }
  }
  return { ...setup, accounts: upsert(setup.accounts, { ...account, closedOn: date }) };
}

/** "still has $12.00" or "still owes $12.00", for a balance that should be 0. */
function leftText(balance: Cents): string {
  return balance < 0 ? `still owes ${formatCents(-balance)}` : `still has ${formatCents(balance)}`;
}

/**
 * Refuse an entry change that would move a closed bank, cash, card or loan account off the 0 it
 * closed at: its money would be left out of net worth and the next year. Entries after the day it
 * closed are already refused (checkDraft); this covers editing or deleting the ones before.
 */
export function assertClosedStayEmpty(before: Pick<YearData, "setup" | "expenses" | "earnings" | "transfers">,
  after: Pick<YearData, "setup" | "expenses" | "earnings" | "transfers">): void {
  const closed = after.setup.accounts.filter((a) => a.closedOn && !hasValuations(a.type));
  if (!closed.length) return;
  const was = ledgerOf(before), now = ledgerOf(after);
  for (const a of closed) {
    const left = balances(now, a.closedOn).get(a.id) ?? 0;
    if (left !== (balances(was, a.closedOn).get(a.id) ?? 0)) {
      throw new SetupError(`${a.name} was closed on ${shortDate(a.closedOn!)}, and this would mean it ${leftText(left)} then. Reopen it first.`);
    }
  }
}

/** Undo closing an account. */
export function reopenAccount(setup: YearSetup, id: string): YearSetup {
  const account = setup.accounts.find((a) => a.id === id);
  if (!account) throw new SetupError("That account no longer exists.");
  const { closedOn: _c, ...open } = account;
  return { ...setup, accounts: upsert(setup.accounts, open) };
}

// --- Categories ---

const CAT_PREFIX: Record<CategoryKind, string> = { expense: "ce", earning: "ci", transfer: "ct" };

export function saveCategory(
  setup: YearSetup, kind: CategoryKind, cat: { id: string; name: string; role?: string; net?: boolean },
): YearSetup {
  const list = setup.categories[kind] as Category<string>[];
  const name = cleanName(cat.name, "category");
  const all = new Set([...setup.categories.expense, ...setup.categories.earning, ...setup.categories.transfer].map((c) => c.id));
  const id = cat.id || idFor(CAT_PREFIX[kind], name, all);
  assertUniqueName(list, name, id, `${kind} category`);
  const role = cat.role || undefined;
  const allowed: (string | undefined)[] = kind === "expense" ? EXPENSE_ROLES : kind === "earning" ? EARNING_ROLES : TRANSFER_ROLES;
  if (!allowed.includes(role)) {
    throw new SetupError(kind === "expense" ? "Unknown role." : "Pick what this category is for, so reports can count it.");
  }
  const clean: Category<string> = role ? { id, name, role } : { id, name };
  // Only paycheck and income categories can be left out of net earnings; "true" is the default, so only false is kept.
  if (kind === "earning" && (role === "paycheck" || role === "income") && cat.net === false) clean.net = false;
  return { ...setup, categories: { ...setup.categories, [kind]: upsert(list, clean) } };
}

/**
 * Where a deleted category's entries go: one per kind, always there, never deleted.
 * Its roles keep moved entries out of the headline figures: not paychecks, not in net
 * earnings, not savings or investing.
 */
export const UNCATEGORIZED: { [K in CategoryKind]: Categories[K][number] } = {
  expense: { id: "ce_uncategorized", name: "Uncategorized" },
  earning: { id: "ci_uncategorized", name: "Uncategorized", role: "income", net: false },
  transfer: { id: "ct_uncategorized", name: "Uncategorized", role: "general" },
};

/** The id of a kind's Uncategorized category: ours, or one the user already had by that name. */
export function uncategorizedId(setup: Pick<YearSetup, "categories">, kind: CategoryKind): string | undefined {
  const list = setup.categories[kind] as Category<string>[];
  const name = UNCATEGORIZED[kind].name.toLowerCase();
  return (list.find((c) => c.id === UNCATEGORIZED[kind].id) ?? list.find((c) => c.name.toLowerCase() === name))?.id;
}

/** The setup with an Uncategorized category in every kind. The same object if nothing was missing. */
export function withUncategorized(setup: YearSetup): YearSetup {
  const missing = (["expense", "earning", "transfer"] as CategoryKind[]).filter((k) => !uncategorizedId(setup, k));
  if (!missing.length) return setup;
  const categories = { ...setup.categories };
  for (const k of missing) (categories[k] as Category<string>[]) = [...categories[k], UNCATEGORIZED[k]];
  return { ...setup, categories };
}

/** A change to a year: its new setup, and only the entries that changed (any list can be left out). */
export interface YearChange {
  setup: YearSetup;
  expenses?: Expense[];
  earnings?: Earning[];
  transfers?: Transfer[];
}

/** The year with a change applied: the new setup, and changed entries swapped in by id. */
export function withChange(data: YearData, change: YearChange): YearData {
  const swap = <T extends { id: string }>(list: T[], changed: T[] = []) => {
    const byId = new Map(changed.map((x) => [x.id, x]));
    return byId.size ? list.map((x) => byId.get(x.id) ?? x) : list;
  };
  return {
    setup: change.setup,
    expenses: swap(data.expenses, change.expenses),
    earnings: swap(data.earnings, change.earnings),
    transfers: swap(data.transfers, change.transfers),
  };
}

/**
 * Delete a category. Entries that used it move to the kind's Uncategorized category, and so
 * do refunds aimed at a deleted expense category. Uncategorized itself can't be deleted.
 */
export function deleteCategory(
  data: { setup: YearSetup; expenses: Expense[]; earnings: Earning[]; transfers: Transfer[] }, kind: CategoryKind, id: string,
): Required<YearChange> {
  const withFallback = withUncategorized(data.setup);
  const to = uncategorizedId(withFallback, kind)!;
  if (id === to) throw new SetupError("Uncategorized can't be deleted: entries from deleted categories go there.");
  const list = (withFallback.categories[kind] as Category<string>[]).filter((c) => c.id !== id);
  // Drop its budget targets too, so the file stays valid.
  const budgets = Object.fromEntries(Object.entries(withFallback.budgets).map(([k, targets]) => {
    const { [id]: _gone, ...rest } = targets;
    return [k, rest];
  })) as YearSetup["budgets"];
  return {
    setup: { ...withFallback, categories: { ...withFallback.categories, [kind]: list }, budgets },
    expenses: kind === "expense" ? data.expenses.filter((e) => e.cat === id).map((e) => ({ ...e, cat: to })) : [],
    earnings: kind === "earning"
      ? data.earnings.filter((i) => i.cat === id).map((i) => ({ ...i, cat: to }))
      : kind === "expense" ? data.earnings.filter((i) => i.offsets === id).map((i) => ({ ...i, offsets: to })) : [],
    transfers: kind === "transfer" ? data.transfers.filter((t) => t.cat === id).map((t) => ({ ...t, cat: to })) : [],
  };
}

// --- Tags ---

export function saveTag(setup: YearSetup, tag: Tag): YearSetup {
  const name = cleanName(tag.name, "tag");
  const id = tag.id || idFor("t", name, new Set(setup.tags.map((t) => t.id)));
  assertUniqueName(setup.tags, name, id, "tag");
  const tags = upsert(setup.tags, { id, name }).sort((a, b) => a.name.localeCompare(b.name));
  return { ...setup, tags };
}

/** Delete a tag, taking it off every expense that has it. Returns the new setup and the expenses that changed. */
export function deleteTag(
  data: { setup: YearSetup; expenses: Expense[] }, id: string,
): { setup: YearSetup; expenses: Expense[] } {
  return {
    setup: { ...data.setup, tags: data.setup.tags.filter((t) => t.id !== id) },
    expenses: data.expenses.filter((e) => e.tags.includes(id)).map((e) => ({ ...e, tags: e.tags.filter((t) => t !== id) })),
  };
}

// --- Members (the household) ---

/** How many entries a member has. */
export function memberUses(setup: Pick<YearSetup, "members">, usage: Usage, id: string): number {
  return (usage.members.get(id) ?? 0) + (id === membersOf(setup)[0]!.id ? usage.members.get("") ?? 0 : 0);
}

/** Add or rename a member. Pass id "" to add one. */
export function saveMember(setup: YearSetup, member: Member): YearSetup {
  const members = membersOf(setup);
  const name = cleanName(member.name, "person");
  const id = member.id || idFor("m", name, new Set(members.map((m) => m.id)));
  assertUniqueName(members, name, id, "person");
  return { ...setup, members: upsert(members, { id, name }) };
}

/**
 * Remove a member; their entries go back to the default (first) member. The default can't
 * be removed. Returns the new setup and the entries that changed.
 */
export function deleteMember(
  data: { setup: YearSetup; expenses: Expense[]; earnings: Earning[]; transfers: Transfer[] }, id: string,
): { setup: YearSetup; expenses: Expense[]; earnings: Earning[]; transfers: Transfer[] } {
  const members = membersOf(data.setup);
  if (members[0]!.id === id) throw new SetupError(`${members[0]!.name} is the default person and can't be deleted. Rename them instead.`);
  const back = <T extends { member?: string }>(list: T[]) =>
    list.filter((e) => e.member === id).map(({ member: _m, ...e }) => e as T);
  return {
    setup: { ...data.setup, members: members.filter((m) => m.id !== id) },
    expenses: back(data.expenses),
    earnings: back(data.earnings),
    transfers: back(data.transfers),
  };
}

// --- Years saved by earlier versions ---

/**
 * Older years could hold people, shares of expenses they owed, who paid back, and a
 * "Paid back" (reimbursement) earning role. Drop the people and those fields; a reimbursement
 * category becomes "Lowers spending", which is how money paid back now counts.
 * They could also have a "Loan payment" expense role, from before loan payments were transfers:
 * those categories become regular spending.
 * Returns the cleaned setup and the entries that changed, or null if there was nothing to do.
 */
export function withoutPeople(
  data: { setup: YearSetup; expenses: Expense[]; earnings: Earning[] },
): { setup: YearSetup; expenses: Expense[]; earnings: Earning[] } | null {
  const { people, ...setup } = data.setup as YearSetup & { people?: unknown };
  const earning = setup.categories.earning.map((c) =>
    (c.role as string) === "reimbursement" ? { ...c, role: "offset" as const } : c);
  const expense = setup.categories.expense.map((c) => {
    if ((c.role as string) !== "loan") return c;
    const { role: _loan, ...regular } = c;
    return regular;
  });
  const expenses = data.expenses.filter((e) => "owed" in e).map(({ owed: _o, ...e }: Expense & { owed?: unknown }) => e);
  const earnings = data.earnings.filter((i) => "person" in i).map(({ person: _p, ...i }: Earning & { person?: unknown }) => i);
  const roleChanged = earning.some((c, n) => c !== setup.categories.earning[n])
    || expense.some((c, n) => c !== setup.categories.expense[n]);
  if (people === undefined && !roleChanged && !expenses.length && !earnings.length) return null;
  return { setup: { ...setup, categories: { ...setup.categories, expense, earning } }, expenses, earnings };
}

// --- Start date ---

/**
 * Move the day the year's tracking starts. Null (or January 1) means the whole year, which
 * also drops any IRA contributions noted as made before the start.
 * It can't move past an entry that already exists: the opening balances would then
 * include that entry, and it would count twice.
 */
export function withStart(data: Pick<YearData, "setup" | "expenses" | "earnings" | "transfers">, start: IsoDate | null): YearSetup {
  const { start: _old, ...setup } = data.setup;
  if (start === null || start === `${setup.year}-01-01`) {
    // From January 1 the whole year is in the ledger, so nothing came "before the start".
    const { iraBeforeStart: _before, ...whole } = setup;
    return { ...whole, accounts: loansFrom(data, `${setup.year}-01-01`) };
  }
  if (!isDateInYear(start, setup.year)) throw new SetupError(`Pick a day in ${setup.year}.`);
  const first = [...data.expenses, ...data.earnings, ...data.transfers].reduce<string | null>(
    (min, e) => (min === null || e.date < min ? e.date : min), null);
  if (first !== null && first < start) {
    throw new SetupError(`There are entries from ${shortDate(first)}, so tracking can't start later than that. Move or delete them first.`);
  }
  const shut = setup.accounts.find((a) => a.closedOn && a.closedOn < start);
  if (shut) throw new SetupError(`${shut.name} was closed on ${shortDate(shut.closedOn!)}, so tracking can't start later than that. Reopen it first.`);
  const early = setup.accounts.find((a) => a.type === "investment" && a.valuations?.some((v) => v.date < start));
  if (early) {
    throw new SetupError(`${early.name} has a balance update from before ${shortDate(start)}, so tracking can't start that late. Delete it first.`);
  }
  return { ...setup, start, accounts: assetsFrom(loansFrom(data, start), start) };
}

/**
 * The accounts with each asset's values moved to a new start day: one that had a value before
 * it is worth that on the start day (its latest one), and the earlier ones go. An asset's value
 * seldom changes, so moving the start shouldn't lose it.
 */
function assetsFrom(accounts: Account[], start: IsoDate): Account[] {
  return accounts.map((a) => {
    if (a.type !== "asset" || !a.valuations?.some((v) => v.date < start)) return a;
    const later = a.valuations.filter((v) => v.date >= start);
    // Nothing to carry if it already has a value that day, or closes that very day.
    const carried = later.some((v) => v.date === start) || (a.closedOn !== undefined && a.closedOn <= start)
      ? [] : [{ date: start, amount: valuationOf(a, start)!.amount }];
    return { ...a, valuations: [...carried, ...later] };
  });
}

/**
 * The accounts with each loan's opening moved to a new start day. A loan that now begins on or
 * after it opens at 0. One that now began before it opens at what it owed that morning: nothing
 * is in the ledger before the new start, so moving later adds the amount and interest since, and
 * moving earlier takes off the interest added between the two days (to the nearest cent: each
 * month's interest was rounded).
 */
function loansFrom(data: Pick<YearData, "setup" | "expenses" | "earnings" | "transfers">, start: IsoDate): Account[] {
  const { setup } = data;
  const old = ledgerOf(data);
  return setup.accounts.map((a) => {
    if (a.type !== "loan" || !a.loanStart) return a;
    if (a.loanStart >= start) return { ...a, opening: 0 };
    const was = yearStart(setup);
    if (start > was) return { ...a, opening: loanStatus(old, a, dayBefore(start)).balance };
    // Interest was only added while something was owed.
    if (start === was || !a.rate || a.opening >= 0) return a;
    // Undo each month's interest the opening already included.
    let owed = -a.opening;
    for (let n = loanDueDates(a.loanStart, start, dayBefore(was)).length; n > 0; n--) owed = Math.round(owed / (1 + a.rate / 1200));
    return { ...a, opening: -owed };
  });
}

// --- IRA limit ---

/** The IRS annual IRA contribution limit (under 50), by year. Update it when the IRS announces a new one. */
export const IRA_LIMITS: Record<number, Cents> = { 2024: 700000, 2025: 700000, 2026: 750000 };

/** The year's IRA limit: the one set for it, or else the IRS limit for that year (the nearest listed one). */
export function iraLimitOf(setup: Pick<YearSetup, "year" | "iraLimit">): Cents {
  if (setup.iraLimit !== undefined) return setup.iraLimit;
  const listed = Object.keys(IRA_LIMITS).map(Number).sort((a, b) => a - b);
  const year = listed.filter((y) => y <= setup.year).pop() ?? listed[0]!;
  return IRA_LIMITS[year]!;
}

// --- A year from scratch ---

/** A new year with the standard categories and no accounts yet. */
export function blankSetup(year: number): YearSetup {
  // [name, role?, net?]: "Other" starts outside net earnings, since it's usually one-offs.
  const cats = <R extends string>(prefix: string, list: [string, R?, boolean?][]): Category<R>[] =>
    list.map(([name, role, net]) => ({
      id: `${prefix}_${slug(name)}`, name, ...(role ? { role } : {}), ...(net === false ? { net: false } : {}),
    }));
  return withUncategorized({
    year,
    accounts: [],
    categories: {
      expense: cats<ExpenseRole>("ce", [
        ["Bills"], ["Charity", "charity"], ["Food & Drinks"], ["Health & Wellness"], ["Housing"],
        ["Personal Care & Activities"], ["Shopping"], ["Transfer to external account"], ["Transport"],
      ]),
      earning: cats<EarningRole>("ci", [
        ["Paycheck", "paycheck"], ["Interest", "income"], ["Tax Refund", "income"], ["Other", "income", false],
        ["Refunds", "offset"], ["Redeemed CC Points", "offset"], ["Paid back", "offset"],
      ]),
      transfer: cats<TransferRole>("ct", [
        ["Payment to CC", "cc_payment"], ["Savings", "savings_in"], ["Savings Takeout", "savings_out"],
        ["Investment - IRA", "invest_retirement"], ["Investment - Stocks & Cryptos", "invest_taxable"],
        ["Cash Withdraw", "cash_withdrawal"], ["Loan Payments", "loan_payment"], ["General Transfer", "general"],
      ]),
    },
    tags: [],
    budgets: { default: {} },
  });
}
