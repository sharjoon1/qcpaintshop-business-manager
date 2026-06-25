// admin-reports auth guards — externalized from admin-reports.html (S9+F5 strict CSP).
// SYNC (non-deferred), loaded right after auth-helper.js so redirects fire before
// the body renders. Both are pure localStorage guards with no DOM dependency.
requireAdminOrRedirect();
if (!localStorage.getItem('auth_token')) {
    window.location.href = '/login.html';
}
