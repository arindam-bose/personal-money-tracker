// The ledger: every earning, expense and transfer of the year in one table.
// Transfers are shown muted and unsigned, because they move money without spending it.

import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { inMonth, monthsBefore } from "../derive";
import { draftFrom, emptyDraft, type AnyEntry, type Draft, type Kind } from "../entries";
import { formatCents } from "../money";
import { current, duplicate, readOnly } from "../state";
import { EntryForm } from "./entry-form";

export interface Filters {
  /** "" for the whole year, "1".."12" for that month, "last-1".."last-12" for the months up to today, or "range" for from–to. */
  month: string;
  /** With month "range": first and last day shown, "YYYY-MM-DD". Either can be "" for open-ended. */
  from: string;
  to: string;
  kind: "" | Kind;
  account: string;
  cat: string;
  tag: string;
  /** Text search in item and notes. */
  q: string;
}

const NO_FILTERS: Filters = { month: "", from: "", to: "", kind: "", account: "", cat: "", tag: "", q: "" };
const FILTERS_KEY = "ledger-filters";
const SORT_KEY = "ledger-sort";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
/** Rows shown at a time; buttons under the table show more or fewer. */
const PAGE = 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Filters last until the tab is closed. Storage can be unavailable (private mode), so failures are ignored. */
function loadFilters(): Filters {
  try {
    return { ...NO_FILTERS, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? "{}") };
  } catch {
    return NO_FILTERS;
  }
}

/** Open the ledger showing only matching entries, e.g. from a dashboard category. */
export function showInLedger(f: Partial<Filters>) {
  saveFilters({ ...NO_FILTERS, ...f });
  location.hash = "#/ledger";
}

/** Sort order lasts until the tab is closed, like the filters, but Clear leaves it alone. */
function loadOldestFirst(): boolean {
  try {
    return sessionStorage.getItem(SORT_KEY) === "oldest";
  } catch {
    return false;
  }
}

function saveFilters(f: Filters) {
  try {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // Not saved; the filters still work for this page view.
  }
}

/**
 * Order within a day. Ids made in the app ("e_<time>…") sort by when they were made,
 * across all three kinds, and after imported ones ("e0001"). So drop the kind letter.
 */
const order = (id: string) => id.slice(1);

/** All entries of the open year, newest first. */
function allEntries(): AnyEntry[] {
  const data = current.value;
  if (!data) return [];
  const rows: AnyEntry[] = [
    ...data.expenses.map((entry) => ({ kind: "expense" as const, entry })),
    ...data.earnings.map((entry) => ({ kind: "earning" as const, entry })),
    ...data.transfers.map((entry) => ({ kind: "transfer" as const, entry })),
  ];
  return rows.sort((a, b) =>
    a.entry.date !== b.entry.date ? (a.entry.date < b.entry.date ? 1 : -1) : order(a.entry.id) < order(b.entry.id) ? 1 : -1,
  );
}

/** Today in the browser's time zone, "YYYY-MM-DD". */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The dates a filter lets through, first to last; "" leaves that end open. Null for a single month. */
function dateWindow(f: Filters, today: string): [string, string] | null {
  if (f.month.startsWith("last-")) return [monthsBefore(today, Number(f.month.slice(5))), today];
  if (f.month === "range") return [f.from, f.to];
  return null;
}

function matches(e: AnyEntry, f: Filters, today: string): boolean {
  const date = e.entry.date;
  const window = dateWindow(f, today);
  if (window) {
    if ((window[0] && date < window[0]) || (window[1] && date > window[1])) return false;
  } else if (f.month && !inMonth(date, Number(f.month))) return false;
  if (f.kind && e.kind !== f.kind) return false;
  if (f.cat && e.entry.cat !== f.cat) return false;
  if (f.account) {
    const hit = e.kind === "transfer" ? e.entry.from === f.account || e.entry.to === f.account : e.entry.account === f.account;
    if (!hit) return false;
  }
  if (f.tag && !(e.kind === "expense" && e.entry.tags.includes(f.tag))) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!e.entry.item.toLowerCase().includes(q) && !e.entry.notes.toLowerCase().includes(q)) return false;
  }
  return true;
}

/** A row's unique key: ids are only unique within their kind. */
const rowKey = (e: AnyEntry) => `${e.kind}:${e.entry.id}`;

