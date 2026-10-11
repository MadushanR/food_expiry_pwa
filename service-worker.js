const CACHE_NAME = "freshcheck-shell-v12";
const APP_SHELL = [
  "./", "./index.html", "./style.css", "./style.css?v=12", "./app.js", "./app.js?v=11", "./utils.js", "./storage.js", "./grocery-data.js",
  "./manifest.json", "./manifest.json?v=12", "./vendor/zxing-browser.min.js", "./vendor/ZXING-LICENSE.txt",
  "./icons/logo.png", "./icons/logo-folded-check.png", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/folded-check-180.png", "./icons/folded-check-192.png", "./icons/folded-check-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
