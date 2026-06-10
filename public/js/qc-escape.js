/**
 * qc-escape.js — shared frontend escaper (F1).
 *
 * One canonical set of escaping helpers for interpolating untrusted data
 * into innerHTML / HTML attributes / inline-handler JS strings. Pages may
 * keep their existing local helpers (escHtml / escapeHtml / esc / escapeVis /
 * escDiscHtml); NEW pages should load this file instead of redefining one.
 *
 *   escHtml(v) — HTML text / quoted-attribute context: & < > " ' → entities.
 *   escAttr(v) — alias of escHtml (semantic name for attribute contexts).
 *   escJS(v)   — JS-string context inside single-quote-delimited
 *                onclick/oninput args (escapes \ ' " \r \n — same convention
 *                as the local escJS in admin-products.html). When the handler
 *                sits in an HTML attribute, combine with escAttr:
 *                onclick="fn('${escAttr(escJS(name))}')"
 */
(function () {
    'use strict';

    function escHtml(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function escJS(v) {
        if (v == null) return '';
        return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    }

    // Don't clobber a page's own helper if one is already defined.
    window.escHtml = window.escHtml || escHtml;
    window.escAttr = window.escAttr || escHtml;
    window.escJS = window.escJS || escJS;
})();
