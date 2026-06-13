// estimate-edit.html is superseded by estimate-create-new.html — this page only
// forwards (preserving ?id=). PAGE-050: its old inline editor was unreachable dead
// code (this redirect runs before <body>) that recomputed GST at 18%, violating the
// GST-INCLUSIVE policy (gst_amount must stay 0). Removed so that math can never be
// reached, re-enabled, or copied.
// Externalized from the page's inline <script> (S9+F5 Phase C, 2026-06-13) so the
// page can run under the enforced strict CSP (no 'unsafe-inline').
const id = new URLSearchParams(window.location.search).get('id');
window.location.replace('estimate-create-new.html' + (id ? '?id=' + id : ''));
