// Synchronous auth guard. Externalized from staff/tasks.html inline <script> (S9+F5 Phase C)
// so the page runs under the enforced strict CSP. Loaded as a NON-deferred classic script
// immediately after auth-helper.js so it still runs synchronously, before body render,
// exactly as the original inline guard did. Verbatim move — no logic change.
checkAuthOrRedirect();
