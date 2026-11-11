// Offline support. Pages and files are fetched from the network first, so a new deploy shows up straight
// away; the cached copy is used only when the network fails. Live data (/api) is never cached here:
// the page keeps its own last prices and shows how old they are.
const CACHE = "wm-v1";
const SHELL = ["/", "/styles.css", "/app.js", "/auth.js", "/lib/core.js", "/data/markets.js", "/data/india.js", "/data/stocks.js", "/data/macro.js", "/data/holidays.js", "/data/calendar.js", "/data/firebase.js", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_vercel/")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined)))
  );
});
