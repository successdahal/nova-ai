/* Success AI service worker — caches the app shell only. API calls are never cached. */
const CACHE = "success-ai-shell-v3";
const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/core.js",
  "js/render.js",
  "js/platform.js",
  "js/chat.js",
  "js/image.js",
  "js/video.js",
  "js/music.js",
  "js/documents.js",
  "js/build.js",
  "js/library.js",
  "js/boot.js",
  "manifest.webmanifest",
  "icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network-first for the app shell so updates appear immediately; cache is the offline fallback.
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("index.html")))
  );
});
