// Settings page: import a year from JSON, export (back up) a stored year, close and reopen years,
// and the open year's own settings.

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { downloadYear, importYear, readJsonFile } from "../backup";
import { formatCents, parseCents } from "../money";
import { balances, localToday } from "../derive";
import { nextYearSetup } from "../rollover";
import {
  closeYear, current, type YearSummary, eraseEverything, iraLimit, ledger, loadSettings, openYear, persistState, readOnly, removeYear, reopenYear, saveIraBeforeStart, saveIraLimit, startYear, years,
} from "../state";
import { IRA_LIMITS, iraLimitOf } from "../setup";
import { AboutCard } from "./about";
import { checkForUpdates, offlineChanged, offlineStatus } from "../offline";
import { daysSince, requestPersistence } from "../storage";
import { setTheme, theme, themeChoice, type ThemeChoice } from "../theme";
import { shortDay, startsMidYear, yearStart } from "../year";
import { isDateInYear, validateYearFile } from "../validate";
import type { YearFile } from "../types";

const MAY_CLEAR = "This browser may clear your data on its own - if the site goes unvisited for a while, or space runs low - so keep a backup.";

const PERSIST_TEXT = {
  persisted: "This browser has agreed to keep your data until you clear it yourself.",
  "not-persisted": MAY_CLEAR,
  unsupported: MAY_CLEAR,
};

function entryCount(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;
}

/** "19 entries (8 expenses, 6 earnings, 5 transfers)". */
function entryBreakdown(counts: { expenses: number; earnings: number; transfers: number }): string {
  const { expenses, earnings, transfers } = counts;
  const kind = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
  return `${entryCount(expenses + earnings + transfers)} (${kind(expenses, "expense")}, ${kind(earnings, "earning")}, ${kind(transfers, "transfer")})`;
}

