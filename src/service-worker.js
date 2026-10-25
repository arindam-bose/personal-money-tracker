// The offline copy. Plain JavaScript, not part of the app bundle: the build (the
// serviceWorker plugin in vite.config.ts) fills in the two placeholders below and
// writes it out as sw.js next to index.html.
//
// Every built file has a content hash in its name, so a file never changes under the
// same name: everything is cached once on install and served from the cache. A new
// build lists new files, which makes sw.js itself new, so the browser installs it as
// an update. Only the page (index.html) is asked for over the network first, so an
// online visit always starts from the newest release.

const VERSION = "__VERSION__";
const FILES = __FILES__;
const PREFIX = "money-tracker-v";
const CACHE = PREFIX + VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Past the HTTP cache, so a fresh cache can't take in the last release's page.
    await cache.addAll(FILES.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Only this app's own old releases: other tools on the same site keep their caches.
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
    for (const client of await self.clients.matchAll({ type: "window" })) {
      client.postMessage({ type: "offline-ready", version: VERSION });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  if (request.mode === "navigate") {
    // The page: newest when online, the cached one without a signal.
    event.respondWith(fetch(request).catch(async () => (await caches.match("index.html", { cacheName: CACHE })) ?? Response.error()));
    return;
  }
  event.respondWith((async () => (await caches.match(request, { cacheName: CACHE })) ?? fetch(request))());
});
