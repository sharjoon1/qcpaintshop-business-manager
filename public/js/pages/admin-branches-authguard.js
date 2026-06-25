// Synchronous auth guard. Externalized from the page inline <script> (S9+F5 Phase C, 2026-06-25)
// so admin-branches.html runs under the enforced strict CSP. Loaded as a NON-deferred
// classic script immediately after auth-helper.js so it still runs synchronously, before body
// render, exactly as the original inline guard did. Verbatim move — no logic change.
requireAdminOrRedirect();
