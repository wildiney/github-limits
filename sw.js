// This app shares an origin (the GitHub Pages user origin) with other apps such as claude-limits,
// so only ever touch caches that carry OUR prefix.
const CACHE_PREFIX = 'github-credits-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './logic.js',
    './manifest.json',
    './icon.svg'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
                    .map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Network first (fresh code after deploys), cache fallback (offline, incl. CDN scripts).
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        fetch(e.request)
            .then((res) => {
                if (res && (res.ok || res.type === 'opaque')) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
