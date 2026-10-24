// Editing a year's setup: accounts, categories, tags and people. Each function checks
// the change and returns a new setup, or throws a SetupError with a message for the user.
// Everything refers to these by id, so renaming never touches a single entry.

import type { YearData } from "./db";
import { newId, slug } from "./entries";
import type {
  Account, Categories, Category, Earning, EarningRole, Expense, ExpenseRole, Person, Tag, Transfer, TransferRole, YearSetup,
} from "./types";

export class SetupError extends Error {}

export type CategoryKind = "expense" | "earning" | "transfer";

/** How many entries use each account, category, tag and person. Used to block unsafe deletes. */
export interface Usage {
  accounts: Map<string, number>;
  categories: Map<string, number>;
  tags: Map<string, number>;
  people: Map<string, number>;
}

export function usageOf(data: Pick<YearData, "expenses" | "earnings" | "transfers">): Usage {
  const u: Usage = { accounts: new Map(), categories: new Map(), tags: new Map(), people: new Map() };
  const add = (m: Map<string, number>, id: string | null | undefined) => {
    if (id) m.set(id, (m.get(id) ?? 0) + 1);
  };
  for (const e of data.expenses) {
    add(u.accounts, e.account);
    add(u.categories, e.cat);
    e.tags.forEach((t) => add(u.tags, t));
    add(u.people, e.owed?.person);
  }
  for (const i of data.earnings) {
    add(u.accounts, i.account);
    add(u.categories, i.cat);
    add(u.categories, i.offsets); // a refund aimed at a spending category uses it too
    add(u.people, i.person);
  }
  for (const t of data.transfers) {
    add(u.accounts, t.from);
    add(u.accounts, t.to);
    add(u.categories, t.cat);
  }
  return u;
}

