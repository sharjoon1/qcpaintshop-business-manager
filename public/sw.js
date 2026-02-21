// QC Manager Service Worker - Minimal offline fallback only
// Does NOT aggressively cache assets/API — keeps the app always live
const CACHE_NAME = 'qc-manager-v1';
const OFFLINE_URL = '/offline.html';

// Install: cache only the offline fallback page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_URL]);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first, fallback to offline page for navigation requests
self.addEventListener('fetch', (event) => {
  // Only handle navigation requests (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
  }
  // All other requests (API, assets) go straight to network — no caching
});

// Push: display push notifications from server
self.addEventListener('push', (event) => {
  let payload = { title: 'Quality Colours', body: '', icon: '/icons/icon-192x192.png', badge: '/icons/icon-72x72.png', data: {} };

  if (event.data) {
    try {
      const json = event.data.json();
      payload = { ...payload, ...json };
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: payload.badge || '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    tag: payload.data?.type || 'qc-notification',
    renotify: true,
    data: payload.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// Notification click: open appropriate URL based on notification type
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const type = data.type || '';

  // Map notification types to deep link paths
  let path = '/staff/dashboard.html';
  switch (type) {
    case 'chat_message':
      path = data.conversation_id ? `/chat.html?conversation=${data.conversation_id}` : '/chat.html';
      break;
    case 'task_assigned':
    case 'task_completed':
      path = '/staff-requests.html';
      break;
    case 'advance_approved':
    case 'advance_rejected':
    case 'salary_generated':
    case 'salary_paid':
      path = '/staff/dashboard.html';
      break;
    case 'permission_approved':
    case 'permission_rejected':
      path = '/staff/permission-request.html';
      break;
    case 'stock_check_assigned':
      path = '/staff/stock-check.html';
      break;
    case 'stock_check_submitted':
      path = '/admin-stock-check.html';
      break;
    case 'break_exceeded':
      path = '/staff/clock-out.html';
      break;
    case 'force_clockout':
    case 'geo_auto_clockout':
      path = '/staff/history.html';
      break;
    case 'geo_auto_clockout_admin':
    case 'reclockin_request':
      path = '/admin-attendance.html';
      break;
    case 'new_registration':
      path = '/admin-staff-registrations.html';
      break;
    case 'profile_updated':
      path = '/admin-profile.html';
      break;
  }

  const urlToOpen = new URL(path, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if already open
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
