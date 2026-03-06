// QC Manager Service Worker - Minimal offline fallback only
// Does NOT aggressively cache assets/API — keeps the app always live
const CACHE_NAME = 'qc-manager-v2';
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

  // Data-based deep links (highest priority)
  let path = null;

  if (data.conversation_id) {
    path = `/chat.html?conversation=${data.conversation_id}`;
  } else if (data.lead_id) {
    path = `/staff-leads.html?lead=${data.lead_id}`;
  } else if (data.estimate_id) {
    path = `/staff-estimates.html?id=${data.estimate_id}`;
  } else if (data.pdf_url) {
    path = data.pdf_url;
  }

  // Type-based navigation (if no data deep link)
  if (!path) {
    const routes = {
      // Chat
      'chat_message':             '/chat.html',
      // Attendance
      'attendance_report':        '/staff/dashboard.html',
      'admin_attendance_report':  '/admin-attendance.html',
      'clock_in':                 '/staff/dashboard.html',
      'clock_out':                '/staff/dashboard.html',
      'break_start':              '/staff/dashboard.html',
      'break_end':                '/staff/dashboard.html',
      'break_exceeded':           '/staff/dashboard.html',
      'outside_work_start':       '/staff/dashboard.html',
      'outside_work_end':         '/staff/dashboard.html',
      'prayer_start':             '/staff/dashboard.html',
      'prayer_end':               '/staff/dashboard.html',
      'force_clockout':           '/staff/history.html',
      'geo_auto_clockout':        '/staff/history.html',
      'geo_auto_clockout_admin':  '/admin-attendance.html',
      'geofence_violation':       '/staff/dashboard.html',
      'reclockin_request':        '/admin-attendance.html',
      // Permissions
      'permission_approved':      '/staff/permission-request.html',
      'permission_rejected':      '/staff/permission-request.html',
      // Stock
      'stock_check_assigned':     '/staff/stock-check.html',
      'stock_check_submitted':    '/admin-stock-check.html',
      // Tasks
      'task_assigned':            '/staff-daily-work.html',
      'task_completed':           '/staff-daily-work.html',
      // Leads
      'lead_assigned':            '/staff-leads.html',
      'lead_created':             '/staff-leads.html',
      'lead_creation_alert':      '/staff-leads.html',
      'lead_overdue_alert':       '/staff-leads.html',
      'lead_followup_reminder':   '/staff-leads.html',
      // Salary
      'salary_generated':         '/staff/dashboard.html',
      'salary_paid':              '/staff/dashboard.html',
      'advance_approved':         '/staff/dashboard.html',
      'advance_rejected':         '/staff/dashboard.html',
      'document':                 '/staff/dashboard.html',
      // Estimates
      'estimate_shared':          '/staff-estimates.html',
      'estimate_approved':        '/staff-estimates.html',
      'estimate_rejected':        '/staff-estimates.html',
      // Credit
      'credit_limit_request_new':      '/admin-credit-limits.html',
      'credit_limit_request_resolved': '/admin-credit-limits.html',
      // System
      'system_alert':             '/admin-system-health.html',
      'new_registration':         '/admin-staff-registrations.html',
      'profile_updated':          '/staff/dashboard.html',
      'admin_notice':             '/staff/dashboard.html',
    };
    path = routes[type] || '/staff/dashboard.html';
  }

  const urlToOpen = new URL(path, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if already open on same page
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
