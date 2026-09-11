// Leb - Service Worker v4.9.9 (100% Solid Crisp Zero-Blur Header System Bar)
const CACHE_VERSION = 'v4.9.9';
const CACHE_NAME = `leb-app-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/header-logo.svg',
  './icons/wallpaper.jpg',
  './icons/apple-touch-icon-180.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './icons/favicon.png'
];

// 1. Install - Precache and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 2. Activate - Clear all old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch - Network-First for App Shell (HTML, JS, CSS, Manifest) so updates appear instantly
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  // Firebase Realtime DB must bypass SW completely
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebasedatabase.app')) {
    return;
  }

  // Network-First for Navigation, App Code, Manifest and Icons
  const isCodeOrDoc = event.request.mode === 'navigate' ||
                      event.request.destination === 'document' ||
                      url.pathname.endsWith('.html') ||
                      url.pathname.endsWith('.js') ||
                      url.pathname.endsWith('.css') ||
                      url.pathname.endsWith('.webmanifest') ||
                      url.pathname.includes('/icons/');

  if (isCodeOrDoc) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return caches.match('./index.html') || caches.match('./');
        })
    );
    return;
  }

  // Cache-First for other assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    })
  );
});

// 4. Message & Scheduled Compliance Notification Support
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = event.data;
    self.registration.showNotification(title || 'Leb', {
      body: body || '',
      tag: tag || 'leb-compliance',
      icon: 'icons/apple-touch-icon-180.png?v=3.6.0',
      badge: 'icons/favicon.png?v=3.9.0',
      vibrate: [200, 100, 200],
      data: { url: './' }
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});

// 5. Web Push Notification Event (Delivers alerts when app/device is closed)
self.addEventListener('push', (event) => {
  let payload = { title: 'Leb', body: '' };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = { title: 'Leb', body: event.data.text() };
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Leb', {
      body: payload.body || '',
      icon: 'icons/apple-touch-icon-180.png?v=3.6.0',
      badge: 'icons/favicon.png?v=3.9.0',
      tag: payload.tag || 'leb-compliance',
      vibrate: [200, 100, 200],
      data: { url: './' }
    })
  );
});
