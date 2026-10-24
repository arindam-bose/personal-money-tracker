// The logic behind the entry form, kept apart from the UI so it can be tested:
// drafts (what the form holds), validation, and the transfer-category suggestion.

import { membersOf } from "./members";
import { formatCents, parseCents } from "./money";
import type {
  Account, Earning, EarningRole, Expense, Transfer, TransferRole, YearSetup,
} from "./types";
import { isDateInYear } from "./validate";

export type Kind = "expense" | "earning" | "transfer";

/** Store name for each kind, as used by db.ts. */
export const STORE = { expense: "expenses", earning: "earnings", transfer: "transfers" } as const;

export type EntryOf<K extends Kind> = K extends "expense" ? Expense : K extends "earning" ? Earning : Transfer;
export type AnyEntry = { kind: "expense"; entry: Expense } | { kind: "earning"; entry: Earning } | { kind: "transfer"; entry: Transfer };

/**
 * What the form holds while you type. Every field is text (or a list of ids), exactly as
 * entered; it only becomes an Expense/Earning/Transfer once it passes validation.
 * One draft covers all three kinds, so switching kind keeps what you've typed.
 */
export interface Draft {
  kind: Kind;
  /** Set when editing an existing entry. */
  id?: string;
  date: string;
  item: string;
  amount: string;
  notes: string;
  /** Expense and earning: the account debited or credited. */
  account: string;
  /** Transfer accounts. */
  from: string;
  to: string;
  /** Category id for the current kind. */
  cat: string;
  /** Expense: tag ids. */
  tags: string[];
  /** Earning with an offset role: expense category it reduces, "" for total spending. */
  offsets: string;
  /** Member id; "" for the default (first) member. */
  member: string;
}

export type DraftField = keyof Draft;
export type DraftErrors = Partial<Record<DraftField, string>>;

export function emptyDraft(kind: Kind, date: string): Draft {
  return {
    kind, date, item: "", amount: "", notes: "",
    account: "", from: "", to: "", cat: "", tags: [],
    offsets: "", member: "",
  };
}

/** Amount as the form shows it: 1234 -> "12.34". */
function amountText(cents: number): string {
  return formatCents(cents).replace(/[$,]/g, "");
}

/** Fill a draft from an existing entry, for editing. */
export function draftFrom(e: AnyEntry): Draft {
  const base = {
    ...emptyDraft(e.kind, e.entry.date), id: e.entry.id, item: e.entry.item, amount: amountText(e.entry.amount),
    notes: e.entry.notes, cat: e.entry.cat, member: e.entry.member ?? "",
  };
  switch (e.kind) {
    case "expense":
      return { ...base, account: e.entry.account, tags: [...e.entry.tags] };
    case "earning":
      return { ...base, account: e.entry.account, offsets: e.entry.offsets ?? "" };
    case "transfer":
      return { ...base, from: e.entry.from, to: e.entry.to };
  }
}

/** The role of the draft's earning category, if it is an earning. */
export function earningRole(draft: Draft, setup: YearSetup): EarningRole | undefined {
  return draft.kind === "earning" ? setup.categories.earning.find((c) => c.id === draft.cat)?.role : undefined;
}

export type CheckResult = { ok: true; entry: AnyEntry } | { ok: false; errors: DraftErrors };

/**
 * Check a draft against the year's setup and turn it into an entry.
 * `id` is used for a new entry; an edited one keeps its own.
 */
