// App-wide reactive state. Components read these signals and re-render when they change.
// Every change goes through the actions below: they write to IndexedDB first, then
// update the signal, so what you see is always what is stored.

import { computed, signal } from "@preact/signals";
import { deleteEntry, deleteYear, eraseAll, getSetting, listYears, loadYear, putEntry, putSetup, putSetupAndEntries, replaceYear, setSetting, type YearData } from "./db";
import type { Ledger } from "./derive";
import { ID_PREFIX, STORE, duplicateEntry, newId, slug, type AnyEntry, type Kind } from "./entries";
import { emptyYearFile, nextYearSetup } from "./rollover";
import { blankSetup, deleteCategory, iraLimitOf, deleteMember, deleteTag, usageOf, withChange, withStart, withUncategorized, withoutPeople, type YearChange, type CategoryKind, type Usage } from "./setup";
import type { PersistState } from "./storage";
import type { YearSetup } from "./types";

export interface YearSummary {
  setup: YearSetup;
  expenses: number;
  earnings: number;
  transfers: number;
}

/** Every stored year with its entry counts, newest first. */
export const years = signal<YearSummary[]>([]);

export const persistState = signal<PersistState | null>(null);

/** The year being viewed and edited, fully loaded. Null until one is imported. */
export const current = signal<YearData | null>(null);

/** A closed year can be looked at but not changed. */
export const readOnly = computed(() => current.value?.setup.closed === true);

/** The open year in the shape the calculations in derive.ts take. */
export const ledger = computed<Ledger | null>(() => {
  const d = current.value;
  return d && { ...d, accounts: d.setup.accounts, categories: d.setup.categories };
});

/** The open year's IRA contribution limit. Change it on the Settings page. */
export const iraLimit = computed(() => (current.value ? iraLimitOf(current.value.setup) : 0));

const MEMBER_VIEW_KEY = "member-view";

/**
 * Whose figures the Dashboard and Reports show: "" for everyone, or a member id.
 * Lasts until the tab is closed, like the ledger filters.
 */
export const memberView = signal<string>((() => {
  try {
    return sessionStorage.getItem(MEMBER_VIEW_KEY) ?? "";
  } catch {
    return "";
  }
})());

export function setMemberView(id: string): void {
  memberView.value = id;
  try {
    sessionStorage.setItem(MEMBER_VIEW_KEY, id);
  } catch {
    // Not kept; the choice still applies until the page reloads.
  }
}
export const pinnedTags = signal<string[]>([]);

export async function loadSettings(): Promise<void> {
  pinnedTags.value = (await getSetting("pinnedTags")) ?? [];
}

/** Set what went into IRAs before the open year's tracking started. Null clears it. */
export function saveIraBeforeStart(cents: number | null): Promise<void> {
  return inTurn(async () => {
    const { iraBeforeStart: _old, ...setup } = editable().setup;
    await saveSetup(cents === null || cents === 0 ? setup : { ...setup, iraBeforeStart: cents });
  });
}

/** Set the open year's IRA limit. Null goes back to the IRS limit for the year. */
export function saveIraLimit(cents: number | null): Promise<void> {
  return inTurn(async () => {
    const { iraLimit: _old, ...setup } = editable().setup;
    await saveSetup(cents === null ? setup : { ...setup, iraLimit: cents });
  });
}

export async function savePinnedTags(ids: string[]): Promise<void> {
  await setSetting("pinnedTags", ids);
  pinnedTags.value = ids;
}

export async function refreshYears(): Promise<void> {
  const setups = await listYears();
  const summaries = await Promise.all(
    setups.map(async (setup) => {
      const data = await loadYear(setup.year);
      return {
        setup,
        expenses: data?.expenses.length ?? 0,
        earnings: data?.earnings.length ?? 0,
        transfers: data?.transfers.length ?? 0,
      };
    }),
  );
  years.value = summaries.sort((a, b) => b.setup.year - a.setup.year);
}

/**
 * Load a year into `current`. Without an argument, opens the year used last time,
 * or else the newest stored year.
 */
export async function openYear(year?: number): Promise<void> {
  await refreshYears();
  const stored = years.value.map((y) => y.setup.year);
  const saved = await getSetting("activeYear");
  const pick = [year, saved, stored[0]].find((y) => y !== undefined && stored.includes(y));
  let data = pick === undefined ? null : await loadYear(pick);
  // Bring older years up to date: drop people and owed shares, and give open years Uncategorized.
  // An open year is saved that way the first time; a closed one is only cleaned in memory, never rewritten.
  if (data) {
    const cleaned = withoutPeople(data);
    const base = cleaned ?? { setup: data.setup };
    const change = { ...base, setup: data.setup.closed ? base.setup : withUncategorized(base.setup) };
    if (cleaned || change.setup !== data.setup) {
      data = data.setup.closed ? withChange(data, change) : await saveChange(data, change);
    }
  }
  current.value = data;
  if (pick !== undefined && pick !== saved) await setSetting("activeYear", pick);
}

