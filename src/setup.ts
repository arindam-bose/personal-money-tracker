// Editing a year's setup: accounts, categories, tags and people. Each function checks
// the change and returns a new setup, or throws a SetupError with a message for the user.
// Everything refers to these by id, so renaming never touches a single entry.

import type { YearData } from "./db";
import { newId, slug } from "./entries";
import type {
  Account, Category, EarningRole, ExpenseRole, Person, Tag, TransferRole, YearSetup,
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

export function deleteAccount(setup: YearSetup, id: string, usage: Usage): YearSetup {
  const n = usage.accounts.get(id) ?? 0;
  if (n) throw new SetupError(`This account is used by ${n} ${n === 1 ? "entry" : "entries"}. Archive it instead, to hide it from new entries.`);
  return { ...setup, accounts: setup.accounts.filter((a) => a.id !== id) };
}

// --- Categories ---

const CAT_PREFIX: Record<CategoryKind, string> = { expense: "ce", earning: "ci", transfer: "ct" };

export function saveCategory(setup: YearSetup, kind: CategoryKind, cat: { id: string; name: string; role?: string }): YearSetup {
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
  return { ...setup, categories: { ...setup.categories, [kind]: upsert(list, clean) } };
}

export function deleteCategory(setup: YearSetup, kind: CategoryKind, id: string, usage: Usage): YearSetup {
  const n = usage.categories.get(id) ?? 0;
  if (n) throw new SetupError(`This category is used by ${n} ${n === 1 ? "entry" : "entries"}. Rename it instead, or move those entries first.`);
  const list = (setup.categories[kind] as Category<string>[]).filter((c) => c.id !== id);
  // Drop its budget targets too, so the file stays valid.
  const budgets = Object.fromEntries(Object.entries(setup.budgets).map(([k, targets]) => {
    const { [id]: _gone, ...rest } = targets;
    return [k, rest];
  })) as YearSetup["budgets"];
  return { ...setup, categories: { ...setup.categories, [kind]: list }, budgets };
}

// --- Tags and people ---

export function saveTag(setup: YearSetup, tag: Tag): YearSetup {
  const name = cleanName(tag.name, "tag");
  const id = tag.id || idFor("t", name, new Set(setup.tags.map((t) => t.id)));
  assertUniqueName(setup.tags, name, id, "tag");
  const tags = upsert(setup.tags, { id, name }).sort((a, b) => a.name.localeCompare(b.name));
  return { ...setup, tags };
}

export function deleteTag(setup: YearSetup, id: string, usage: Usage): YearSetup {
  const n = usage.tags.get(id) ?? 0;
  if (n) throw new SetupError(`This tag is on ${n} ${n === 1 ? "entry" : "entries"}. Remove it from them first, or rename it.`);
  return { ...setup, tags: setup.tags.filter((t) => t.id !== id) };
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
  const cats = <R extends string>(prefix: string, list: [string, R?][]): Category<R>[] =>
    list.map(([name, role]) => (role ? { id: `${prefix}_${slug(name)}`, name, role } : { id: `${prefix}_${slug(name)}`, name }));
  return {
    year,
    accounts: [],
    categories: {
      expense: cats<ExpenseRole>("ce", [
        ["Bills"], ["Charity", "charity"], ["Food & Drinks"], ["Health & Wellness"], ["Housing"], ["Loan", "loan"],
        ["Personal Care & Activities"], ["Shopping"], ["Transfer to external account"], ["Transport"],
      ]),
      earning: cats<EarningRole>("ci", [
        ["Paycheck", "paycheck"], ["Interest", "income"], ["Tax Refund", "income"], ["Other", "income"],
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
  };
}