export function checkDraft(draft: Draft, setup: YearSetup, id: string): CheckResult {
  const errors: DraftErrors = {};
  const accounts = new Map(setup.accounts.map((a) => [a.id, a]));
  const usable = (accountId: string) => {
    const a = accounts.get(accountId);
    // An archived account can stay on old entries, but new entries can't use it.
    return !!a && (!a.archived || draft.id !== undefined);
  };

  if (!isDateInYear(draft.date, setup.year)) errors.date = `Pick a date in ${setup.year}.`;
  const item = draft.item.trim();
  if (!item) errors.item = "Say what it was.";
  const amount = parseCents(draft.amount);
  if (amount === null) errors.amount = "Enter an amount like 12.34.";
  else if (amount === 0) errors.amount = "The amount must be more than $0.";

  const cats = setup.categories[draft.kind] as { id: string }[];
  if (!cats.some((c) => c.id === draft.cat)) errors.cat = "Pick a category.";

  // Keys in the same order as the importer writes them, so backup files diff cleanly.
  const head = { id: draft.id ?? id, date: draft.date, item, amount: amount ?? 0 };
  const notes = draft.notes.trim();
  // Only someone other than the default (first) member is written down.
  const members = membersOf(setup);
  if (draft.member && !members.some((m) => m.id === draft.member)) errors.member = "Pick someone from the list.";
  const owner = draft.member && draft.member !== members[0]!.id ? { member: draft.member } : {};

  if (draft.kind === "transfer") {
    if (!usable(draft.from)) errors.from = "Pick the account the money left.";
    if (!usable(draft.to)) errors.to = "Pick the account the money went to.";
    else if (draft.from === draft.to) errors.to = "Pick a different account from the one it left.";
    return Object.keys(errors).length
      ? { ok: false, errors }
      : { ok: true, entry: { kind: "transfer", entry: { ...head, from: draft.from, to: draft.to, cat: draft.cat, notes, ...owner } } };
  }

  if (!usable(draft.account)) errors.account = "Pick an account.";

  if (draft.kind === "expense") {
    const tagIds = new Set(setup.tags.map((t) => t.id));
    if (draft.tags.some((t) => !tagIds.has(t))) errors.tags = "One of the tags no longer exists.";
    if (Object.keys(errors).length) return { ok: false, errors };
    const entry: Expense = { ...head, account: draft.account, cat: draft.cat, tags: [...new Set(draft.tags)], notes, ...owner };
    return { ok: true, entry: { kind: "expense", entry } };
  }

  const role = earningRole(draft, setup);
  const entry: Earning = { ...head, account: draft.account, cat: draft.cat, notes };
  if (role === "offset") {
    if (draft.offsets && !setup.categories.expense.some((c) => c.id === draft.offsets)) errors.offsets = "Pick a spending category.";
    entry.offsets = draft.offsets || null;
  }
  Object.assign(entry, owner);
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, entry: { kind: "earning", entry } };
}

/**
 * Suggest a transfer category from the two accounts' types (brief §3):
 * checking → savings is Savings, savings → checking is Savings Takeout,
 * bank → card is Payment to CC, bank → cash is Cash Withdraw, → investment is an investment.
 * Returns a category id, or null if nothing fits.
 */
export function suggestTransferCategory(from: Account | undefined, to: Account | undefined, setup: YearSetup): string | null {
  if (!from || !to) return null;
  const bank = (a: Account) => a.type === "checking" || a.type === "savings";
  let want: TransferRole[] = [];
  if (to.type === "investment") want = ["invest_retirement", "invest_taxable"];
  else if (from.type === "checking" && to.type === "savings") want = ["savings_in"];
  else if (from.type === "savings" && to.type === "checking") want = ["savings_out"];
  else if (bank(from) && to.type === "credit") want = ["cc_payment"];
  else if (bank(from) && to.type === "cash") want = ["cash_withdrawal"];
  else want = ["general"];
  for (const role of want) {
    const c = setup.categories.transfer.find((c) => c.role === role);
    if (c) return c.id;
  }
  return null;
}

/**
 * A new id like "e_mh2k9x1c3f9a" that isn't already taken: the time it was made
 * (base 36), then random characters. Ids made later sort later, so the ledger can
 * show the newest entry first within a day.
 */
export function newId(prefix: string, taken: (id: string) => boolean, now = Date.now()): string {
  for (;;) {
    const id = `${prefix}_${now.toString(36)}${crypto.randomUUID().slice(0, 4)}`;
    if (!taken(id)) return id;
  }
}

/** Id prefix per kind, matching the imported ids (e0001, i0001, x0001). */
export const ID_PREFIX: Record<Kind, string> = { expense: "e", earning: "i", transfer: "x" };

/** "Movies/Shows" -> "movies-shows", for ids made from names. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Added to the item of a duplicated entry: "Transfer to savings" -> "Transfer to savings-new". */
export const DUPLICATE_SUFFIX = "-new";

/**
 * A copy of an entry under a new id, with every value the same except the item, which
 * gets DUPLICATE_SUFFIX so the copy is easy to spot and rename. Tags are copied too,
 * not shared with the original.
 */
export function duplicateEntry(e: AnyEntry, id: string): AnyEntry {
  const item = e.entry.item + DUPLICATE_SUFFIX;
  switch (e.kind) {
    case "expense":
      return { kind: "expense", entry: { ...e.entry, id, item, tags: [...e.entry.tags] } };
    case "earning":
      return { kind: "earning", entry: { ...e.entry, id, item } };
    case "transfer":
      return { kind: "transfer", entry: { ...e.entry, id, item } };
  }
}
