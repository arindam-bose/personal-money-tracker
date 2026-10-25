// JSON import and export. The exported file is the real backup: it holds one whole year,
// in the same shape the importer and tools/notion_import.py produce.

import { getSetting, loadYear, putSetup, replaceYear, setSetting } from "./db";
import { withChange, withoutPeople } from "./setup";
import type { YearFile } from "./types";
import { validateYearFile, type ValidationResult } from "./validate";

/** Build the backup file for a stored year, or null if the year isn't stored. */
export async function exportYear(year: number, now = new Date()): Promise<YearFile | null> {
  const stored = await loadYear(year);
  if (!stored) return null;
  // A closed year saved before people were dropped still holds them in storage; the backup leaves them out.
  const cleaned = withoutPeople(stored);
  const data = cleaned ? withChange(stored, cleaned) : stored;
  const { setup } = data;
  const pinnedTags = await getSetting("pinnedTags");
  return {
    app: "money-tracker",
    schema: 1,
    year,
    exportedAt: now.toISOString(),
    ...(setup.closed ? { closed: true } : {}),
    accounts: setup.accounts,
    categories: setup.categories,
    tags: setup.tags,
    ...(setup.members ? { members: setup.members } : {}),
    expenses: data.expenses,
    earnings: data.earnings,
    transfers: data.transfers,
    budgets: setup.budgets,
    ...(setup.iraLimit !== undefined ? { iraLimit: setup.iraLimit } : {}),
    ...(pinnedTags?.length ? { settings: { pinnedTags } } : {}),
  };
}

/**
 * Validate parsed JSON and, if it is a valid year file, store it, replacing that year.
 * The file being imported is itself a backup, so it counts as the last backup.
 * Its app-wide settings are used only where this device has none yet, so restoring an old
 * year never undoes today's choices.
 */
export async function importYear(data: unknown): Promise<ValidationResult> {
  const result = validateYearFile(data);
  if (!result.ok) return result;
  const { file } = result;
  await replaceYear(file, { lastBackupAt: file.exportedAt });
  const pinned = file.settings?.pinnedTags;
  if (pinned && (await getSetting("pinnedTags")) === undefined) await setSetting("pinnedTags", pinned);
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
