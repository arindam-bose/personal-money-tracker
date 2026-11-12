// Settings page. Your data: import a year from JSON or start one from scratch (or download the
// demo), export (back up), close, reopen and delete years. Then the open year's IRA settings,
// Appearance (light or dark), Offline (the cached copy and updates), Erase everything, On your home screen, and About.

import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { importYear, readJsonFile } from "../backup";
import { formatCents, parseCents } from "../money";
import { dateTime, lastUpdatedAt, localToday, shortDate } from "../derive";
import { closingBalances, nextYearSetup } from "../rollover";
import {
  backUpYear, closeYear, current, type YearSummary, eraseEverything, iraLimit, ledger, loadSettings, openYear, persistState, readOnly, refreshYears, removeYear, reopenYear, saveIraBeforeStart, saveIraLimit, startYear, years,
} from "../state";
import { IRA_LIMITS, iraLimitOf } from "../setup";
import { HIDDEN_AMOUNT, maskedCents, numbersHidden, setNumbersHidden } from "../hide-numbers";
import { DateInput } from "./date-field";
import { DemoLink } from "./demo-link";
import { AboutCard } from "./about";
import { IconButton } from "./icons";
import { checkForUpdates, offlineChanged, offlineStatus, updateReady } from "../offline";
import { detectDevice } from "../device";
import { installState, installSteps, promptInstall } from "../install";
import { backupText, requestPersistence } from "../storage";
import { setTheme, theme, themeChoice, type ThemeChoice } from "../theme";
import { startsMidYear, yearStart } from "../year";
import { isDateInYear, validateYearFile } from "../validate";
import type { YearFile } from "../types";

const MAY_CLEAR = "This browser may clear your data on its own - if the site goes unvisited for a while, or space runs low - so keep a backup.";

const PERSIST_TEXT = {
  persisted: "This browser has agreed to keep your data until you clear it yourself.",
  "not-persisted": MAY_CLEAR,
  unsupported: MAY_CLEAR,
};

/** "1 entry", "1,276 entries", "2 years". */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

const entryCount = (n: number) => plural(n, "entry", "entries");

/** An import waiting on "Replace?": the file, as read and checked, and the year it would replace. */
interface PendingReplace {
  fileName: string;
  data: unknown;
  file: YearFile;
  stored: YearSummary;
}

/**
 * The question before an import replaces a stored year: what is here now and what the file holds,
 * side by side, with the rows that differ highlighted. Esc, Cancel or a click on the backdrop keeps
 * the stored year.
 */
