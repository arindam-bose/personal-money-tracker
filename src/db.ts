// IndexedDB storage. Everything lives in the user's browser; the JSON export is the real backup.
//
// Stores:
//   years      one YearSetup per year (accounts, categories, tags, members, budgets), keyed by year
//   expenses   } one record per entry, keyed by [year, id], because ids like "e0001"
//   earnings   } repeat every year. Each record is the entry plus its `year`.
//   transfers  }
//   settings   app-wide values (e.g. pinned tags), keyed by name

import type { Earning, Expense, Transfer, YearFile, YearSetup } from "./types";

const DB_NAME = "money-tracker";
const DB_VERSION = 1;

export type EntryKind = "expenses" | "earnings" | "transfers";
export const ENTRY_KINDS: EntryKind[] = ["expenses", "earnings", "transfers"];

export interface EntryTypes {
  expenses: Expense;
  earnings: Earning;
  transfers: Transfer;
}

/** How an entry is stored: the entry plus the year it belongs to. */
type Stored<T> = T & { year: number };

/** Everything stored for one year. */
export interface YearData {
  setup: YearSetup;
  expenses: Expense[];
  earnings: Earning[];
  transfers: Transfer[];
}

/** App-wide settings and their types. */
export interface Settings {
  /** The year the app opens to. */
  activeYear: number;
  /** Tag ids whose totals show on the dashboard (e.g. "t_india"). */
  pinnedTags: string[];
  /** True to leave what loans owe out of net worth on the dashboard. Left out, they count. */
  netWorthWithoutLoans: boolean;
}

// --- Small promise wrappers around the callback-style IndexedDB API ---

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Resolves once every write in the transaction is committed. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

/** All keys [year, <any id>]. Arrays sort after strings, so [year, []] is above every [year, "id"]. */
function yearRange(year: number): IDBKeyRange {
  return IDBKeyRange.bound([year], [year, []]);
}

/** Drop the `year` field that only exists in storage. */
function unstore<T>(row: Stored<T>): T {
  const { year: _year, ...entry } = row;
  return entry as T;
}

function byDateThenId(a: { date: string; id: string }, b: { date: string; id: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// --- Opening the database ---

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("years", { keyPath: "year" });
      for (const kind of ENTRY_KINDS) db.createObjectStore(kind, { keyPath: ["year", "id"] });
      db.createObjectStore("settings");
    };
    req.onsuccess = () => {
      const db = req.result;
      // If a newer version of the app opens in another tab, step aside so it can upgrade.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Close other Money Tracker tabs and reload."));
  });
  return dbPromise;
}

/** For tests: forget the open connection so the next call opens a fresh one. */
export async function closeDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

// --- Years ---

/** Every stored year, oldest first. */
export async function listYears(): Promise<YearSetup[]> {
  const db = await openDb();
  return request(db.transaction("years").objectStore("years").getAll() as IDBRequest<YearSetup[]>);
}

export async function loadYear(year: number): Promise<YearData | null> {
  const db = await openDb();
  const tx = db.transaction(["years", ...ENTRY_KINDS]);
  // Start every read before awaiting any, so they all run in the same transaction.
  const rowsOf = <T extends { date: string; id: string }>(kind: EntryKind) =>
    request(tx.objectStore(kind).getAll(yearRange(year)) as IDBRequest<Stored<T>[]>).then((rows) =>
      rows.map(unstore).sort(byDateThenId),
    );
  const [setup, expenses, earnings, transfers] = await Promise.all([
    request(tx.objectStore("years").get(year) as IDBRequest<YearSetup | undefined>),
    rowsOf<Expense>("expenses"),
    rowsOf<Earning>("earnings"),
    rowsOf<Transfer>("transfers"),
  ]);
  return setup ? { setup, expenses, earnings, transfers } : null;
}

/**
 * Store a whole year from an imported file, replacing anything already stored for it.
 * Runs in one transaction: if anything fails, the old data is left untouched.
 */
export async function replaceYear(file: YearFile, extra: Pick<YearSetup, "lastBackupAt"> = {}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["years", ...ENTRY_KINDS], "readwrite");
  const setup: YearSetup = {
    year: file.year,
    ...(file.start ? { start: file.start } : {}),
    ...(file.closed ? { closed: true } : {}),
    accounts: file.accounts,
    categories: file.categories,
    tags: file.tags,
    ...(file.members ? { members: file.members } : {}),
    budgets: file.budgets,
    ...(file.iraLimit !== undefined ? { iraLimit: file.iraLimit } : {}),
    ...(file.iraBeforeStart !== undefined ? { iraBeforeStart: file.iraBeforeStart } : {}),
    ...(file.lastChangedAt ? { lastChangedAt: file.lastChangedAt } : {}),
    ...(file.setupChangedAt ? { setupChangedAt: file.setupChangedAt } : {}),
    ...extra,
  };
  tx.objectStore("years").put(setup);
  for (const kind of ENTRY_KINDS) {
    const store = tx.objectStore(kind);
    store.delete(yearRange(file.year));
    for (const entry of file[kind]) store.put({ ...entry, year: file.year });
  }
  await committed(tx);
}

export async function deleteYear(year: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["years", ...ENTRY_KINDS], "readwrite");
  tx.objectStore("years").delete(year);
  for (const kind of ENTRY_KINDS) tx.objectStore(kind).delete(yearRange(year));
  await committed(tx);
}

/** Erase every year, every entry and every setting, in one transaction. */
export async function eraseAll(): Promise<void> {
  const db = await openDb();
  const stores = ["years", ...ENTRY_KINDS, "settings"];
  const tx = db.transaction(stores, "readwrite");
  for (const name of stores) tx.objectStore(name).clear();
  await committed(tx);
}

export async function putSetup(setup: YearSetup): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("years", "readwrite");
  tx.objectStore("years").put(setup);
  await committed(tx);
}

// --- Single entries (used by the ledger) ---

/** Store a new setup and some changed entries together: all of it is saved, or none. */
export async function putSetupAndEntries(setup: YearSetup, entries: { [K in EntryKind]: EntryTypes[K][] }): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["years", ...ENTRY_KINDS], "readwrite");
  tx.objectStore("years").put(setup);
  for (const kind of ENTRY_KINDS) {
    const store = tx.objectStore(kind);
    for (const entry of entries[kind]) store.put({ ...entry, year: setup.year });
  }
  await committed(tx);
}

/**
 * One ledger change in one transaction: the setup (with its new lastChangedAt), an entry to put
 * and/or one to delete. All of it is saved, or none, so the entry and its time never disagree.
 */
export async function putEntryChange(
  setup: YearSetup,
  change: { put?: { kind: EntryKind; entry: EntryTypes[EntryKind] }; remove?: { kind: EntryKind; id: string } },
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["years", ...ENTRY_KINDS], "readwrite");
  tx.objectStore("years").put(setup);
  if (change.remove) tx.objectStore(change.remove.kind).delete([setup.year, change.remove.id]);
  if (change.put) tx.objectStore(change.put.kind).put({ ...change.put.entry, year: setup.year });
  await committed(tx);
}

// --- Settings ---

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K] | undefined> {
  const db = await openDb();
  return request(db.transaction("settings").objectStore("settings").get(key) as IDBRequest<Settings[K] | undefined>);
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put(value, key);
  await committed(tx);
}
