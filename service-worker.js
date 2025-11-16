const CACHE_NAME = "expiry-tracker-v2";
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",
  "/service-worker.js",
  "/style.css",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