function ReplaceDialog(props: { pending: PendingReplace; onCancel: () => void; onReplace: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const { fileName, file, stored } = props.pending;
  const at = new Date(file.exportedAt);
  const exported = Number.isNaN(at.getTime())
    ? "No export date"
    : `Exported ${at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  // The latest change of either kind, entries or setup, as the strip under the top bar shows it.
  // A file without one was saved before files carried it, so anything changed here is newer.
  const here = lastUpdatedAt(stored.setup);
  const there = lastUpdatedAt(file);
  const newerHere = here !== undefined && (there === undefined || Date.parse(here) > Date.parse(there));
  const counts = { expenses: file.expenses.length, earnings: file.earnings.length, transfers: file.transfers.length };
  const total = (c: typeof counts) => c.expenses + c.earnings + c.transfers;
  const rows: { label: string; now: string; inFile: string; compare: boolean }[] = [
    { label: "Expenses", now: stored.expenses.toLocaleString(), inFile: counts.expenses.toLocaleString(), compare: true },
    { label: "Earnings", now: stored.earnings.toLocaleString(), inFile: counts.earnings.toLocaleString(), compare: true },
    { label: "Transfers", now: stored.transfers.toLocaleString(), inFile: counts.transfers.toLocaleString(), compare: true },
    { label: "Total entries", now: total(stored).toLocaleString(), inFile: total(counts).toLocaleString(), compare: true },
    { label: "Last updated", now: updatedText(here), inFile: updatedText(there), compare: true },
    // A backup and an export are different events, so this row is context, never a difference.
    { label: "Backup", now: backupText(stored.setup.lastBackupAt), inFile: exported, compare: false },
  ];
  return (
    <dialog ref={dialog} class="guide replace-dialog" aria-labelledby="replace-title"
      onClose={props.onCancel}
      // A click on the backdrop lands on the dialog itself: cancel, like Esc does.
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
      <div class="guide-body">
        <h2 id="replace-title" tabIndex={-1} autofocus>Replace your {file.year} data?</h2>
        <p>"{fileName}" holds {file.year} too. Importing it replaces everything the tracker has for {file.year}.</p>
        <table class="compare">
          <thead>
            <tr>
              <th></th>
              <th>In the tracker</th>
              <th>In the file</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} class={r.compare && r.now !== r.inFile ? "differs" : undefined}>
                <th scope="row">{r.label}</th>
                <td>{r.now}</td>
                <td>{r.inFile}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {newerHere && <p class="warn">The tracker has newer changes than this file: replacing it loses them.</p>}
        <p class="muted">This can't be undone.</p>
        <div class="form-actions">
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" class="danger-solid" onClick={props.onReplace}>Replace {file.year}</button>
        </div>
      </div>
    </dialog>
  );
}

/** With seconds: two backups taken minutes apart must still read differently. */
function updatedText(iso: string | undefined): string {
  return iso ? dateTime(iso, true) : "Unknown";
}

export function SettingsView() {
  const message = useSignal<string | null>(null);
  const errors = useSignal<string[]>([]);
  /** The year whose "Close year" panel is open. */
  const closing = useSignal<number | null>(null);
  /** The year whose row is asking "Delete …?". */
  const deleting = useSignal<number | null>(null);
  /** An import asking whether to replace a stored year. */
  const replacing = useSignal<PendingReplace | null>(null);

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
      // Reloaded first: the list is from when the year was opened, and the question compares
      // entry counts and last-updated times with what's stored now.
      await refreshYears();
      const stored = years.value.find((y) => y.setup.year === year);
      if (stored) {
        replacing.value = { fileName: file.name, data, file: check.file, stored };
        return;
      }
      await finishImport(file.name, data, year);
    } catch (err) {
      message.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function finishImport(fileName: string, data: unknown, year: number) {
    try {
      await importYear(data);
      message.value = `Imported ${year} from "${fileName}".`;
      await Promise.all([openYear(year), loadSettings()]);
    } catch (err) {
      message.value = err instanceof Error ? err.message : String(err);
    }
  }

  function onReplace() {
    const pending = replacing.value;
    replacing.value = null;
    if (pending) void finishImport(pending.fileName, pending.data, pending.file.year);
  }

  async function onExport(year: number) {
    errors.value = [];
    try {
      await backUpYear(year);
    } catch (err) {
      message.value = `The backup of ${year} didn't work: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return (
    <>
    <section class="panel">
      <h2>Your data</h2>
      {replacing.value && (
        <ReplaceDialog pending={replacing.value} onCancel={() => (replacing.value = null)} onReplace={onReplace} />
      )}

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
                <td class="y-year">
                  {setup.year}
                  {setup.closed && <span class="badge">closed</span>}
                </td>
                <td class="num y-count" data-label="Expenses">{expenses}</td>
                <td class="num y-count" data-label="Earnings">{earnings}</td>
                <td class="num y-count" data-label="Transfers">{transfers}</td>
                <td class="y-backup">{backupText(setup.lastBackupAt)}</td>
                <td class="y-actions">
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
                    // Icons, as on the Accounts page: each says what it does in its tooltip.
                    <div class="row-actions">
                      <IconButton icon="export" label={`Export ${setup.year} as JSON`}
                        title="Export JSON: download this year as a backup file" onClick={() => onExport(setup.year)} />
                      {setup.closed ? (
                        <IconButton icon="reopen" label={`Reopen ${setup.year}`}
                          title="Reopen: make this year editable again" onClick={() => onReopen(setup.year)} />
                      ) : (
                        <IconButton icon="close" label={`Close ${setup.year}…`}
                          title="Close year…: it's finished. It stops taking changes, and the next year starts from its closing balances."
                          onClick={() => (closing.value = setup.year)} />
                      )}
                      <IconButton icon="delete" danger label={`Delete ${setup.year}…`}
                        title="Delete…: remove this year from this browser. Import its backup to bring it back."
                        onClick={() => (deleting.value = setup.year)} />
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
        Import JSON
        <input type="file" accept=".json,application/json" onChange={onImport} hidden />
      </label>
      <DemoDownload />

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
    <InstallCard />
    <AboutCard />
    </>
  );
}