const EXPENSE_ROLES: (ExpenseRole | undefined)[] = [undefined, "charity", "loan"];
const EARNING_ROLES: EarningRole[] = ["paycheck", "income", "offset", "reimbursement"];
const TRANSFER_ROLES: TransferRole[] = [
  "cc_payment", "savings_in", "savings_out", "invest_retirement", "invest_taxable", "cash_withdrawal", "general",
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

/** Add or update an account. Pass an account without an id (id: "") to add one. */
export function saveAccount(setup: YearSetup, account: Account): YearSetup {
  const name = cleanName(account.name, "account");
  const id = account.id || idFor("a", name, new Set(setup.accounts.map((a) => a.id)));
  assertUniqueName(setup.accounts, name, id, "account");
  if (!Number.isSafeInteger(account.opening)) throw new SetupError("The opening balance must be an amount like 1234.56.");
  const clean: Account = { id, name, type: account.type, ref: account.ref.trim(), opening: account.opening };
  if (account.type === "credit") {
    if (account.limit === undefined || !Number.isSafeInteger(account.limit) || account.limit < 0) {
      throw new SetupError("A credit card needs a credit limit.");
    }
    clean.limit = account.limit;
  }
  if (account.archived) clean.archived = true;
  return { ...setup, accounts: upsert(setup.accounts, clean) };
}

/**
 * Copy an account, named "<name>_new" ("_new2", "_new3"… if that's taken), right below the
 * original. Everything else is copied as is, opening balance included; the copy is never archived.
 * Returns the new setup and the copy's id.
 */
export function duplicateAccount(setup: YearSetup, id: string): { setup: YearSetup; id: string } {
  const at = setup.accounts.findIndex((a) => a.id === id);
  if (at < 0) throw new SetupError("That account no longer exists.");
  const { archived: _a, ...original } = setup.accounts[at]!;
  const taken = new Set(setup.accounts.map((a) => a.name.toLowerCase()));
  let name = `${original.name}_new`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${original.name}_new${n}`;
  const copy: Account = { ...original, id: idFor("a", name, new Set(setup.accounts.map((a) => a.id))), name };
  const accounts = [...setup.accounts.slice(0, at + 1), copy, ...setup.accounts.slice(at + 1)];
  return { setup: { ...setup, accounts }, id: copy.id };
}

export function deleteAccount(setup: YearSetup, id: string, usage: Usage): YearSetup {
  const n = usage.accounts.get(id) ?? 0;
  if (n) throw new SetupError(`This account is used by ${n} ${n === 1 ? "entry" : "entries"}. Archive it instead, to hide it from new entries.`);
  return { ...setup, accounts: setup.accounts.filter((a) => a.id !== id) };
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
export function uncategorizedId(setup: YearSetup, kind: CategoryKind): string | undefined {
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

/** What deleting a category changes: the new setup, and the entries that moved (only those). */
export interface CategoryRemoval {
  setup: YearSetup;
  expenses: Expense[];
  earnings: Earning[];
  transfers: Transfer[];
}

/**
 * Delete a category. Entries that used it move to the kind's Uncategorized category, and so
 * do refunds aimed at a deleted expense category. Uncategorized itself can't be deleted.
 */
export function deleteCategory(
  data: { setup: YearSetup; expenses: Expense[]; earnings: Earning[]; transfers: Transfer[] }, kind: CategoryKind, id: string,
): CategoryRemoval {
  const withFallback = withUncategorized(data.setup);
  const to = uncategorizedId(withFallback, kind)!;
  if (id === to) throw new SetupError("Uncategorized can't be deleted: entries from deleted categories go there.");
  const list = (withFallback.categories[kind] as Category<string>[]).filter((c) => c.id !== id);
  const setup = withFallback;
  // Drop its budget targets too, so the file stays valid.
  const budgets = Object.fromEntries(Object.entries(setup.budgets).map(([k, targets]) => {
    const { [id]: _gone, ...rest } = targets;
    return [k, rest];
  })) as YearSetup["budgets"];
  return {
    setup: { ...setup, categories: { ...setup.categories, [kind]: list }, budgets },
    expenses: kind === "expense" ? data.expenses.filter((e) => e.cat === id).map((e) => ({ ...e, cat: to })) : [],
    earnings: kind === "earning"
      ? data.earnings.filter((i) => i.cat === id).map((i) => ({ ...i, cat: to }))
      : kind === "expense" ? data.earnings.filter((i) => i.offsets === id).map((i) => ({ ...i, offsets: to })) : [],
    transfers: kind === "transfer" ? data.transfers.filter((t) => t.cat === id).map((t) => ({ ...t, cat: to })) : [],
  };
}

// --- Tags and people ---

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

export function savePerson(setup: YearSetup, person: Person): YearSetup {
  const people = setup.people ?? [];
  const name = cleanName(person.name, "person");
  const id = person.id || idFor("p", name, new Set(people.map((p) => p.id)));
  assertUniqueName(people, name, id, "person");
  return { ...setup, people: upsert(people, { id, name }) };
}

export function deletePerson(setup: YearSetup, id: string, usage: Usage): YearSetup {
  const n = usage.people.get(id) ?? 0;
  if (n) throw new SetupError(`This person is on ${n} ${n === 1 ? "entry" : "entries"}. Rename them instead.`);
  return { ...setup, people: (setup.people ?? []).filter((p) => p.id !== id) };
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
        ["Bills"], ["Charity", "charity"], ["Food & Drinks"], ["Health & Wellness"], ["Housing"], ["Loan", "loan"],
        ["Personal Care & Activities"], ["Shopping"], ["Transfer to external account"], ["Transport"],
      ]),
      earning: cats<EarningRole>("ci", [
        ["Paycheck", "paycheck"], ["Interest", "income"], ["Tax Refund", "income"], ["Other", "income", false],
        ["Refunds", "offset"], ["Redeemed CC Points", "offset"], ["Paid back", "reimbursement"],
      ]),
      transfer: cats<TransferRole>("ct", [
        ["Payment to CC", "cc_payment"], ["Savings", "savings_in"], ["Savings Takeout", "savings_out"],
        ["Investment - IRA", "invest_retirement"], ["Investment - Stocks & Cryptos", "invest_taxable"],
        ["Cash Withdraw", "cash_withdrawal"], ["General Transfer", "general"],
      ]),
    },
    tags: [],
    people: [],
    budgets: { default: {} },
  });
}
