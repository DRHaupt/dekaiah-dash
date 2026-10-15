// Service worker: shows notifications and lets the app be added to the home screen.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Dekaiah Dash', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Dekaiah Dash', {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    vibrate: [200, 100, 200],
    requireInteraction: data.tag === 'request',
  }));
});

// Tapping a notification opens the app (or brings it to the front).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow('/');
  })());
});