/** A ready-made year to import and look around in, before entering your own money. */
function DemoDownload() {
  const year = Number(localToday().slice(0, 4));
  const have = years.value.some((y) => y.setup.year === year);
  return (
    <p class="muted small demo-download">
      New here?{" "}
      <DemoLink>Download a demo file</DemoLink>{" "}
      and import it to look around: a household of two with this year so far, with every kind of account
            and entry, a loan, investments and a car, and accounts that were closed.
      {have && <> It is a {year} file, so importing it would replace your own {year} (you'll be asked first).</>}
    </p>
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
        {/* No Today link: the box starts on today, and a link would split the sentence. */}
        <DateInput value={day.value} min={`${year}-01-01`} max={`${year}-12-31`} todayLink={false}
          onFocus={() => (fromJan.value = false)} onChange={(d) => { day.value = d; fromJan.value = false; }} />
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
      <label class="check-row">
        <input type="checkbox" checked={numbersHidden.value} onChange={(e) => setNumbersHidden(e.currentTarget.checked)} />
        Hide the numbers
      </label>
      <p class="muted small">
        When ticked, the amounts on the Dashboard, Reports, Budget, Accounts and Over the years pages, the totals above the Ledger and the balances when closing a year, show as {HIDDEN_AMOUNT}. Also kept on this device only.
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
        <button type="button" class="striped" disabled={checking.value} onClick={onCheck}>
          {checking.value ? "Checking…" : "Check for updates"}
        </button>
        {/* Once a newer version is in, that's the news, whatever the check last said. */}
        {updateReady.value ? (
          <>
            <span class="muted" role="status">v{updateReady.value} is ready.</span>
            <button type="button" class="primary" onClick={() => location.reload()}>Reload</button>
          </>
        ) : note.value && <span class="muted" role="status">{note.value}</span>}
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
  const what = years.value.length ? `${entryCount(entries)} in ${plural(years.value.length, "year")}` : "everything";

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

/**
 * On the home screen: a real Install button where the browser lends its prompt, and that
 * browser's own steps where it doesn't. The prompt can arrive after the page is drawn, so the
 * card follows installState.
 */
function InstallCard() {
  const note = useSignal<string | null>(null);
  const now = installState.value;

  async function onInstall() {
    const outcome = await promptInstall();
    note.value = outcome === "dismissed" ? "Not installed. The steps are here if you change your mind."
      : outcome === "unavailable" ? "The browser wouldn't install it from here. Try the steps instead."
      : null;
  }

  return (
    <section class="panel settings">
      <h2>On your home screen</h2>
      <p class="muted">
        Installed, it opens from its own icon in a window of its own, with or without a signal,
        with no address to type.
      </p>
      <p class="muted">
        {now === "running" ? "You are using the installed tracker."
          : now === "installed" ? "Installed. From now on, open it from its icon."
          : now === "prompt" ? "This browser can install it in one tap."
          : installSteps(detectDevice()).map((s) => (typeof s === "string" ? s : <b>{s.b}</b>))}
      </p>
      {(now === "prompt" || note.value) && (
        <div class="setting-row">
          {now === "prompt" && <button type="button" class="primary" onClick={onInstall}>Install</button>}
          {note.value && <span class="muted" role="status">{note.value}</span>}
        </div>
      )}
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
        {!locked && <button type="submit" class="striped">Save</button>}
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
  const day = shortDate(yearStart(setup));
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
        {!locked && <button type="submit" class="striped">Save</button>}
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
  const closingBal = closingBalances(data.setup, l);
  const nextExists = years.value.some((y) => y.setup.year === year + 1);
  const notOver = new Date().getFullYear() <= year;

  async function onClose() {
    busy.value = true;
    try {
      await backUpYear(year);
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
                {/* An asset has no balance: what carries over is its last value. */}
                <td class="num">{a.type === "asset" ? "" : maskedCents(closingBal.get(a.id) ?? 0)}</td>
                <td class="num">
                  {a.type === "asset" ? (a.valuations ? maskedCents(a.valuations[0]!.amount) : "") : maskedCents(a.opening)}
                  {a.type === "investment" && <span class="muted small"> (contributions start again)</span>}
                  {a.type === "asset" && <span class="muted small">{a.valuations ? " (value carried over)" : " (no value yet)"}</span>}
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
