// Offline support: the app's own files are served from the cache first (so
// it opens instantly, even with no signal) and refreshed in the background.
// Google requests always go to the network.

const CACHE = "finance-drive-v13"; // bump on every release
const SHELL = [
    "./",
    "index.html",
    "styles.css",
    "config.js",
    "manifest.webmanifest",
    "js/app.js",
    "js/auth.js",
    "js/calc.js",
    "js/csv.js",
    "js/db.js",
    "js/drive.js",
    "js/importer.js",
    "js/merge.js",
    "js/quotes.js",
    "js/store.js",
    "js/sync.js",
    "js/ui.js",
    "js/util.js",
    "js/views/activity.js",
    "js/views/assets.js",
    "js/views/budget.js",
    "js/views/debt.js",
    "js/views/earnings.js",
    "js/views/overview.js",
    "js/views/settings.js",
    "icons/favicon.svg",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/logo-120.png",
    "icons/logo-256.png",
    "about.html",
    "privacy.html",
    "terms.html",
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    // Coming back from Google (#access_token=…) is just the same page; the
    // fragment never reaches the server, so the cached page works.
    const key = request.mode === "navigate" ? "./" : request;
    event.respondWith(
        caches.open(CACHE).then(async (cache) => {
            const cached = await cache.match(key, { ignoreSearch: request.mode === "navigate" });
            const fresh = fetch(request)
                .then((response) => {
                    if (response.ok) cache.put(key, response.clone());
                    return response;
                })
                .catch(() => cached);
            return cached || fresh;
        }),
    );
});
