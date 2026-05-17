// Forge PWA service worker
// Bump CACHE_VERSION wanneer je updates uitrolt zodat clients vernieuwen
const CACHE_VERSION = 'forge-v18';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './leaflet.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

// Origins die de service worker mag intercepten (voor offline cache).
const CACHEABLE_ORIGINS = [
  self.location.origin,
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(ASSETS).catch((err) => {
        console.warn('[SW] Some assets failed to cache:', err);
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Network-first voor HTML, cache-first voor assets, bypass voor externe API's
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (!CACHEABLE_ORIGINS.includes(url.origin)) {
    return;
  }

  const isHTML = req.headers.get('accept')?.includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('./index.html')))
    );
  } else {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});

// ============ PUSH NOTIFICATIONS ============

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Forge', body: event.data?.text() || '' };
  }

  const title = data.title || 'Forge';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'forge-' + Date.now(),
    renotify: !!data.tag,
    requireInteraction: false,
    data: {
      url: data.url || './',
      action: data.action || null,
      ...(data.data || {})
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Als Forge al open is, focus erop
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Anders open nieuwe window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Push subscription kan wisselen (bv. na re-install) — re-subscribe
self.addEventListener('pushsubscriptionchange', (event) => {
  // Stuur bericht naar de pagina dat re-subscribe nodig is
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({ type: 'PUSH_RESUBSCRIBE_NEEDED' });
      });
    })
  );
});
