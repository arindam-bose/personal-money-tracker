// Data view: import a year from JSON, export (back up) a stored year.

import { useSignal } from "@preact/signals";
import { downloadYear, importYear, readJsonFile } from "../backup";
import { current, openYear, persistState, years } from "../state";
import { daysSince } from "../storage";
import { validateYearFile } from "../validate";

const PERSIST_TEXT = {
  persisted: "Your browser will keep this data even when disk space runs low.",
  "not-persisted": "Your browser may clear this data if disk space runs low. Back up regularly.",
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
    <section class="panel">
      <h2>Your data</h2>
      {persistState.value && <p class="muted">{PERSIST_TEXT[persistState.value]}</p>}

      {years.value.length === 0 ? (
        <p>No data yet. Import a Money Tracker JSON file to start.</p>
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
                  <button type="button" onClick={() => onExport(setup.year)}>
                    Export JSON
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  );
}