// Changes run one at a time. Each one reads the current state only when its turn comes,
// so two quick changes (say, typing budgets down a column) can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function inTurn<T>(change: () => Promise<T>): Promise<T> {
  const run = queue.then(change);
  queue = run.catch(() => undefined); // a failed change must not block the ones after it
  return run;
}

function editable(): YearData {
  const data = current.value;
  if (!data) throw new Error("No year is open.");
  if (data.setup.closed) throw new Error(`${data.setup.year} is closed and can't be changed.`);
  return data;
}

/** Ids already used by any entry this year. */
function takenIds(data: YearData): Set<string> {
  return new Set([...data.expenses, ...data.earnings, ...data.transfers].map((e) => e.id));
}

/** A fresh id for a new entry of this kind. */
export function nextEntryId(kind: Kind): string {
  const taken = takenIds(editable());
  return newId(ID_PREFIX[kind], (id) => taken.has(id));
}

/** A copy of the year without the entry `id` in the `kind` list. */
function withoutEntry(data: YearData, kind: Kind, id: string): YearData {
  switch (kind) {
    case "expense": return { ...data, expenses: data.expenses.filter((x) => x.id !== id) };
    case "earning": return { ...data, earnings: data.earnings.filter((x) => x.id !== id) };
    case "transfer": return { ...data, transfers: data.transfers.filter((x) => x.id !== id) };
  }
}

/** A copy of the year with `e` added to its list (replacing an entry with the same id). */
function withEntry(data: YearData, e: AnyEntry): YearData {
  const rest = withoutEntry(data, e.kind, e.entry.id);
  switch (e.kind) {
    case "expense": return { ...rest, expenses: [...rest.expenses, e.entry] };
    case "earning": return { ...rest, earnings: [...rest.earnings, e.entry] };
    case "transfer": return { ...rest, transfers: [...rest.transfers, e.entry] };
  }
}

/**
 * Add or update an entry. If an edit changes the kind (say expense to transfer),
 * `previousKind` removes the old record so the entry isn't stored twice.
 */
export function saveEntry(e: AnyEntry, previousKind?: Kind): Promise<void> {
  return inTurn(async () => {
    let data = editable();
    const year = data.setup.year;
    if (previousKind && previousKind !== e.kind) {
      await deleteEntry(STORE[previousKind], year, e.entry.id);
      data = withoutEntry(data, previousKind, e.entry.id);
    }
    await putEntry(STORE[e.kind], year, e.entry);
    current.value = withEntry(data, e);
  });
}

/** Save a copy of an entry with "-new" added to its item. Returns the copy. */
export async function duplicate(e: AnyEntry): Promise<AnyEntry> {
  const copy = duplicateEntry(e, nextEntryId(e.kind));
  await saveEntry(copy);
  return copy;
}

export function removeEntry(kind: Kind, id: string): Promise<void> {
  return inTurn(async () => {
    const data = editable();
    await deleteEntry(STORE[kind], data.setup.year, id);
    current.value = withoutEntry(data, kind, id);
  });
}

async function saveSetup(setup: YearSetup): Promise<void> {
  const data = editable();
  await putSetup(setup);
  current.value = { ...data, setup };
}

/**
 * Set or clear one budget target. `key` is "default" (every month) or "YYYY-MM" (that month only).
 * Null removes it: no budget for a usual target, back to the usual target for a month.
 */
export function setBudget(key: string, cat: string, cents: number | null): Promise<void> {
  return inTurn(async () => {
    const { setup } = editable();
    const targets = { ...(setup.budgets[key] ?? {}) };
    if (cents === null) delete targets[cat];
    else targets[cat] = cents;
    const budgets = { ...setup.budgets, [key]: targets };
    // Don't keep empty month entries around in the saved file.
    if (key !== "default" && Object.keys(targets).length === 0) delete budgets[key];
    await saveSetup({ ...setup, budgets });
  });
}

/**
 * Change the open year's setup (accounts, categories, tags). `change` gets the
 * current setup and what uses each item, and returns the new setup or throws a SetupError.
 */
