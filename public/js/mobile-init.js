/**
 * mobile-init.js — DOM Auto-Fixer for Mobile
 * Injected by universal-nav-loader.js on every page.
 * Runs once after DOMContentLoaded.
 */
(function () {
    'use strict';

    const IS_MOBILE = window.innerWidth < 640;

    function init() {
        wrapTables();
        fixInlineWidths();
        labelTableCells();
        handleKeyboardInputOffset();
        checkTableOverflow();
    }

    /**
     * Wrap every bare <table> that isn't already inside a mob-table-wrap.
     * This provides horizontal scroll without touching each HTML file.
     */
    function wrapTables() {
        document.querySelectorAll('table').forEach(function (table) {
            if (table.closest('.mob-table-wrap')) return;
            var wrapper = document.createElement('div');
            wrapper.className = 'mob-table-wrap';
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
        });
    }

    /**
     * On mobile, remove or reduce hardcoded inline fixed pixel widths
     * that cause horizontal overflow. Targets the worst offenders.
     */
    function fixInlineWidths() {
        if (!IS_MOBILE) return;

        document.querySelectorAll('[style]').forEach(function (el) {
            var style = el.getAttribute('style') || '';
            var wMatch = style.match(/(?:^|;|\s)width\s*:\s*(\d+)px/i);
            var mwMatch = style.match(/(?:^|;|\s)min-width\s*:\s*(\d+)px/i);
            if (wMatch && parseInt(wMatch[1]) > 400) {
                el.style.width = '100%';
                el.style.maxWidth = '100%';
            }
            if (mwMatch && parseInt(mwMatch[1]) > 400) {
                el.style.minWidth = '0';
            }
            var mhMatch = style.match(/(?:^|;|\s)min-height\s*:\s*(\d+)px/i);
            if (mhMatch && parseInt(mhMatch[1]) > 400) {
                el.style.minHeight = 'auto';
            }
        });
    }

    /**
     * For tables with class mob-card-table, copy the <th> text into
     * data-label on each <td> so the CSS ::before pseudo-element shows it.
     */
    function labelTableCells() {
        document.querySelectorAll('table.mob-card-table').forEach(function (table) {
            var headers = Array.from(table.querySelectorAll('thead th')).map(function (th) {
                return th.textContent.trim();
            });
            table.querySelectorAll('tbody tr').forEach(function (tr) {
                tr.querySelectorAll('td').forEach(function (td, i) {
                    if (headers[i]) td.setAttribute('data-label', headers[i]);
                });
            });
        });
    }

    /**
     * Add a class to table wrappers that don't actually overflow
     * so the fade-right gradient only shows when needed.
     */
    function checkTableOverflow() {
        document.querySelectorAll('.mob-table-wrap').forEach(function (wrap) {
            if (wrap.scrollWidth <= wrap.clientWidth) {
                wrap.classList.add('no-overflow');
            }
        });
        window.addEventListener('resize', function () {
            document.querySelectorAll('.mob-table-wrap').forEach(function (wrap) {
                wrap.classList.toggle('no-overflow', wrap.scrollWidth <= wrap.clientWidth);
            });
        }, { passive: true });
    }

    /**
     * Prevent keyboard from covering the focused input on mobile.
     * Scrolls the focused element into view after keyboard finishes animating.
     */
    function handleKeyboardInputOffset() {
        if (!IS_MOBILE) return;
        document.addEventListener('focusin', function (e) {
            var el = e.target;
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
                setTimeout(function () {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 350);
            }
        }, { passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
