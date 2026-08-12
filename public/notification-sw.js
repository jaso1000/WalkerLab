// WalkerLab push-notification service worker. Plain JS, no build step -
// runs directly in the browser's service worker context. Copied verbatim
// to the web export root by Expo's own `public/` passthrough (same as
// manifest.json and the PWA icons alongside it). Registered from
// src/lib/notificationsApi.web.ts's registerForPushNotificationsAsync().
self.addEventListener('push', (event) => {
  let title = 'WalkerLab';
  let body = '';
  try {
    const data = event.data ? event.data.json() : {};
    title = data.title || title;
    body = data.body || body;
  } catch (e) {
    body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
