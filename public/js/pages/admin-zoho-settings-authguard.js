// admin-zoho-settings auth guard — externalized from admin-zoho-settings.html (S9+F5 strict CSP).
// SYNC (non-deferred), loaded right after auth-helper.js so the redirect fires before
// the body renders. Pure localStorage guard with no DOM dependency.
requireAdminOrRedirect();
