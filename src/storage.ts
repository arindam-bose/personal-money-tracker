// Ask the browser to keep our data even when disk space runs low.
// Without this, IndexedDB is "best effort" and the browser may clear it.
// Also when to remind about a backup, the other half of keeping the data safe.

import type { YearSetup } from "./types";

export type PersistState = "persisted" | "not-persisted" | "unsupported";

export async function requestPersistence(): Promise<PersistState> {
  if (!navigator.storage?.persist) return "unsupported";
  if (await navigator.storage.persisted()) return "persisted";
  return (await navigator.storage.persist()) ? "persisted" : "not-persisted";
}

/** Whole days since an ISO timestamp, or null if there is none. */
export function daysSince(iso: string | undefined, now = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/** Remind about backups after this many days. */
const BACKUP_AFTER_DAYS = 7;

/** How long ago the last backup was, in words, for the top bar and the Settings page. */
export function backupText(iso: string | undefined, now = new Date()): string {
  const days = daysSince(iso, now);
  if (days === null) return "Never backed up";
  if (days <= 0) return "Backed up today";
  return `Last backup ${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Whether the top bar should remind about a backup: never for a closed year or one with no entries;
 * otherwise if it was never backed up, or it changed since a backup taken a week or more ago.
 * A change is to the entries or to the setup (accounts, budgets and so on).
 * A finished year nobody touches stays quiet. No entry change time (old data) counts as changed.
 */
export function backupDue(setup: Pick<YearSetup, "closed" | "lastBackupAt" | "lastChangedAt" | "setupChangedAt">, hasEntries: boolean, now = new Date()): boolean {
  if (setup.closed || !hasEntries) return false;
  const days = daysSince(setup.lastBackupAt, now);
  if (days === null) return true;
  const after = (at: string | undefined) => at !== undefined && Date.parse(at) > Date.parse(setup.lastBackupAt!);
  const changed = !setup.lastChangedAt || after(setup.lastChangedAt) || after(setup.setupChangedAt);
  return changed && days >= BACKUP_AFTER_DAYS;
}
