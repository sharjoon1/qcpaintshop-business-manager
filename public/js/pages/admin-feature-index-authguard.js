// Synchronous auth guard for admin-feature-index.html. Loaded as a NON-deferred classic
// script immediately after auth-helper.js so it runs synchronously, before body render.
// Mirrors the existing *-authguard.js pattern used across admin pages (e.g. admin-brands-authguard.js).
requireAdminOrRedirect();
