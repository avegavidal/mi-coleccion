/* Service Worker — cache básico de interfaz (no datos privados de colección) */
const CACHE = 'mi-coleccion-v2';
const PRECACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/app.js',
  './manifest.json',
  './assets/icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No cachear APIs, storage firmado ni modelos HF (demasiado grandes / privados)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('googleapis.com') ||
    url.pathname.includes('match_item_images')
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
