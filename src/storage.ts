// Ask the browser to keep our data even when disk space runs low.
// Without this, IndexedDB is "best effort" and the browser may clear it.

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
