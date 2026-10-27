// The ledger: every earning, expense and transfer of the year in one table.
// Transfers are shown muted and unsigned, because they move money without spending it.

import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { MONTH_NAMES, dateTime, inMonth, localToday, monthsBefore, shortDate } from "../derive";
import { draftFrom, emptyDraft, type AnyEntry, type Draft, type Kind } from "../entries";
import { formatCents } from "../money";
import { membersOf } from "../setup";
import { current, duplicate, readOnly } from "../state";
import type { YearSetup } from "../types";
import { yearStart } from "../year";
import { EntryForm } from "./entry-form";
import { SearchSelect } from "./search-select";

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
  /** Member id, or "" for everyone. */
  member: string;
  /** Text search in item and notes. */
  q: string;
}

const NO_FILTERS: Filters = { month: "", from: "", to: "", kind: "", account: "", cat: "", tag: "", member: "", q: "" };
const FILTERS_KEY = "ledger-filters";
const SORT_KEY = "ledger-sort";
/** Rows shown at a time; buttons under the table show more or fewer. */
const PAGE = 100;

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

/** Whether "Last N months" can reach the year at all: it's this year, or last year's tail is within 12 months. */
function recentReaches(year: number, today: string): boolean {
  return `${year}-01-01` <= today && `${year}-12-31` >= monthsBefore(today, 12);
}

/**
 * The filters that actually apply to a year. Saved filters can name things it doesn't have:
 * a category, tag or person deleted since, or another year's. Those are dropped, so the
 * dropdowns (which then show "All …") and the rows agree.
 */
function liveFilters(f: Filters, setup: YearSetup, today: string): Filters {
  const has = (list: { id: string }[], id: string) => !id || list.some((x) => x.id === id);
  const { expense, earning, transfer } = setup.categories;
  const members = membersOf(setup);
  return {
    ...f,
    month: f.month.startsWith("last-") && !recentReaches(setup.year, today) ? "" : f.month,
    account: has(setup.accounts, f.account) ? f.account : "",
    cat: has([...expense, ...earning, ...transfer], f.cat) ? f.cat : "",
    tag: has(setup.tags, f.tag) ? f.tag : "",
    member: members.length > 1 && has(members, f.member) ? f.member : "",
  };
}

/** The dates a filter lets through, first to last; "" leaves that end open. Null for a single month. */
function dateWindow(f: Filters, today: string): [string, string] | null {
  if (f.month.startsWith("last-")) return [monthsBefore(today, Number(f.month.slice(5))), today];
  if (f.month === "range") return [f.from, f.to];
  return null;
}

