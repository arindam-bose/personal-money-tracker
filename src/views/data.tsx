// Data view: import a year from JSON, export (back up) a stored year.

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { downloadYear, importYear, readJsonFile } from "../backup";
import { formatCents, parseCents } from "../money";
import { balances } from "../derive";
import { nextYearSetup } from "../rollover";
import {
  closeYear, current, iraLimit, ledger, openYear, persistState, reopenYear, saveIraLimit, startYear, years,
} from "../state";
import { daysSince, requestPersistence } from "../storage";
import { validateYearFile } from "../validate";

const PERSIST_TEXT = {
  persisted: "Your browser will keep this data even when disk space runs low.",
  "not-persisted": "Your browser may clear this data if disk space runs low. Back up regularly. Browsers often agree to keep it once you've bookmarked or used the site for a while.",
  unsupported: "This browser can't promise to keep this data. Back up regularly.",
};

function backupText(iso: string | undefined): string {
  const days = daysSince(iso);
  if (days === null) return "Never backed up";
  if (days <= 0) return "Backed up today";
  return `Last backup ${days} day${days === 1 ? "" : "s"} ago`;
}

export function DataView() {
  const message = useSignal<string | null>(null);
  const errors = useSignal<string[]>([]);
  /** The year whose "Close year" panel is open. */
  const closing = useSignal<number | null>(null);

  async function onStart() {
    await startYear(new Date().getFullYear());
    location.hash = "#/accounts";
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
      if (years.value.some((y) => y.setup.year === year)) {
        if (!confirm(`Replace all your ${year} data with "${file.name}"? This can't be undone.`)) return;
      }
      await importYear(data);
      message.value = `Imported ${year} from "${file.name}".`;
      await openYear(year);
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

      {years.value.length === 0 ? (
        <div class="start-options">
          <p>No data yet. Import a Money Tracker JSON file below, or start from scratch.</p>
          <button type="button" class="primary" onClick={onStart}>Start {new Date().getFullYear()} from scratch</button>
          <p class="muted small">You'll get the standard categories, then add your accounts.</p>
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
                  <div class="row-actions">
                    <button type="button" onClick={() => onExport(setup.year)}>
                      Export JSON
                    </button>
                    {setup.closed ? (
                      <button type="button" onClick={() => onReopen(setup.year)}>Reopen</button>
                    ) : (
                      <button type="button" onClick={() => (closing.value = setup.year)}>Close year…</button>
                    )}
                  </div>
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
    <Settings />
    </>
  );
}

function Settings() {
  const text = useSignal(formatCents(iraLimit.value).replace(/[$,]/g, ""));
  const note = useSignal<string | null>(null);

  async function onSave(e: Event) {
    e.preventDefault();
    const cents = parseCents(text.value);
    if (cents === null) {
      note.value = "Enter an amount like 7500.";
      return;
    }
    await saveIraLimit(cents);
    note.value = `Saved: ${formatCents(cents)} a year.`;
  }

  return (
    <section class="panel settings">
      <h2>Settings</h2>
      <form onSubmit={onSave} class="setting-row">
        <label class="field">
          <span class="field-label">Annual IRA contribution limit</span>
          <input type="text" inputMode="decimal" class="num" value={text.value}
            onInput={(e) => { text.value = e.currentTarget.value; note.value = null; }} />
        </label>
        <button type="submit">Save</button>
        {note.value && <span class="muted" role="status">{note.value}</span>}
      </form>
      <p class="muted small">The dashboard shows how much of this is left after this year's retirement transfers.</p>
    </section>
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
