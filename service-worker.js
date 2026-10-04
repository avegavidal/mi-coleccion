/* Service Worker — JS/CSS/HTML siempre red (sin cache) para no atrapar versiones viejas en iPhone */
const CACHE = 'mi-coleccion-v63';
const PRECACHE = [
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
      Promise.all(keys.map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_ALL') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return (
    p.endsWith('.js') ||
    p.endsWith('.css') ||
    p.endsWith('.html') ||
    p.endsWith('/') ||
    /\/mi-coleccion\/?$/.test(p)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('ebay.com') ||
    url.hostname.includes('mercadolibre') ||
    url.pathname.includes('match_item_images')
  ) {
    return;
  }

  // App shell: solo red, sin guardar en Cache API (evita 1.5.9 eterno en PWA)
  if (isAppShell(url)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && url.origin === self.location.origin && !isAppShell(url)) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
