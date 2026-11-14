// Importing a backup file: from Settings, the top bar's Import, or a file dropped on any page. One
// function for all three, so each checks the file the same way and asks before replacing a stored year.

import { importYear, readJsonFile } from "./backup";
import { loadSettings, openYear, refreshYears, years, type YearSummary } from "./state";
import type { YearFile } from "./types";
import { validateYearFile } from "./validate";

/** Whether to replace a stored year with the file's: the answer comes from the "Replace?" dialog. */
export type AskReplace = (fileName: string, stored: YearSummary, file: YearFile) => Promise<boolean>;

export type ImportOutcome =
  | { kind: "imported"; fileName: string; year: number; entries: number }
  /** A stored year, and the answer was to keep it. */
  | { kind: "kept"; fileName: string; year: number }
  /** Not JSON, or not a year file: nothing was stored. */
  | { kind: "failed"; fileName: string; errors: string[] };

/**
 * Import one file. It is checked before anything is asked or stored; a year already stored is
 * replaced only if `ask` says yes. The year imported is opened, with any settings it brought.
 */
export async function importFile(file: File, ask: AskReplace): Promise<ImportOutcome> {
  let data: unknown;
  try {
    data = await readJsonFile(file);
  } catch (err) {
    return { kind: "failed", fileName: file.name, errors: [err instanceof Error ? err.message : String(err)] };
  }
  const check = validateYearFile(data);
  if (!check.ok) return { kind: "failed", fileName: file.name, errors: check.errors };
  const { year } = check.file;
  // Reloaded first: the list is from when the year was opened, and the question compares entry
  // counts and last-updated times with what's stored now.
  await refreshYears();
  const stored = years.value.find((y) => y.setup.year === year);
  if (stored && !(await ask(file.name, stored, check.file))) return { kind: "kept", fileName: file.name, year };
  const r = await importYear(data);
  if (!r.ok) return { kind: "failed", fileName: file.name, errors: r.errors };
  await Promise.all([openYear(year), loadSettings()]);
  const f = r.file;
  return { kind: "imported", fileName: file.name, year, entries: f.expenses.length + f.earnings.length + f.transfers.length };
}
