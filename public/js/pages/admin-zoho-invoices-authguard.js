// admin-zoho-invoices auth guard — externalized from admin-zoho-invoices.html (S9+F5 strict CSP).
// SYNC (non-deferred), loaded right after auth-helper.js so the redirect fires before
// the body renders, exactly as the original inline guard did. Verbatim move — no logic change.
requireAdminOrRedirect();
