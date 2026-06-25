// admin-whatsapp-chat auth guard — externalized from admin-whatsapp-chat.html (S9+F5 strict CSP).
// SYNC (non-deferred), loaded right after auth-helper.js so redirects fire before
// the body renders. Pure localStorage guard with no DOM dependency.
requireAdminOrRedirect();