/** "2026-03-09" -> "Mar 9". */
function shortDate(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** Today if it falls in the open year, otherwise January 1 of that year. */
function defaultDate(year: number): string {
  const today = localToday();
  return Number(today.slice(0, 4)) === year ? today : `${year}-01-01`;
}

export function LedgerView() {
  const filters = useSignal<Filters>(loadFilters());
  const form = useSignal<Draft | null>(null);
  /** Row key of a just-made copy, highlighted for a moment so you can see where it landed. */
  const flash = useSignal<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** How many of the matching rows are shown, newest first. */
  const shown = useSignal(PAGE);
  const oldestFirst = useSignal(loadOldestFirst());

  useSignalEffect(() => saveFilters(filters.value));
  useSignalEffect(() => {
    try {
      sessionStorage.setItem(SORT_KEY, oldestFirst.value ? "oldest" : "newest");
    } catch {
      // Not kept; the sort still works for this page view.
    }
  });
  // New filters or a new order start again from the first PAGE rows.
  useSignalEffect(() => {
    filters.value;
    oldestFirst.value;
    shown.value = PAGE;
  });

  const rows = useComputed(() => {
    const today = localToday();
    const out = allEntries().filter((e) => matches(e, filters.value, today));
    return oldestFirst.value ? out.reverse() : out;
  });
  const totals = useComputed(() => {
    const t = { expense: 0, earning: 0, transfer: 0 };
    for (const e of rows.value) t[e.kind] += e.entry.amount;
    return t;
  });

  const data = current.value;

  // Reads the year at call time: the keyboard shortcut below keeps this function from the first render.
  function openNew(kind: Kind) {
    const year = current.value?.setup.year;
    if (year === undefined || readOnly.value || current.value!.setup.accounts.length === 0) return;
    form.value = emptyDraft(kind, defaultDate(year));
    window.scrollTo({ top: 0 });
  }

  async function onDuplicate(e: AnyEntry) {
    if (readOnly.value) return;
    const copy = await duplicate(e);
    const key = rowKey(copy);
    // Make sure the copy is among the rows shown.
    const at = rows.value.findIndex((r) => rowKey(r) === key);
    if (at >= shown.value) shown.value = Math.ceil((at + 1) / PAGE) * PAGE;
    flash.value = key;
    setTimeout(() => flash.value === key && (flash.value = null), 2000);
    // After the table re-renders, bring the copy into view and select it, so D again copies it.
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`tr[data-key="${key}"]`);
      row?.scrollIntoView({ block: "nearest" });
      row?.focus({ preventScroll: true });
    });
  }

  function openEdit(e: AnyEntry) {
    if (readOnly.value) return;
    form.value = draftFrom(e);
    window.scrollTo({ top: 0 });
  }

  // Shortcuts while not typing: E, I, T add an entry; / jumps to search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (form.value || e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      const kind = ({ e: "expense", i: "earning", t: "transfer" } as Record<string, Kind>)[e.key.toLowerCase()];
      if (kind) {
        e.preventDefault();
        openNew(kind);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!data) {
    return (
      <section class="panel">
        <h2>Ledger</h2>
        <p>No data yet. Go to <a href="#/data">Data</a> to import a year.</p>
      </section>
    );
  }

  const { setup } = data;
  const accountName = new Map(setup.accounts.map((a) => [a.id, a.name]));
  const catName = new Map(
    [...setup.categories.expense, ...setup.categories.earning, ...setup.categories.transfer].map((c) => [c.id, c.name]),
  );
  const tagName = new Map(setup.tags.map((t) => [t.id, t.name]));
  const f = filters.value;
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => (filters.value = { ...filters.value, [key]: value });
  const filtered = Object.entries(f).some(([k, v]) => v !== NO_FILTERS[k as keyof Filters]);

  return (
    <section class="ledger">
      <div class="toolbar">
        {setup.accounts.length === 0 ? (
          <span class="muted">Add your accounts on the <a href="#/accounts">Accounts</a> page first, then log entries here.</span>
        ) : !readOnly.value ? (
          <>
            <button type="button" class="add add-earning" onClick={() => openNew("earning")}>+ Earning <kbd>I</kbd></button>
            <button type="button" class="add add-expense" onClick={() => openNew("expense")}>- Expense <kbd>E</kbd></button>
            <button type="button" class="add add-transfer" onClick={() => openNew("transfer")}>⇄ Transfer <kbd>T</kbd></button>
          </>
        ) : (
          <span class="muted">{setup.year} is closed, so it can't be changed.</span>
        )}
      </div>

      {form.value && (
        <EntryForm key={form.value.id ?? `new-${form.value.kind}`} initial={form.value} onClose={() => (form.value = null)} />
      )}

      <div class="filters">
        <input ref={searchRef} type="search" placeholder="Search…  /" value={f.q} onInput={(e) => setFilter("q", e.currentTarget.value)} />
        <select value={f.month} aria-label="Dates"
          onChange={(e) => (filters.value = { ...filters.value, month: e.currentTarget.value, from: "", to: "" })}>
          <option value="">All dates</option>
          <optgroup label="Up to today">
            {Array.from({ length: 12 }, (_, i) => (
              <option value={`last-${i + 1}`}>{i === 0 ? "Last month" : `Last ${i + 1} months`}</option>
            ))}
          </optgroup>
          <optgroup label="Month">
            {MONTH_NAMES.map((m, i) => <option value={String(i + 1)}>{m}</option>)}
          </optgroup>
          <option value="range">Pick dates…</option>
        </select>
        {f.month === "range" && (
          <>
            <input type="date" aria-label="From" title="From" value={f.from} max={f.to || undefined}
              onChange={(e) => setFilter("from", e.currentTarget.value)} />
            <span class="muted">to</span>
            <input type="date" aria-label="To" title="To" value={f.to} min={f.from || undefined}
              onChange={(e) => setFilter("to", e.currentTarget.value)} />
          </>
        )}
        <select value={f.kind} onChange={(e) => setFilter("kind", e.currentTarget.value as Filters["kind"])} aria-label="Kind">
          <option value="">All kinds</option>
          <option value="earning">Earnings</option>
          <option value="expense">Expenses</option>
          <option value="transfer">Transfers</option>
        </select>
        <select value={f.account} onChange={(e) => setFilter("account", e.currentTarget.value)} aria-label="Account">
          <option value="">All accounts</option>
          {setup.accounts.map((a) => <option value={a.id}>{a.name}</option>)}
        </select>
        <select value={f.cat} onChange={(e) => setFilter("cat", e.currentTarget.value)} aria-label="Category">
          <option value="">All categories</option>
          <optgroup label="Earnings">{setup.categories.earning.map((c) => <option value={c.id}>{c.name}</option>)}</optgroup>
          <optgroup label="Expenses">{setup.categories.expense.map((c) => <option value={c.id}>{c.name}</option>)}</optgroup>
          <optgroup label="Transfers">{setup.categories.transfer.map((c) => <option value={c.id}>{c.name}</option>)}</optgroup>
        </select>
        <select value={f.tag} onChange={(e) => setFilter("tag", e.currentTarget.value)} aria-label="Tag">
          <option value="">All tags</option>
          {setup.tags.map((t) => <option value={t.id}>{t.name}</option>)}
        </select>
        <select value={oldestFirst.value ? "oldest" : "newest"} aria-label="Sort"
          onChange={(e) => (oldestFirst.value = e.currentTarget.value === "oldest")}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        {filtered && <button type="button" class="link" onClick={() => (filters.value = NO_FILTERS)}>Clear</button>}
      </div>

      <div class="totals">
        <span>{rows.value.length} entries</span>
        <span>Earned <b class="pos">{formatCents(totals.value.earning)}</b></span>
        <span>Spent <b class="neg">{formatCents(totals.value.expense)}</b></span>
        <span>Transferred <b>{formatCents(totals.value.transfer)}</b></span>
      </div>

      <table class="entries">
        <thead>
          <tr>
            <th class="c-act"><span class="sr-only">Actions</span></th>
            <th class="c-date">Date</th>
            <th>Item</th>
            <th class="c-cat">Category</th>
            <th class="c-account">Account</th>
            <th class="c-tags">Tags</th>
            <th class="num c-amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.value.slice(0, shown.value).map((e) => (
            <tr key={rowKey(e)} data-key={rowKey(e)} class={`row-${e.kind} ${flash.value === rowKey(e) ? "flash" : ""}`}
              tabIndex={readOnly.value ? -1 : 0}
              onClick={() => openEdit(e)}
              onKeyDown={(k) => {
                if (k.key === "Enter") openEdit(e);
                else if (k.key.toLowerCase() === "d" && !k.ctrlKey && !k.metaKey && !k.altKey) {
                  k.preventDefault();
                  onDuplicate(e);
                }
              }}>
              <td class="c-act">
                {!readOnly.value && (
                  <button type="button" class="dup-btn" aria-label={`Duplicate ${e.entry.item}`} title="Duplicate (D)"
                    onClick={(ev) => { ev.stopPropagation(); onDuplicate(e); }}>
                    ⧉
                  </button>
                )}
              </td>
              <td class="c-date">{shortDate(e.entry.date)}</td>
              <td class="c-item">
                <span class="item" title={e.entry.item}>{e.entry.item}</span>
                {e.entry.notes && <span class="notes" title={e.entry.notes}>{e.entry.notes}</span>}
              </td>
              <td class="c-cat">
                <span class={`kind-dot dot-${e.kind}`} aria-hidden="true" />
                {catName.get(e.entry.cat) ?? "?"}
              </td>
              <td class="c-account">
                {e.kind === "transfer"
                  ? `${accountName.get(e.entry.from) ?? "?"} → ${accountName.get(e.entry.to) ?? "?"}`
                  : accountName.get(e.entry.account) ?? "?"}
              </td>
              <td class="c-tags">
                {e.kind === "expense" && e.entry.tags.map((t) => <span class="chip">{tagName.get(t) ?? t}</span>)}
              </td>
              <td class={`num c-amount amt-${e.kind}`}>
                {e.kind === "expense" ? "−" : e.kind === "earning" ? "+" : ""}
                {formatCents(e.entry.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.value.length === 0 && <p class="muted empty">Nothing matches these filters.</p>}
      {rows.value.length > PAGE && (
        <div class="more-rows">
          <span class="muted">Showing {Math.min(shown.value, rows.value.length)} of {rows.value.length}</span>
          {shown.value > PAGE && (
            <button type="button" onClick={() => (shown.value = Math.max(PAGE, shown.value - PAGE))}>Show {PAGE} fewer</button>
          )}
          {shown.value < rows.value.length && (
            <button type="button" onClick={() => (shown.value += PAGE)}>
              Show {Math.min(PAGE, rows.value.length - shown.value)} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