/** The question before an import replaces a stored year: what is here now, and what the file holds. */
function replaceQuestion(fileName: string, stored: YearSummary, file: YearFile): string {
  const exported = new Date(file.exportedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return [
    `Replace all your ${file.year} data with "${fileName}"?`,
    "",
    `In the tracker now: ${entryBreakdown(stored)}. ${backupText(stored.setup.lastBackupAt)}.`,
    `In the file: ${entryBreakdown({ expenses: file.expenses.length, earnings: file.earnings.length, transfers: file.transfers.length })}, exported ${exported}.`,
    "",
    "This can't be undone.",
  ].join("\n");
}

function backupText(iso: string | undefined): string {
  const days = daysSince(iso);
  if (days === null) return "Never backed up";
  if (days <= 0) return "Backed up today";
  return `Last backup ${days} day${days === 1 ? "" : "s"} ago`;
}

export function SettingsView() {
  const message = useSignal<string | null>(null);
  const errors = useSignal<string[]>([]);
  /** The year whose "Close year" panel is open. */
  const closing = useSignal<number | null>(null);
  /** The year whose row is asking "Delete …?". */
  const deleting = useSignal<number | null>(null);

  async function onStart(start: string | null) {
    await startYear(Number(localToday().slice(0, 4)), start);
    location.hash = "#/accounts";
  }

  async function onDelete(year: number) {
    deleting.value = null;
    if (closing.value === year) closing.value = null;
    errors.value = [];
    try {
      await removeYear(year);
      message.value = `Deleted ${year}. Import its backup to bring it back.`;
    } catch (err) {
      console.error(err);
      message.value = `Couldn't delete ${year}. Nothing was changed. Try again.`;
    }
  }

  async function onReopen(year: number) {
    if (!confirm(`Reopen ${year} so it can be changed again? The next year's opening balances won't update by themselves.`)) return;
    await reopenYear(year);
    message.value = `${year} is open for changes again.`;
  }

  async function onImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // so picking the same file again still fires a change
    if (!file) return;
    message.value = null;
    errors.value = [];
    try {
      const data = await readJsonFile(file);
      // Check the file before asking to replace anything, so we never ask about a file we'd reject.
      const check = validateYearFile(data);
      if (!check.ok) {
        message.value = `"${file.name}" was not imported:`;
        errors.value = check.errors;
        return;
      }
      const { year } = check.file;
      const stored = years.value.find((y) => y.setup.year === year);
      if (stored && !confirm(replaceQuestion(file.name, stored, check.file))) return;
      await importYear(data);
      message.value = `Imported ${year} from "${file.name}".`;
      await Promise.all([openYear(year), loadSettings()]);
    } catch (err) {
      message.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function onExport(year: number) {
    await downloadYear(year);
    // Reload so the open year has the new backup time too.
    await openYear(current.value?.setup.year);
  }

  return (
    <>
    <section class="panel">
      <h2>Your data</h2>

      {years.value.length === 0 ? (
        <div class="start-options">
          <p>No data yet. Import a Money Tracker JSON file below, or start from scratch.</p>
          <StartFromScratch onStart={onStart} />
        </div>
      ) : (
        <table class="years">
          <thead>
            <tr>
              <th>Year</th>
              <th class="num">Expenses</th>
              <th class="num">Earnings</th>
              <th class="num">Transfers</th>
              <th>Backup</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {years.value.map(({ setup, expenses, earnings, transfers }) => (
              <tr key={setup.year}>
                <td>
                  {setup.year}
                  {setup.closed && <span class="badge">closed</span>}
                </td>
                <td class="num">{expenses}</td>
                <td class="num">{earnings}</td>
                <td class="num">{transfers}</td>
                <td>{backupText(setup.lastBackupAt)}</td>
                <td>
                  {deleting.value === setup.year ? (
                    <div class="row-actions asking">
                      <span>
                        Delete {setup.year} and its {entryCount(expenses + earnings + transfers)}? {backupText(setup.lastBackupAt)}.
                      </span>
                      <button type="button" onClick={() => onExport(setup.year)}>Export JSON</button>
                      <button type="button" onClick={() => (deleting.value = null)}>Keep it</button>
                      <button type="button" class="danger-solid" onClick={() => onDelete(setup.year)}>Delete</button>
                    </div>
                  ) : (
                    <div class="row-actions">
                      <button type="button" onClick={() => onExport(setup.year)}>
                        Export JSON
                      </button>
                      {setup.closed ? (
                        <button type="button" onClick={() => onReopen(setup.year)}>Reopen</button>
                      ) : (
                        <button type="button" onClick={() => (closing.value = setup.year)}>Close year…</button>
                      )}
                      <button type="button" class="danger" onClick={() => (deleting.value = setup.year)}>Delete…</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {closing.value !== null && (
        <CloseYearPanel year={closing.value}
          onDone={(text) => { closing.value = null; message.value = text; }}
          onCancel={() => (closing.value = null)} />
      )}

      <label class="button">
        Import JSON…
        <input type="file" accept=".json,application/json" onChange={onImport} hidden />
      </label>

      {message.value && <p role="status">{message.value}</p>}
      {errors.value.length > 0 && (
        <ul class="errors">
          {errors.value.slice(0, 50).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {errors.value.length > 50 && <li>…and {errors.value.length - 50} more.</li>}
        </ul>
      )}
    </section>
    {current.value && <YearSettings key={current.value.setup.year} />}
    <AppearanceCard />
    <OfflineCard />
    <EraseCard onDone={(text) => { errors.value = []; message.value = text; }} />
    <AboutCard />
    </>
  );
}

/** Start this year empty: from January 1, or from a later day when starting partway through. */
function StartFromScratch(props: { onStart: (start: string | null) => void }) {
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const fromJan = useSignal(today.endsWith("-01-01"));
  const day = useSignal(today);
  const ok = fromJan.value || isDateInYear(day.value, year);
  return (
    <form class="start-form" onSubmit={(e) => { e.preventDefault(); if (ok) props.onStart(fromJan.value ? null : day.value); }}>
      <label class="choice">
        <input type="radio" name="start" checked={fromJan.value} onChange={() => (fromJan.value = true)} />
        From January 1, {year}: you know what each account held then.
      </label>
      <label class="choice">
        <input type="radio" name="start" checked={!fromJan.value} onChange={() => (fromJan.value = false)} />
        From
        <input type="date" value={day.value} min={`${year}-01-01`} max={`${year}-12-31`}
          onFocus={() => (fromJan.value = false)} onInput={(e) => (day.value = e.currentTarget.value)} />
        : starting partway through the year. The ledger begins that day.
      </label>
      <button type="submit" class="primary" disabled={!ok}>Start {year} from scratch</button>
      <p class="muted small">You'll get the standard categories, then add your accounts with what each held on the day you start.</p>
    </form>
  );
}

const THEMES: [ThemeChoice, string][] = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];

/** Light or dark mode, for this device. */
function AppearanceCard() {
  return (
    <section class="panel settings">
      <h2>Appearance</h2>
      <div class="segmented" role="radiogroup" aria-label="Theme">
        {THEMES.map(([value, label]) => (
          <button type="button" role="radio" aria-checked={themeChoice.value === value}
            class={themeChoice.value === value ? "active" : ""} onClick={() => setTheme(value)}>
            {label}
          </button>
        ))}
      </div>
      <p class="muted small">
        {themeChoice.value === "system"
          ? `Follows this device, which is in ${theme.value} mode now.`
          : `Always ${theme.value}, whatever this device is set to.`}{" "}
        Kept on this device only; backups leave it out.
      </p>
    </section>
  );
}

/** Whether the app works without a signal, whether the browser keeps the data, and a check for a newer release. */
function OfflineCard() {
  const status = useSignal("Checking…");
  const note = useSignal<string | null>(null);
  const checking = useSignal(false);
  // Asked again whenever the service worker says the offline copy changed.
  const changed = offlineChanged.value;
  useEffect(() => {
    offlineStatus().then((s) => (status.value = s));
  }, [changed]);

  async function onCheck() {
    checking.value = true;
    try {
      note.value = await checkForUpdates();
    } finally {
      checking.value = false;
    }
  }

  return (
    <section class="panel settings">
      <h2>Offline</h2>
      <p class="muted">{status.value}</p>
      {persistState.value && (
        <p class="muted">
          {PERSIST_TEXT[persistState.value]}{" "}
          {persistState.value === "not-persisted" && (
            <button type="button" class="link" onClick={async () => (persistState.value = await requestPersistence())}>
              Ask again
            </button>
          )}
        </p>
      )}
      <div class="setting-row">
        <button type="button" disabled={checking.value} onClick={onCheck}>
          {checking.value ? "Checking…" : "Check for updates"}
        </button>
        {note.value && <span class="muted" role="status">{note.value}</span>}
      </div>
    </section>
  );
}

/** Erase everything, asking twice, in place. */
function EraseCard(props: { onDone: (message: string) => void }) {
  const asking = useSignal(false);
  const busy = useSignal(false);
  const note = useSignal<string | null>(null);
  const entries = years.value.reduce((n, y) => n + y.expenses + y.earnings + y.transfers, 0);
  const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const what = years.value.length
    ? `${count(entries, "entry", "entries")} in ${count(years.value.length, "year", "years")}`
    : "everything";

  async function onErase() {
    busy.value = true;
    try {
      await eraseEverything();
      asking.value = false;
      note.value = null;
      props.onDone("Erased. The tracker is empty again.");
    } catch (err) {
      console.error(err);
      note.value = "Couldn't erase. Nothing was changed. Try again.";
    } finally {
      busy.value = false;
    }
  }

  return (
    <section class="panel settings danger-zone">
      <h2>Erase everything</h2>
      <p class="muted">
        Removes every ledger entry you have, with every year's accounts, categories, tags,
        budgets and settings. This cannot be undone - download a copy first.
      </p>
      <div class="setting-row">
        {asking.value ? (
          <>
            <span>Erase {what}?</span>
            <button type="button" disabled={busy.value} onClick={() => (asking.value = false)}>Keep it</button>
            <button type="button" class="danger-solid" disabled={busy.value} onClick={onErase}>Erase</button>
          </>
        ) : (
          <button type="button" class="danger" onClick={() => (asking.value = true)}>Erase my data</button>
        )}
        {note.value && <span class="warn" role="status">{note.value}</span>}
      </div>
    </section>
  );
}

/** Settings for the open year. Remounted per year (see `key` above), so the field starts at that year's limit. */
function YearSettings() {
  const setup = current.value!.setup;
  const { year } = setup;
  const irs = iraLimitOf({ year });
  const plain = (cents: number) => formatCents(cents).replace(/[$,]/g, "");
  const text = useSignal(plain(iraLimit.value));
  const note = useSignal<string | null>(null);
  const locked = readOnly.value;

  async function onSave(e: Event) {
    e.preventDefault();
    // Empty goes back to the IRS limit.
    const empty = text.value.trim() === "";
    const cents = empty ? irs : parseCents(text.value);
    if (cents === null) {
      note.value = "Enter an amount like 7500.";
      return;
    }
    // The IRS limit isn't stored, so the file keeps following the table.
    await saveIraLimit(cents === irs ? null : cents);
    text.value = plain(iraLimit.value);
    note.value = `Saved: ${formatCents(iraLimit.value)} for ${year}.`;
  }

  return (
    <section class="panel settings">
      <h2>{year} settings</h2>
      <form onSubmit={onSave} class="setting-row">
        <label class="field">
          <span class="field-label">IRA contribution limit for {year}</span>
          <input type="text" inputMode="decimal" class="num" value={text.value} disabled={locked}
            onInput={(e) => { text.value = e.currentTarget.value; note.value = null; }} />
        </label>
        {!locked && <button type="submit">Save</button>}
        {note.value && <span class="muted" role="status">{note.value}</span>}
      </form>
      <p class="muted small">
        The dashboard shows how much of this is left after {year}'s retirement transfers.{" "}
        {year in IRA_LIMITS
          ? <>The IRS limit for {year} is {formatCents(irs)}; leave the field empty to use it.</>
          : <>No IRS limit is listed for {year} yet, so it starts at {formatCents(irs)}.</>}
        {locked && <> {year} is closed, so this can't be changed.</>}
      </p>
      {(startsMidYear(setup) || setup.iraBeforeStart !== undefined) && <IraBeforeStart />}
    </section>
  );
}

/** For a year begun partway through: what went into IRAs earlier that year, which the ledger doesn't have. */
function IraBeforeStart() {
  const setup = current.value!.setup;
  const day = shortDay(yearStart(setup));
  const text = useSignal(setup.iraBeforeStart ? (setup.iraBeforeStart / 100).toFixed(2) : "");
  const note = useSignal<string | null>(null);
  const locked = readOnly.value;

  async function onSave(e: Event) {
    e.preventDefault();
    const cents = text.value.trim() === "" ? 0 : parseCents(text.value);
    if (cents === null) {
      note.value = "Enter an amount like 2000.";
      return;
    }
    await saveIraBeforeStart(cents);
    note.value = `Saved: ${formatCents(cents)} before ${day}.`;
  }

  return (
    <>
      <form onSubmit={onSave} class="setting-row">
        <label class="field">
          <span class="field-label">IRA contributions before {day}</span>
          <input type="text" inputMode="decimal" class="num" value={text.value} placeholder="0.00" disabled={locked}
            onInput={(e) => { text.value = e.currentTarget.value; note.value = null; }} />
        </label>
        {!locked && <button type="submit">Save</button>}
        {note.value && <span class="muted" role="status">{note.value}</span>}
      </form>
      <p class="muted small">
        Tracking began on {day}, so anything you put into an IRA earlier in {setup.year} isn't in the ledger.
        Enter it here and it counts against the limit.
      </p>
    </>
  );
}

/**
 * Explains what closing a year does, shows the balances that carry over, and does it:
 * download the backup first, then close.
 */
function CloseYearPanel(props: { year: number; onDone: (message: string) => void; onCancel: () => void }) {
  const busy = useSignal(false);
  const { year } = props;
  // Closing works on the open year, so switch to it first if needed.
  useEffect(() => {
    if (current.value?.setup.year !== year) openYear(year);
  }, [year]);
  if (current.value?.setup.year !== year) return <p class="muted">Opening {year}…</p>;
  const data = current.value;
  const l = ledger.value!;
  const next = nextYearSetup(data.setup, l);
  const closingBal = balances(l);
  const nextExists = years.value.some((y) => y.setup.year === year + 1);
  const notOver = new Date().getFullYear() <= year;

  async function onClose() {
    busy.value = true;
    try {
      await downloadYear(year);
      const r = await closeYear();
      props.onDone(r.created
        ? `${year} is closed and backed up. ${r.next} has started with ${year}'s closing balances.`
        : `${year} is closed and backed up. ${r.next} already existed, so its opening balances were left as they were.`);
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="close-panel">
      <h3>Close {year}</h3>
      <ol>
        <li>Download a backup of {year}. Keep it somewhere safe.</li>
        <li>Make {year} read-only. You can still see it, and reopen it if you need to.</li>
        <li>
          {nextExists
            ? <>{year + 1} already exists, so it stays as it is.</>
            : <>Start {year + 1} with the accounts, categories, tags and usual budgets of {year}, opening at these balances:</>}
        </li>
      </ol>
      {!nextExists && (
        <table class="data-table">
          <thead>
            <tr><th>Account</th><th class="num">{year} closing</th><th class="num">{year + 1} opening</th></tr>
          </thead>
          <tbody>
            {next.accounts.map((a) => (
              <tr>
                <td>{a.name}</td>
                <td class="num">{formatCents(closingBal.get(a.id) ?? 0)}</td>
                <td class="num">
                  {formatCents(a.opening)}
                  {a.type === "investment" && <span class="muted small"> (contributions start again)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {notOver && <p class="warn">{year} isn't over yet. Entries for the rest of {year} can't be added after closing (unless you reopen it).</p>}
      <div class="form-actions">
        <button type="button" class="primary" disabled={busy.value} onClick={onClose}>Download backup and close {year}</button>
        <button type="button" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}
