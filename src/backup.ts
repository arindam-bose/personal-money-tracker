// JSON import and export. The exported file is the real backup: it holds one whole year,
// in the same shape the importer and tools/notion_import.py produce.

import { loadYear, putSetup, replaceYear } from "./db";
import type { YearFile } from "./types";
import { validateYearFile, type ValidationResult } from "./validate";

/** Build the backup file for a stored year, or null if the year isn't stored. */
export async function exportYear(year: number, now = new Date()): Promise<YearFile | null> {
  const data = await loadYear(year);
  if (!data) return null;
  const { setup } = data;
  return {
    app: "money-tracker",
    schema: 1,
    year,
    exportedAt: now.toISOString(),
    accounts: setup.accounts,
    categories: setup.categories,
    tags: setup.tags,
    ...(setup.members ? { members: setup.members } : {}),
    expenses: data.expenses,
    earnings: data.earnings,
    transfers: data.transfers,
    budgets: setup.budgets,
  };
}

/**
 * Validate parsed JSON and, if it is a valid year file, store it, replacing that year.
 * The file being imported is itself a backup, so it counts as the last backup.
 */
export async function importYear(data: unknown): Promise<ValidationResult> {
  const result = validateYearFile(data);
  if (result.ok) await replaceYear(result.file, { lastBackupAt: result.file.exportedAt });
  return result;
}

/** Record that a year was just backed up, for the "last backup" reminder. */
export async function markBackedUp(year: number, at = new Date()): Promise<void> {
  const data = await loadYear(year);
  if (data) await putSetup({ ...data.setup, lastBackupAt: at.toISOString() });
}

// --- Browser-only helpers ---

/** Read a user-picked file as JSON. Throws a readable message if it isn't JSON. */
export async function readJsonFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`"${file.name}" is not a valid JSON file.`);
  }
}

/** Save a year file through the browser's download, then mark the year as backed up. */
export async function downloadYear(year: number): Promise<void> {
  const file = await exportYear(year);
  if (!file) throw new Error(`There is no data for ${year}.`);
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `money-tracker-${year}.json`;
  a.click();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await markBackedUp(year);
}