/** `window` is dateWindow(f), worked out once for all rows. */
function matches(e: AnyEntry, f: Filters, window: [string, string] | null, defaultMember: string): boolean {
  if (f.member && (e.entry.member ?? defaultMember) !== f.member) return false;
  const date = e.entry.date;
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

/** Today if it falls in the open year's ledger, otherwise the day the ledger starts. */
function defaultDate(setup: YearSetup): string {
  const today = localToday();
  const start = yearStart(setup);
  return Number(today.slice(0, 4)) === setup.year && today >= start ? today : start;
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

  /** The filters in effect: the saved ones, minus anything the open year doesn't have. */
  const live = useComputed(() => {
    const setup = current.value?.setup;
    return setup ? liveFilters(filters.value, setup, localToday()) : filters.value;
  });
  const rows = useComputed(() => {
    const f = live.value;
    const window = dateWindow(f, localToday());
    const defaultMember = membersOf(current.value?.setup ?? {})[0]!.id;
    const out = allEntries().filter((e) => matches(e, f, window, defaultMember));
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
    // Filtered to one person: the new entry is theirs, so it stays in view once saved.
    const member = live.value.member === membersOf(current.value!.setup)[0]!.id ? "" : live.value.member;
    form.value = { ...emptyDraft(kind, defaultDate(current.value!.setup), current.value!.setup), member };
    window.scrollTo({ top: 0 });
  }

  async function onDuplicate(e: AnyEntry) {
    if (readOnly.value) return;
    let copy: AnyEntry;
    try {
      copy = await duplicate(e);
    } catch (err) {
      // Say, a copy that would change a closed account.
      return void alert(err instanceof Error ? err.message : String(err));
    }
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
        <p>No data yet. Go to <a href="#/settings">Settings</a> to import a year or start one from scratch.</p>
      </section>
    );
  }

  const { setup } = data;
  const accountName = new Map(setup.accounts.map((a) => [a.id, a.name]));
  /** The account, or "From → To" for a transfer. */
  const accountText = (e: AnyEntry) =>
    e.kind === "transfer"
      ? `${accountName.get(e.entry.from) ?? "?"} → ${accountName.get(e.entry.to) ?? "?"}`
      : accountName.get(e.entry.account) ?? "?";
  const catName = new Map(
    [...setup.categories.expense, ...setup.categories.earning, ...setup.categories.transfer].map((c) => [c.id, c.name]),
  );
  const tagName = new Map(setup.tags.map((t) => [t.id, t.name]));
  const members = membersOf(setup);
  // The person filter and column appear once there's more than one person.
  const household = members.length > 1;
  const memberName = (id: string | undefined) => members.find((m) => m.id === (id ?? members[0]!.id))?.name ?? "?";
  const f = live.value;
  // Built on the live filters, so changing any filter also drops values that no longer apply.
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => (filters.value = { ...live.value, [key]: value });
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

      {setup.lastChangedAt && (
        <p class="muted small last-updated">
          Last updated {dateTime(setup.lastChangedAt)}
        </p>
      )}

      {form.value && (
        <EntryForm key={form.value.id ?? `new-${form.value.kind}`} initial={form.value} onClose={() => (form.value = null)} />
      )}

      <div class="filters">
        <div class="search">
          <input ref={searchRef} type="search" placeholder="Search…  /" value={f.q} onInput={(e) => setFilter("q", e.currentTarget.value)} />
          {/* Clears only the search: the other filters and the sort stay as they are. */}
          {f.q && (
            <button type="button" class="search-clear" aria-label="Clear search" title="Clear search"
              onClick={() => { setFilter("q", ""); searchRef.current?.focus(); }}>×</button>
          )}
        </div>
        <SearchSelect value={f.month} aria-label="Dates"
          onChange={(v) => (filters.value = { ...live.value, month: v, from: "", to: "" })}
          choices={[
            { value: "", label: "All dates" },
            { value: "range", label: "Pick dates…" },
            ...(recentReaches(setup.year, localToday())
              ? Array.from({ length: 12 }, (_, i) => ({ value: `last-${i + 1}`, label: i === 0 ? "Last month" : `Last ${i + 1} months`, group: "Up to today" }))
              : []),
            ...MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m, group: "Month" })),
          ]} />
        {f.month === "range" && (
          <>
            <input type="date" aria-label="From" title="From" value={f.from} max={f.to || undefined}
              onChange={(e) => setFilter("from", e.currentTarget.value)} />
            <span class="muted">to</span>
            <input type="date" aria-label="To" title="To" value={f.to} min={f.from || undefined}
              onChange={(e) => setFilter("to", e.currentTarget.value)} />
          </>
        )}
        <SearchSelect value={f.kind} aria-label="Kind" onChange={(v) => setFilter("kind", v as Filters["kind"])}
          choices={[{ value: "", label: "All kinds" }, { value: "earning", label: "Earnings" }, { value: "expense", label: "Expenses" }, { value: "transfer", label: "Transfers" }]} />
        {/* Assets never have entries, so they'd always filter to nothing. */}
        <SearchSelect value={f.account} aria-label="Account" onChange={(v) => setFilter("account", v)}
          choices={[{ value: "", label: "All accounts" }, ...setup.accounts.filter((a) => a.type !== "asset").map((a) => ({ value: a.id, label: a.name }))]} />
        <SearchSelect value={f.cat} aria-label="Category" onChange={(v) => setFilter("cat", v)}
          choices={[
            { value: "", label: "All categories" },
            ...setup.categories.earning.map((c) => ({ value: c.id, label: c.name, group: "Earnings" })),
            ...setup.categories.expense.map((c) => ({ value: c.id, label: c.name, group: "Expenses" })),
            ...setup.categories.transfer.map((c) => ({ value: c.id, label: c.name, group: "Transfers" })),
          ]} />
        <SearchSelect value={f.tag} aria-label="Tag" onChange={(v) => setFilter("tag", v)}
          choices={[{ value: "", label: "All tags" }, ...setup.tags.map((t) => ({ value: t.id, label: t.name }))]} />
        {household && (
          <SearchSelect value={f.member} aria-label="Person" onChange={(v) => setFilter("member", v)}
            choices={[{ value: "", label: "All people" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
        )}
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
            {household && <th class="c-person">Person</th>}
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
              <td class="c-cat" title={catName.get(e.entry.cat) ?? "?"}>
                <span class={`kind-dot dot-${e.kind}`} aria-hidden="true" />
                {catName.get(e.entry.cat) ?? "?"}
              </td>
              {/* The title shows the whole name when the column is too narrow for it. */}
              <td class="c-account" title={accountText(e)}>{accountText(e)}</td>
              {household && <td class="c-person">{memberName(e.entry.member)}</td>}
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
