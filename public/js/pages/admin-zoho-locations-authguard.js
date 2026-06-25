// Synchronous auth guard. Externalized from admin-zoho-locations.html inline <script>
// (S9+F5 Phase E batch 11, 2026-06-25) so the page runs under the enforced strict CSP.
// Loaded as a NON-deferred classic script immediately after auth-helper.js so it runs
// synchronously, before body render, exactly as the original inline guard did.
// Verbatim move — no logic change.
requireAdminOrRedirect();
