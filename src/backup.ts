// JSON import and export. The exported file is the real backup: it holds one whole year,
// in the same shape the importer and tools/notion_import.py produce.

import { getSetting, loadYear, putSetup, replaceYear, setSetting } from "./db";
import { detectDevice, type Device } from "./device";
import { iraLimitOf, withChange, withoutPeople } from "./setup";
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
    iraLimit: iraLimitOf(setup),
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

/**
 * "money-tracker-2026_2026-10-25_21-30-05_chrome_linux.json": the year, then when the backup
 * was taken on the reader's own clock (UTC would date an evening's backup tomorrow in the
 * Americas), then the browser and system. The time is hyphenated because Windows won't have
 * a colon in a file name, and to the second so two backups on one day never overwrite each other.
 * A browser or system that can't be made out is left out.
 */
export function backupFileName(year: number, at: Date, device: Device): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  const time = `${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
  const names = [device.browser, device.system].filter((x): x is string => !!x)
    .map((x) => x.toLowerCase().replace(/\s+/g, "-"));
  return [`money-tracker-${year}`, date, time, ...names].join("_") + ".json";
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
  const now = new Date();
  const file = await exportYear(year, now);
  if (!file) throw new Error(`There is no data for ${year}.`);
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName(year, now, detectDevice());
  a.click();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await markBackedUp(year, now);
}
