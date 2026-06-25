// Synchronous auth guard. Externalized from the page inline <script> (S9+F5 Phase E batch 11,
// 2026-06-25) so staff-incentives.html runs under the enforced strict CSP. Loaded as a
// NON-deferred classic script immediately after auth-helper.js so it runs synchronously,
// before body render, exactly as the original inline guard did. Verbatim move — no logic change.
checkAuthOrRedirect();
