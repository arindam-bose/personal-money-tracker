// App-wide reactive state. Components read these signals and re-render when they change.
// Every change goes through the actions below: they write to IndexedDB first, then
// update the signal, so what you see is always what is stored.

import { computed, signal } from "@preact/signals";
import { deleteEntry, getSetting, listYears, loadYear, putEntry, putSetup, setSetting, type YearData } from "./db";
import type { Ledger } from "./derive";
import { ID_PREFIX, STORE, newId, slug, type AnyEntry, type Kind } from "./entries";
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

/** Default annual IRA contribution limit: $7,500. Change it on the Data page. */
export const DEFAULT_IRA_LIMIT = 750000;

export const iraLimit = signal<number>(DEFAULT_IRA_LIMIT);
export const pinnedTags = signal<string[]>([]);

export async function loadSettings(): Promise<void> {
  iraLimit.value = (await getSetting("iraLimit")) ?? DEFAULT_IRA_LIMIT;
  pinnedTags.value = (await getSetting("pinnedTags")) ?? [];
}

export async function saveIraLimit(cents: number): Promise<void> {
  await setSetting("iraLimit", cents);
  iraLimit.value = cents;
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
  current.value = pick === undefined ? null : await loadYear(pick);
  if (pick !== undefined && pick !== saved) await setSetting("activeYear", pick);
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
export async function saveEntry(e: AnyEntry, previousKind?: Kind): Promise<void> {
  let data = editable();
  const year = data.setup.year;
  if (previousKind && previousKind !== e.kind) {
    await deleteEntry(STORE[previousKind], year, e.entry.id);
    data = withoutEntry(data, previousKind, e.entry.id);
  }
  await putEntry(STORE[e.kind], year, e.entry);
  current.value = withEntry(data, e);
}

export async function removeEntry(kind: Kind, id: string): Promise<void> {
  const data = editable();
  await deleteEntry(STORE[kind], data.setup.year, id);
  current.value = withoutEntry(data, kind, id);
}

async function saveSetup(setup: YearSetup): Promise<void> {
  const data = editable();
  await putSetup(setup);
  current.value = { ...data, setup };
}

/** Find a tag by name (ignoring case), or create it. Returns its id. */
export async function ensureTag(name: string): Promise<string> {
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
}

/** Find a person by name (ignoring case), or add them. Returns their id. */
export async function ensurePerson(name: string): Promise<string> {
  const { setup } = editable();
  const clean = name.trim();
  const people = setup.people ?? [];
  const found = people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (found) return found.id;
  const ids = new Set(people.map((p) => p.id));
  const base = `p_${slug(clean) || "person"}`;
  const id = ids.has(base) ? newId(base, (x) => ids.has(x)) : base;
  await saveSetup({ ...setup, people: [...people, { id, name: clean }] });
  return id;
}
