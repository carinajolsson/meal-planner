// Caches this site's files so it opens offline.
// Bump VERSION whenever you change any file, so devices pick up the new version.
// If you add new files (images, scripts), add them to FILES.
const VERSION = "2";
const FILES = [
  "./",
  "./index.html",
  "./config.js",
  "./dropbox-sync.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

// Cache names include this site's path, so sites sharing a domain
// (username.github.io/site-a/ and /site-b/) never touch each other's caches.
const PREFIX = "pwa:" + new URL(self.registration.scope).pathname + ":";
const CACHE = PREFIX + VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Leave Dropbox and anything else off-site alone.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Pages: network first so updates arrive, cached copy when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match("./index.html")))
    );
    return;
  }

  // Other files: cache first, network as fallback.
  event.respondWith(
    caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req)))
  );
});
