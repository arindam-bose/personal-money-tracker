// The offline copy, seen from the page: registering the service worker (src/service-worker.js),
// what it holds, and checking for a newer release.

import { signal } from "@preact/signals";
import { version } from "../package.json";

/** The service worker names its cache after the release it holds. */
const CACHE_PREFIX = "money-tracker-v";

/** A newer release that is cached and shows once the page reloads, or null. */
export const updateReady = signal<string | null>(null);

/** Bumped when the offline copy changes, so the Settings page asks again what it holds. */
export const offlineChanged = signal(0);

/** Start the offline copy. Only in a build: development has no sw.js, so edits always show. */
export function registerOffline(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "offline-ready") return;
    offlineChanged.value++;
    if (event.data.version !== version) updateReady.value = event.data.version;
  });
  // `updateViaCache: "none"`, so a check for updates looks past the HTTP cache.
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch((err) => {
    console.warn("Offline copy unavailable:", err);
  });
}

/**
 * The release the offline copy holds, from its cache's name, or null. While an update
 * moves in, the old and new caches both exist for a moment; the new one is the answer.
 */
async function cachedRelease(): Promise<string | null> {
  if (!("caches" in self)) return null;
  const held = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => n.slice(CACHE_PREFIX.length));
  return held.find((v) => v !== version) ?? held[0] ?? null;
}

/** One line on whether the app works without a signal. */
export async function offlineStatus(): Promise<string> {
  if (!import.meta.env.PROD) return "The offline copy is off while developing; it starts in a build.";
  if (!("serviceWorker" in navigator)) return "This browser can't keep a copy of the app for use without a signal.";
  const cached = await cachedRelease();
  return navigator.serviceWorker.controller
    ? `Cached and ready to use without a signal${cached ? ` (v${cached})` : ""}.`
    : "Not cached yet. Reload once while online.";
}

/**
 * Ask the site for a newer release. Returns what to tell the user. A newer release
 * downloads by itself; once it is in, `updateReady` offers the reload.
 */
export async function checkForUpdates(): Promise<string> {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) return "The offline copy isn't running, so there is nothing to update.";
  try {
    await registration.update();
  } catch {
    return "Couldn't reach the site to check. Try again with a signal.";
  }
  const incoming = registration.installing ?? registration.waiting;
  if (incoming) return "Found a newer version. Downloading it now…";
  // A newer release may already have come in while this page kept running the old one.
  const cached = await cachedRelease();
  if (cached && cached !== version) {
    updateReady.value = cached;
    return `v${cached} is ready. Reload to use it.`;
  }
  return `You have the latest version (v${version}).`;
}
