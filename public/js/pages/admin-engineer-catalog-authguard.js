// admin-engineer-catalog auth guard — externalized from admin-engineer-catalog.html (S9+F5 strict CSP).
// SYNC (non-deferred), loaded right after auth-helper.js so the redirect fires before
// the body renders. Pure localStorage guard with no DOM dependency.
requireAdminOrRedirect();