export function updateSetup(change: (setup: YearSetup, usage: Usage) => YearSetup): Promise<void> {
  return inTurn(async () => {
    const data = editable();
    await saveSetup(change(data.setup, usageOf(data)));
  });
}

/** Save a change (new setup plus the entries it touched) in one transaction, then show it. */
async function saveChange(data: YearData, change: YearChange): Promise<YearData> {
  const { setup, expenses = [], earnings = [], transfers = [] } = change;
  await putSetupAndEntries(setup, { expenses, earnings, transfers });
  return withChange(data, change);
}

/** Delete a category; its entries move to Uncategorized. Returns how many entries moved. */
export function removeCategory(kind: CategoryKind, id: string): Promise<number> {
  return inTurn(async () => {
    const data = editable();
    const r = deleteCategory(data, kind, id);
    current.value = await saveChange(data, r);
    return r.expenses.length + r.earnings.length + r.transfers.length;
  });
}

/** Delete a tag; it comes off every expense that has it. Pinned dashboard tiles for it just disappear. */
export function removeTag(id: string): Promise<void> {
  return inTurn(async () => {
    const data = editable();
    current.value = await saveChange(data, deleteTag(data, id));
  });
}

/** Remove a member; their entries go back to the default member. */
export function removeMember(id: string): Promise<void> {
  return inTurn(async () => {
    const data = editable();
    current.value = await saveChange(data, deleteMember(data, id));
  });
}

/** Move the day the open year's tracking starts (null: January 1). Throws a SetupError if entries come before it. */
export function setStart(start: string | null): Promise<void> {
  return inTurn(async () => {
    const data = editable();
    await saveSetup(withStart(data, start));
  });
}

/** Start a year from scratch, with the standard categories and no accounts. */
export async function startYear(year: number, start: string | null = null): Promise<void> {
  await inTurn(async () => {
    if ((await listYears()).some((y) => y.year === year)) throw new Error(`${year} already exists.`);
    const setup = blankSetup(year);
    await replaceYear(emptyYearFile(withStart({ setup, expenses: [], earnings: [], transfers: [] }, start)));
  });
  await openYear(year);
}

export interface CloseResult {
  next: number;
  /** False when the next year already existed: its opening balances were left alone. */
  created: boolean;
}

/**
 * Close the open year: make it read-only and start the next year from its closing
 * balances (see rollover.ts). Download the year's backup before calling this.
 * Opens the new year afterwards.
 */
export async function closeYear(): Promise<CloseResult> {
  const result = await inTurn(async () => {
    const data = editable();
    const { setup } = data;
    const next = nextYearSetup(setup, { ...data, accounts: setup.accounts, categories: setup.categories });
    const exists = (await listYears()).some((y) => y.year === next.year);
    await putSetup({ ...setup, closed: true });
    if (!exists) await replaceYear(emptyYearFile(next));
    return { next: next.year, created: !exists };
  });
  await openYear(result.next);
  return result;
}

/** Make a closed year editable again. The next year's opening balances don't change with it. */
export async function reopenYear(year: number): Promise<void> {
  await inTurn(async () => {
    const data = await loadYear(year);
    if (data) await putSetup({ ...data.setup, closed: false });
  });
  await openYear(year);
}

/**
 * Delete one year: its setup and every entry. Other years stay as they are; the next
 * year keeps the opening balances it started with. If it was the open year, the newest
 * remaining year opens instead.
 */
export async function removeYear(year: number): Promise<void> {
  await inTurn(() => deleteYear(year));
  const open = current.value?.setup.year;
  await openYear(open !== year ? open : undefined);
}

/** Erase everything stored: every year, its entries and setup, and the app settings. The app starts empty. */
export async function eraseEverything(): Promise<void> {
  await inTurn(async () => {
    await eraseAll();
    current.value = null;
    pinnedTags.value = [];
  });
  await refreshYears();
}

/** Find a tag by name (ignoring case), or create it. Returns its id. */
export function ensureTag(name: string): Promise<string> {
  return inTurn(async () => {
    const { setup } = editable();
    const clean = name.trim();
    const found = setup.tags.find((t) => t.name.toLowerCase() === clean.toLowerCase());
    if (found) return found.id;
    const ids = new Set(setup.tags.map((t) => t.id));
    const base = `t_${slug(clean) || "tag"}`;
    const id = ids.has(base) ? newId(base, (x) => ids.has(x)) : base;
    const tags = [...setup.tags, { id, name: clean }].sort((a, b) => a.name.localeCompare(b.name));
    await saveSetup({ ...setup, tags });
    return id;
  });
}
