// Offline support: the app's own files are cached when it's installed, so it opens with no signal.
// Your data is never sent anywhere; it lives in the browser's storage on this phone.
const VERSION = "mycotrack-0.7.0";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/core.js", "js/store.js", "js/state.js", "js/views.js", "js/forms.js", "js/scan.js",
  "vendor/sql-wasm.js", "vendor/sql-wasm.wasm", "vendor/jsQR.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
  "data/empty.db", "data/demo.db",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ||
    fetch(e.request).catch(() => (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
