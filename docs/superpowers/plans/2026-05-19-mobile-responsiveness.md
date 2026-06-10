# Mobile Responsiveness Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 24 priority pages of act.qcpaintshop.com fully mobile-responsive for 360px–430px screens with no horizontal scroll.

**Architecture:** Create a global `public/css/mobile.css` utility file and a `public/js/mobile-init.js` auto-fixer, inject both via `universal-nav-loader.js` so every page gets them for free, then tackle each page's hardcoded fixed widths and table structures individually in priority order (P1→P2→P3→P4).

**Tech Stack:** HTML, Tailwind CSS (local build at `/css/tailwind.css`), Vanilla JS, Express.js backend (no framework changes needed)

---

## File Mapping (spec path → actual file)

| Spec path | Actual file |
|---|---|
| `/dashboard.html` | `public/admin-dashboard.html` |
| `/admin-leads.html` | `public/admin-leads.html` |
| `/admin-attendance.html` | `public/admin-attendance.html` |
| `/admin-salary-monthly.html` | `public/admin-salary-monthly.html` |
| `/admin-products.html` | `public/admin-products.html` |
| `/admin-staff.html` | `public/admin-staff.html` |
| `/admin-ai.html` | `public/admin-ai.html` |
| `/admin-zoho-dashboard.html` | `public/admin-zoho-dashboard.html` |
| `/admin-zoho-invoices.html` | `public/admin-zoho-invoices.html` |
| `/admin-zoho-expenses.html` | `public/admin-zoho-expenses.html` |
| `/admin-zoho-reports.html` | `public/admin-zoho-reports.html` |
| `/admin-zoho-salesorders.html` | `public/admin-zoho-salesorders.html` |
| `/admin-zoho-settings.html` | `public/admin-zoho-settings.html` |
| `/admin-profile.html` | `public/admin-profile.html` |
| `/estimates.html` | `public/estimates.html` |
| `/chat.html` | `public/chat.html` |
| `/staff/activities.html` | `public/staff-daily-work.html` |
| `/staff/collections.html` | `public/admin-zoho-collections.html` |
| `/staff/daily-tasks.html` | `public/staff-daily-work.html` |
| `/staff/history.html` | `public/staff-daily-work.html` (History tab) |
| `/staff/permission-request.html` | `public/staff-requests.html` |
| `/staff/stock-check.html` | `public/admin-stock-check.html` |
| `/staff/agreement.html` | `public/admin-agreements.html` |
| `/staff/dashboard.html` | `public/admin-dashboard.html` |

## Files to Create
- `public/css/mobile.css` — Global responsive utilities, applied to all pages via nav loader
- `public/js/mobile-init.js` — DOM auto-fixer: wraps tables, patches inline fixed widths, keyboard handling

## Files to Modify
- `public/universal-nav-loader.js` — Inject `mobile.css` + `mobile-init.js` into every page
- `public/admin-leads.html` — P1: table overflow, card layout, modal full-screen
- `public/admin-salary-monthly.html` — P1: remove 1600px fixed width, card layout
- `public/admin-attendance.html` — P1: remove fixed widths, card layout
- `public/admin-zoho-collections.html` — P1: fix 600px modals, card list
- `public/admin-ai.html` — P2: sidebar/panel layout
- `public/admin-zoho-invoices.html` — P2: min-width removal, card list
- `public/chat.html` — P2: fixed sidebar, keyboard handling
- `public/admin-dashboard.html` — P3
- `public/admin-products.html` — P3
- `public/admin-staff.html` — P3
- `public/admin-zoho-dashboard.html` — P3
- `public/admin-zoho-expenses.html` — P3
- `public/admin-zoho-reports.html` — P3
- `public/admin-zoho-salesorders.html` — P3
- `public/admin-zoho-settings.html` — P3
- `public/admin-profile.html` — P3
- `public/estimates.html` — P3
- `public/staff-daily-work.html` — P4
- `public/staff-requests.html` — P4
- `public/admin-stock-check.html` — P4
- `public/admin-agreements.html` — P4

---

## Task 1: Create `public/css/mobile.css` — Global Mobile Utilities

**Files:**
- Create: `public/css/mobile.css`

This file provides utilities all pages use. It handles tables, modals, forms, inputs, and buttons globally so per-page work is minimal.

- [ ] **Step 1: Create `public/css/mobile.css`**

```css
/**
 * mobile.css — Global Mobile Responsive Utilities
 * Applied to every page via universal-nav-loader.js injection
 * Breakpoints: Mobile < 640px | Tablet 640–1023px | Desktop 1024px+
 */

/* ─── TABLE SCROLL WRAPPER ─── */
.mob-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    width: 100%;
    position: relative;
    border-radius: 8px;
}

/* Right-edge fade to indicate horizontal scroll is available */
.mob-table-wrap::after {
    content: '';
    position: absolute;
    top: 0; right: 0; bottom: 0;
    width: 32px;
    background: linear-gradient(to right, transparent, rgba(255,255,255,0.85));
    pointer-events: none;
    border-radius: 0 8px 8px 0;
}

/* Hide fade gradient when not overflowing (set by mobile-init.js) */
.mob-table-wrap.no-overflow::after { display: none; }

/* ─── RESPONSIVE MODAL ─── */
@media (max-width: 639px) {
    /* Any element with class mob-modal or data-mob-modal becomes a bottom sheet */
    .mob-modal {
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        top: auto !important;
        width: 100% !important;
        max-width: 100% !important;
        max-height: 92vh !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
        border-radius: 16px 16px 0 0 !important;
        padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important;
        transform: none !important;
        margin: 0 !important;
    }

    /* Generic modal/dialog overrides — targets common patterns in this codebase */
    [id$="Modal"]:not(.mob-no-override),
    [id$="-modal"]:not(.mob-no-override),
    .fixed.inset-0 > div:first-child:not(.mob-no-override) {
        width: 95vw !important;
        max-width: 95vw !important;
        max-height: 90vh !important;
        overflow-y: auto !important;
        margin: auto !important;
        border-radius: 12px !important;
    }

    /* ─── FORMS & INPUTS ─── */
    input:not([type="checkbox"]):not([type="radio"]),
    select,
    textarea {
        font-size: 16px !important; /* Prevents iOS zoom on focus */
        min-height: 44px !important;
    }

    /* ─── BUTTONS — minimum 44px tap target ─── */
    button:not(.mob-no-tap),
    a[role="button"]:not(.mob-no-tap),
    [type="submit"]:not(.mob-no-tap) {
        min-height: 44px;
        min-width: 44px;
    }

    /* ─── FILTER BAR STACKING ─── */
    .mob-filter-bar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
    }
    .mob-filter-bar > * {
        width: 100% !important;
        flex: none !important;
    }

    /* ─── TYPOGRAPHY SCALE ─── */
    h1 { font-size: clamp(1.25rem, 5vw, 2rem) !important; }
    h2 { font-size: clamp(1.1rem, 4.5vw, 1.75rem) !important; }
    h3 { font-size: clamp(1rem, 4vw, 1.5rem) !important; }

    /* ─── UTILITY CLASSES ─── */
    .mob-hidden { display: none !important; }
    .mob-full-w { width: 100% !important; max-width: 100% !important; }
    .mob-p-4 { padding: 1rem !important; }
    .mob-stack { flex-direction: column !important; }
    .mob-stack > * { width: 100% !important; }

    /* ─── FIXED-WIDTH ELEMENT OVERRIDES (catch common hardcoded widths) ─── */
    /* These override inline styles that mobile-init.js can't always remove */
    .container, .mx-auto {
        max-width: 100% !important;
        padding-left: 12px !important;
        padding-right: 12px !important;
    }

    /* ─── TABLE CELLS — prevent nowrap causing overflow ─── */
    td, th {
        white-space: normal !important;
    }

    /* ─── CARDS FULL WIDTH ─── */
    .mob-card-full {
        width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
    }

    /* ─── NOTIFICATION PANEL ─── */
    .qc-notification-panel {
        width: calc(100vw - 24px) !important;
        right: 0 !important;
        left: 12px !important;
        max-height: 80vh !important;
    }
}

/* ─── SAFE-AREA AWARE FIXED BOTTOM BARS ─── */
.mob-safe-bottom {
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}

/* ─── MOBILE CARD TABLE (replaces table rows on small screens) ─── */
@media (max-width: 639px) {
    .mob-card-table thead { display: none; }
    .mob-card-table tbody tr {
        display: block;
        background: #fff;
        border-radius: 8px;
        margin-bottom: 10px;
        padding: 12px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        border: 1px solid #e5e7eb;
    }
    .mob-card-table td {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 4px 0;
        font-size: 13px;
        border: none;
    }
    .mob-card-table td::before {
        content: attr(data-label);
        font-weight: 600;
        color: #6b7280;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        min-width: 90px;
        flex-shrink: 0;
    }
    /* Rows that should be hidden on mobile cards */
    .mob-card-table td.mob-card-hide { display: none; }
    /* Row that holds all action buttons */
    .mob-card-table td.mob-card-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid #f3f4f6;
        margin-top: 4px;
    }
    .mob-card-table td.mob-card-actions::before { display: none; }
}
```

- [ ] **Step 2: Verify file was created**

```
dir "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com\public\css\mobile.css"
```
Expected: file exists, ~4KB

- [ ] **Step 3: Commit**

```bash
git add public/css/mobile.css
git commit -m "feat(mobile): add global mobile.css utility stylesheet"
```

---

## Task 2: Create `public/js/mobile-init.js` — DOM Auto-Fixer

**Files:**
- Create: `public/js/mobile-init.js`

Runs after DOM load; auto-wraps all `<table>` elements in scroll containers, patches critical inline fixed widths, adds data-label attributes to table cells for card layout, and wires keyboard-aware input handling.

- [ ] **Step 1: Create `public/js/mobile-init.js`**

```javascript
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
            if (table.closest('.mob-table-wrap')) return; // already wrapped
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

        // Elements with inline width > 500px get reset to 100%
        document.querySelectorAll('[style]').forEach(function (el) {
            var style = el.getAttribute('style') || '';
            // Match width: Npx or min-width: Npx above 400px
            var wMatch = style.match(/(?:^|;|\s)width\s*:\s*(\d+)px/i);
            var mwMatch = style.match(/(?:^|;|\s)min-width\s*:\s*(\d+)px/i);
            if (wMatch && parseInt(wMatch[1]) > 400) {
                el.style.width = '100%';
                el.style.maxWidth = '100%';
            }
            if (mwMatch && parseInt(mwMatch[1]) > 400) {
                el.style.minWidth = '0';
            }
            // Remove explicit min-height > 600px (e.g. salary page 900px)
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
     * Add a class to table wrappers that actually overflow
     * so the fade-right gradient only shows when needed.
     */
    function checkTableOverflow() {
        document.querySelectorAll('.mob-table-wrap').forEach(function (wrap) {
            if (wrap.scrollWidth <= wrap.clientWidth) {
                wrap.classList.add('no-overflow');
            }
        });
        // Re-check on resize
        window.addEventListener('resize', function () {
            document.querySelectorAll('.mob-table-wrap').forEach(function (wrap) {
                wrap.classList.toggle('no-overflow', wrap.scrollWidth <= wrap.clientWidth);
            });
        }, { passive: true });
    }

    /**
     * Prevent keyboard from covering the focused input on mobile.
     * Scrolls the focused element into view after a short delay
     * (to let the keyboard finish animating).
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
```

- [ ] **Step 2: Commit**

```bash
git add public/js/mobile-init.js
git commit -m "feat(mobile): add mobile-init.js DOM auto-fixer"
```

---

## Task 3: Inject Mobile Assets via `universal-nav-loader.js`

**Files:**
- Modify: `public/universal-nav-loader.js` (lines 127–145 area — after the `loadErrorPrevention` IIFE)

Inject `mobile.css` and `mobile-init.js` into every page automatically. This means zero changes needed to any HTML `<head>` across all 70+ pages.

- [ ] **Step 1: Open `public/universal-nav-loader.js` and add injection after line 132 (after the `loadErrorPrevention` block)**

Find this block (lines 127–132):
```javascript
    // Load error prevention script for all admin pages
    (function loadErrorPrevention() {
        const ep = document.createElement('script');
        ep.src = '/js/error-prevention.js';
        document.head.appendChild(ep);
    })();
```

Add the following **immediately after** that block:

```javascript
    // Inject global mobile stylesheet (mobile.css)
    (function injectMobileCSS() {
        if (!document.querySelector('link[href="/css/mobile.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/css/mobile.css';
            document.head.appendChild(link);
        }
    })();

    // Inject mobile DOM auto-fixer
    (function injectMobileInit() {
        const s = document.createElement('script');
        s.src = '/js/mobile-init.js';
        s.defer = true;
        document.head.appendChild(s);
    })();
```

- [ ] **Step 2: Verify — reload any admin page in browser DevTools, open Network tab, confirm `mobile.css` and `mobile-init.js` requests appear**

- [ ] **Step 3: Commit**

```bash
git add public/universal-nav-loader.js
git commit -m "feat(mobile): inject mobile.css + mobile-init.js via nav loader"
```

---

## Task 4: P1 — Fix `public/admin-leads.html`

**Files:**
- Modify: `public/admin-leads.html`

Issues: 31-column table, no mobile CSS, Lead modal 8 inputs with no mobile layout.

- [ ] **Step 1: Find the `<style>` block and add mobile overrides at the end**

Find the closing `</style>` tag in the `<head>` section. Insert before it:

```css
/* ─── MOBILE: admin-leads.html ─── */
@media (max-width: 639px) {
    /* Page container padding */
    .container { padding: 12px !important; }

    /* Header row: stack title + buttons */
    .flex.justify-between.items-center {
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 12px !important;
    }
    .flex.justify-between.items-center .flex.gap-3 {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 8px !important;
    }
    .flex.justify-between.items-center .flex.gap-3 button {
        width: 100% !important;
        font-size: 13px !important;
        padding: 10px 8px !important;
    }

    /* Stats cards: 2×3 grid on 360px */
    .grid-cols-2.sm\:grid-cols-3.md\:grid-cols-4.lg\:grid-cols-6 {
        grid-template-columns: repeat(2, 1fr) !important;
    }

    /* Filter bar: stack vertically */
    #filterBar, .filter-bar, [id*="filter"] {
        flex-direction: column !important;
    }
    #filterBar input, #filterBar select,
    .filter-bar input, .filter-bar select {
        width: 100% !important;
        min-height: 44px !important;
    }

    /* Table: card layout */
    #leadsTable, #leadTable, table[id*="lead"] {
        display: block !important;
    }
    #leadsTable thead, #leadTable thead,
    table[id*="lead"] thead { display: none !important; }
    #leadsTable tbody tr, #leadTable tbody tr,
    table[id*="lead"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 10px !important;
        padding: 12px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
        border-left: 4px solid #6366f1 !important;
    }
    #leadsTable td, #leadTable td, table[id*="lead"] td {
        display: flex !important;
        justify-content: space-between !important;
        padding: 4px 0 !important;
        font-size: 13px !important;
        border: none !important;
    }
    /* Hide low-priority columns in card view */
    #leadsTable td:nth-child(n+5):not(:last-child),
    #leadTable td:nth-child(n+5):not(:last-child),
    table[id*="lead"] td:nth-child(n+5):not(:last-child) {
        display: none !important;
    }

    /* Lead modal: full screen */
    #leadModal, #addLeadModal, #editLeadModal,
    [id*="lead"][id*="modal"], [id*="lead"][id*="Modal"] {
        width: 100% !important;
        max-width: 100% !important;
        height: 100% !important;
        max-height: 100% !important;
        border-radius: 0 !important;
        top: 0 !important;
        left: 0 !important;
        margin: 0 !important;
        overflow-y: auto !important;
    }
    /* Modal form: 1 column */
    #leadModal .grid-cols-2,
    [id*="lead"][id*="modal"] .grid-cols-2,
    [id*="lead"][id*="Modal"] .grid-cols-2 {
        grid-template-columns: 1fr !important;
    }
}
```

- [ ] **Step 2: Find the leads table element (search for `id="leadsTable"` or similar) and add class `mob-card-table`**

Open the file, find the `<table` that holds leads data. Change it from:
```html
<table class="min-w-full ...">
```
to:
```html
<table class="min-w-full mob-card-table ...">
```

- [ ] **Step 3: Add a FAB (Floating Action Button) for "Add Lead" — add before the closing `</body>` tag**

```html
<!-- Mobile FAB: Add Lead -->
<button
    onclick="openAddModal()"
    class="fixed bottom-20 right-4 z-50 md:hidden bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center"
    style="width:56px;height:56px;"
    aria-label="Add Lead"
>
    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
</button>
```

- [ ] **Step 4: Test in browser DevTools at 360px width**

Open `admin-leads.html` → DevTools → Responsive → 360px width.
- [ ] No horizontal scroll visible
- [ ] Table shows as cards
- [ ] "Add Lead" FAB visible at bottom-right
- [ ] Stats grid is 2-column

- [ ] **Step 5: Commit**

```bash
git add public/admin-leads.html
git commit -m "fix(mobile): admin-leads responsive — card layout + FAB"
```

---

## Task 5: P1 — Fix `public/admin-salary-monthly.html`

**Files:**
- Modify: `public/admin-salary-monthly.html`

Issues: `width: 1600px` fixed table, `white-space: nowrap`, `min-height: 900px`.

- [ ] **Step 1: Find and remove hardcoded fixed widths**

Search for `width: 1600px` (or similar). Change:
```html
<div style="... width: 1600px ...">
```
to:
```html
<div style="... width: 100% ...">
```

Also search for `min-height: 900px` and change to `min-height: auto`.

Search for `white-space: nowrap` in inline styles and remove those occurrences.

- [ ] **Step 2: Add mobile CSS in the `<style>` block**

Find the closing `</style>` in the `<head>`. Insert before it:

```css
/* ─── MOBILE: admin-salary-monthly.html ─── */
@media (max-width: 639px) {
    /* Page padding */
    .container, .p-6, .p-8 { padding: 12px !important; }

    /* Month/Year filter: full width */
    .flex.gap-3.items-center, .flex.gap-4 {
        flex-wrap: wrap !important;
        gap: 8px !important;
    }
    .flex.gap-3.items-center select,
    .flex.gap-4 select,
    .flex.gap-3.items-center input,
    .flex.gap-4 input {
        width: 100% !important;
        min-height: 44px !important;
    }

    /* Summary stats: 2×2 grid */
    .grid.grid-cols-4, .grid.lg\:grid-cols-4 {
        grid-template-columns: repeat(2, 1fr) !important;
    }

    /* Salary table: card layout */
    #salaryTable, table[id*="salary"] {
        display: block !important;
    }
    #salaryTable thead, table[id*="salary"] thead { display: none !important; }
    #salaryTable tbody tr, table[id*="salary"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 10px !important;
        padding: 14px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    #salaryTable td, table[id*="salary"] td {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 5px 0 !important;
        font-size: 13px !important;
        border: none !important;
        border-bottom: 1px solid #f9fafb !important;
        white-space: normal !important;
    }
    #salaryTable td:last-child, table[id*="salary"] td:last-child {
        border-bottom: none !important;
        justify-content: flex-end !important;
        gap: 8px !important;
        padding-top: 10px !important;
    }
    /* Hide minor columns; keep: Name | Month | Net | Status | Action */
    #salaryTable td:nth-child(n+4):nth-child(-n+8),
    table[id*="salary"] td:nth-child(n+4):nth-child(-n+8) {
        display: none !important;
    }

    /* All salary modals: full-screen bottom sheet */
    #calculateModal, #detailModal, #paymentModal,
    [id*="salary"][id*="modal"], [id*="salary"][id*="Modal"],
    [id*="Modal"]:not(.mob-no-override) > .bg-white {
        width: 100% !important;
        max-width: 100% !important;
        max-height: 90vh !important;
        overflow-y: auto !important;
        border-radius: 16px 16px 0 0 !important;
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        margin: 0 !important;
    }
    #calculateModal .grid-cols-2,
    #detailModal .grid-cols-2,
    [id*="salary"][id*="Modal"] .grid-cols-2 {
        grid-template-columns: 1fr !important;
    }
}
```

- [ ] **Step 3: Test at 360px**

- [ ] No horizontal scroll
- [ ] Salary rows show as cards (Name | Net Salary | Status | Pay button)
- [ ] Modals are full-screen or bottom sheet

- [ ] **Step 4: Commit**

```bash
git add public/admin-salary-monthly.html
git commit -m "fix(mobile): admin-salary-monthly — remove 1600px width, card layout"
```

---

## Task 6: P1 — Fix `public/admin-attendance.html`

**Files:**
- Modify: `public/admin-attendance.html`

Issues: 28 TH columns, `min-width: 640/768/1024px` hard-coded, `overflow: hidden` causing clipping.

- [ ] **Step 1: Search for all `min-width:` with values ≥ 400px in inline styles and remove them**

In the file, find patterns like `style="... min-width: 640px ..."` and change `min-width: 640px` to `min-width: 0`.
Same for 768px and 1024px occurrences.

Also find any `overflow: hidden` on the outer table container and change to `overflow: visible` or remove.

- [ ] **Step 2: Add mobile CSS in the `<style>` block**

```css
/* ─── MOBILE: admin-attendance.html ─── */
@media (max-width: 639px) {
    /* Remove container horizontal padding to maximize table space */
    .container, body > .p-6 { padding: 8px !important; }

    /* Month navigation: horizontal scrollable tab strip */
    .month-nav, [id*="monthNav"], .tabs {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        white-space: nowrap !important;
        padding-bottom: 4px !important;
    }

    /* Summary stats: 2×2 grid */
    .grid.grid-cols-4, .grid.grid-cols-3, .stat-grid {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 8px !important;
    }

    /* Attendance table: card per staff member */
    #attendanceTable, table[id*="attendance"] {
        display: block !important;
    }
    #attendanceTable thead, table[id*="attendance"] thead {
        display: none !important;
    }
    #attendanceTable tbody tr, table[id*="attendance"] tbody tr {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 10px !important;
        padding: 12px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.07) !important;
        border: 1px solid #e5e7eb !important;
        gap: 6px !important;
    }
    /* First cell (name) spans full width */
    #attendanceTable tbody tr td:first-child,
    table[id*="attendance"] tbody tr td:first-child {
        grid-column: 1 / -1 !important;
        font-weight: 700 !important;
        font-size: 14px !important;
        border-bottom: 1px solid #f1f5f9 !important;
        padding-bottom: 8px !important;
        margin-bottom: 4px !important;
    }
    /* All cells */
    #attendanceTable td, table[id*="attendance"] td {
        display: block !important;
        padding: 3px 0 !important;
        font-size: 12px !important;
        border: none !important;
        white-space: normal !important;
    }
    /* Hide days 8–31, keep: Name | Present | Absent | Late | Total */
    #attendanceTable td:nth-child(n+8):nth-child(-n+32),
    table[id*="attendance"] td:nth-child(n+8):nth-child(-n+32) {
        display: none !important;
    }

    /* Calendar grid: smaller cells */
    .calendar-grid td, .cal-day {
        width: calc(100% / 7) !important;
        height: 32px !important;
        font-size: 10px !important;
        padding: 2px !important;
    }

    /* Export button: full width */
    button[onclick*="export"], button[onclick*="download"],
    .export-btn {
        width: 100% !important;
        margin-top: 8px !important;
    }

    /* All 7 modals → bottom sheet */
    [id*="Modal"]:not(.mob-no-override) > .bg-white,
    [id*="modal"]:not(.mob-no-override) > .bg-white {
        max-width: 100% !important;
        max-height: 90vh !important;
        overflow-y: auto !important;
        border-radius: 16px 16px 0 0 !important;
        margin-bottom: 0 !important;
    }
}
```

- [ ] **Step 3: Test at 360px**

- [ ] No min-width clip visible
- [ ] Attendance rows show as 2-column cards (Name + key stats)
- [ ] Monthly summary stats are 2×2 grid

- [ ] **Step 4: Commit**

```bash
git add public/admin-attendance.html
git commit -m "fix(mobile): admin-attendance — remove fixed widths, card layout"
```

---

## Task 7: P1 — Fix `public/admin-zoho-collections.html`

**Files:**
- Modify: `public/admin-zoho-collections.html`

Issues: 71 modal references, 600px fixed modal width, `white-space: nowrap`, 38 buttons.

- [ ] **Step 1: Search for `width: 600px` and replace with `width: min(600px, 95vw)` throughout the file**

Use search-and-replace to change all occurrences of:
```
width: 600px
```
to:
```
width: min(600px, 95vw)
```

Also change any `min-width: 600px` to `min-width: 0`.

- [ ] **Step 2: Add mobile CSS in the `<style>` block**

```css
/* ─── MOBILE: admin-zoho-collections.html ─── */
@media (max-width: 639px) {
    /* Page padding */
    .container, .p-6 { padding: 12px !important; }

    /* Status filter chips: horizontal scroll */
    .flex.gap-2.flex-wrap, [id*="statusFilter"] {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        flex-wrap: nowrap !important;
        padding-bottom: 4px !important;
        scrollbar-width: none !important;
    }
    .flex.gap-2.flex-wrap button {
        flex-shrink: 0 !important;
    }

    /* Collection items: card layout */
    #collectionsTable, table[id*="collection"] {
        display: block !important;
    }
    #collectionsTable thead, table[id*="collection"] thead {
        display: none !important;
    }
    #collectionsTable tbody tr, table[id*="collection"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 10px !important;
        padding: 14px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    #collectionsTable td, table[id*="collection"] td {
        display: flex !important;
        justify-content: space-between !important;
        padding: 5px 0 !important;
        font-size: 13px !important;
        border: none !important;
        border-bottom: 1px solid #f9fafb !important;
    }
    #collectionsTable td:last-child, table[id*="collection"] td:last-child {
        border-bottom: none !important;
        justify-content: flex-start !important;
        gap: 8px !important;
        flex-wrap: wrap !important;
    }

    /* Amount: large red if overdue */
    .text-red-600, [class*="overdue"] { font-size: 15px !important; font-weight: 700 !important; }

    /* All modals: 95vw bottom sheet */
    [id*="Modal"]:not(.mob-no-override) > .bg-white,
    [id*="modal"]:not(.mob-no-override) > .bg-white,
    .modal-container > div, .modal-box {
        width: 95vw !important;
        max-width: 95vw !important;
        max-height: 90vh !important;
        overflow-y: auto !important;
        border-radius: 16px 16px 0 0 !important;
    }

    /* Reminder/Log textarea: full width */
    .modal-box textarea, [id*="Modal"] textarea {
        width: 100% !important;
        min-height: 80px !important;
    }

    /* All action buttons: 44px height */
    .modal-box button, [id*="Modal"] button {
        min-height: 44px !important;
    }
}
```

- [ ] **Step 3: Test at 360px**

- [ ] No 600px modal overflowing screen
- [ ] Collections list shows as cards
- [ ] Amount displayed prominently, red if overdue

- [ ] **Step 4: Commit**

```bash
git add public/admin-zoho-collections.html
git commit -m "fix(mobile): admin-zoho-collections — fix 600px modals, card layout"
```

---

## Task 8: P2 — Fix `public/admin-ai.html`

**Files:**
- Modify: `public/admin-ai.html`

Issues: `400px + 600px` fixed sidebar + content panel widths, 25 TH columns, `overflow: hidden`.

- [ ] **Step 1: Find the sidebar/panel split layout and add mobile CSS**

The AI page has a two-panel layout (conversation history sidebar + main AI response area). Add to its `<style>` block:

```css
/* ─── MOBILE: admin-ai.html ─── */
@media (max-width: 639px) {
    /* Remove fixed panel widths */
    .ai-sidebar, [class*="sidebar"], [style*="width: 400px"], [style*="width: 300px"] {
        width: 100% !important;
        max-width: 100% !important;
    }

    /* Layout: stack panels vertically on mobile */
    .ai-layout, .flex.gap-6:has(.ai-sidebar),
    .grid.grid-cols-3, .chat-layout {
        flex-direction: column !important;
        grid-template-columns: 1fr !important;
    }

    /* History sidebar: collapsed by default, toggle button to show */
    .ai-history-panel, [id*="historyPanel"], [id*="conversationPanel"] {
        display: none !important;
    }
    .ai-history-panel.mob-show {
        display: block !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        z-index: 9000 !important;
        background: #fff !important;
        overflow-y: auto !important;
        padding: 16px !important;
    }

    /* Main AI panel: full width */
    .ai-main-panel, [id*="aiPanel"], [id*="chatPanel"] {
        width: 100% !important;
        flex: 1 !important;
    }

    /* Chat input: sticky bottom */
    .ai-input-bar, [id*="inputBar"], form[id*="chat"] {
        position: sticky !important;
        bottom: 0 !important;
        background: #fff !important;
        padding: 12px !important;
        border-top: 1px solid #e5e7eb !important;
        padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;
    }

    /* Message bubbles: max 90vw */
    .message-bubble, [class*="message"] > p, [class*="response"] {
        max-width: 90vw !important;
    }

    /* Code blocks: horizontal scroll */
    pre, code { overflow-x: auto !important; max-width: 100% !important; }

    /* Quick prompt buttons: scroll horizontally */
    .quick-prompts, [id*="quickPrompts"] {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
    }
    .quick-prompts button { flex-shrink: 0 !important; }

    /* AI response tables */
    .ai-main-panel table { width: auto !important; }
}
```

- [ ] **Step 2: Add history toggle button at top of the AI page (before the main content div)**

Find the main content wrapper (first div inside `<body>` after the nav) and add:

```html
<!-- Mobile history panel toggle -->
<button
    class="md:hidden flex items-center gap-2 text-sm text-indigo-600 font-medium mb-3"
    style="min-height:44px;"
    onclick="document.querySelector('.ai-history-panel,[id*=historyPanel],[id*=conversationPanel]')?.classList.toggle('mob-show')"
>
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    History
</button>
```

- [ ] **Step 3: Test at 360px**

- [ ] No horizontal scroll
- [ ] Chat input visible and accessible
- [ ] History panel togglable

- [ ] **Step 4: Commit**

```bash
git add public/admin-ai.html
git commit -m "fix(mobile): admin-ai — collapse sidebar, sticky input, responsive panels"
```

---

## Task 9: P2 — Fix `public/admin-zoho-invoices.html`

**Files:**
- Modify: `public/admin-zoho-invoices.html`

Issues: `min-width: 768px` on elements, 15 TH columns, 51 modal references.

- [ ] **Step 1: Remove `min-width: 768px` inline styles**

Search for `min-width: 768px` in the file and remove it or replace with `min-width: 0`.

- [ ] **Step 2: Add mobile CSS**

```css
/* ─── MOBILE: admin-zoho-invoices.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Sub-navigation: horizontal scroll tabs */
    .sub-nav, [class*="subnav"], nav.flex.gap {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
        padding-bottom: 2px !important;
    }
    .sub-nav a, .sub-nav button { flex-shrink: 0 !important; }

    /* Summary cards: 2×2 grid */
    .grid.grid-cols-4, .grid.grid-cols-3 {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 8px !important;
    }

    /* Invoice table: card layout */
    #invoicesTable, table[id*="invoice"] {
        display: block !important;
    }
    #invoicesTable thead, table[id*="invoice"] thead { display: none !important; }
    #invoicesTable tbody tr, table[id*="invoice"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 10px !important;
        padding: 14px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    #invoicesTable td, table[id*="invoice"] td {
        display: flex !important;
        justify-content: space-between !important;
        padding: 4px 0 !important;
        font-size: 13px !important;
        border: none !important;
        border-bottom: 1px solid #f9fafb !important;
    }
    /* Show only: Invoice# | Customer | Amount | Status | Date (first 5 cols) */
    #invoicesTable td:nth-child(n+6),
    table[id*="invoice"] td:nth-child(n+6) { display: none !important; }
    #invoicesTable td:last-child, table[id*="invoice"] td:last-child {
        display: flex !important;
        justify-content: flex-end !important;
        border-bottom: none !important;
    }

    /* Invoice detail modal: full screen scrollable */
    [id*="invoiceModal"], [id*="invoiceDetail"],
    [id*="Invoice"][id*="Modal"] > .bg-white {
        width: 100% !important;
        max-width: 100% !important;
        max-height: 100vh !important;
        overflow-y: auto !important;
        border-radius: 0 !important;
        position: fixed !important;
        inset: 0 !important;
    }

    /* Download PDF button: always visible */
    button[onclick*="pdf"], button[onclick*="download"], .pdf-btn {
        width: 100% !important;
        min-height: 48px !important;
        margin-top: 8px !important;
    }

    /* Pagination: centered */
    .pagination, [id*="pagination"] {
        justify-content: center !important;
        flex-wrap: wrap !important;
    }
}
```

- [ ] **Step 3: Test at 360px**

- [ ] No min-width clip
- [ ] Invoice list shows as cards
- [ ] Detail modal opens full screen

- [ ] **Step 4: Commit**

```bash
git add public/admin-zoho-invoices.html
git commit -m "fix(mobile): admin-zoho-invoices — remove min-width, card layout"
```

---

## Task 10: P2 — Fix `public/chat.html`

**Files:**
- Modify: `public/chat.html`

Issues: 420px fixed sidebar, `overflow: hidden` on body, keyboard covering input.

- [ ] **Step 1: Add mobile CSS to the page's `<style>` block**

```css
/* ─── MOBILE: chat.html ─── */
@media (max-width: 639px) {
    /* Full-screen layout: no sidebar visible */
    body { overflow: hidden !important; }

    /* Chat layout: full screen, no sidebar */
    .chat-layout, .flex.h-screen, [class*="chat-container"] {
        flex-direction: column !important;
        height: 100vh !important;
        overflow: hidden !important;
    }

    /* Sidebar: hidden by default on mobile */
    .chat-sidebar, [class*="conversation-list"], [id*="chatSidebar"],
    [style*="width: 420px"], [style*="width: 400px"] {
        display: none !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        bottom: 0 !important;
        width: 85vw !important;
        max-width: 320px !important;
        background: #fff !important;
        z-index: 9000 !important;
        overflow-y: auto !important;
        box-shadow: 4px 0 20px rgba(0,0,0,0.15) !important;
        transform: translateX(-100%) !important;
        transition: transform 0.3s ease !important;
    }
    .chat-sidebar.mob-show {
        display: block !important;
        transform: translateX(0) !important;
    }

    /* Main chat panel: full width */
    .chat-main, [id*="chatMain"], [class*="chat-messages"] {
        flex: 1 !important;
        width: 100% !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
    }

    /* Message bubbles */
    .message-bubble, [class*="msg-bubble"] { max-width: 80vw !important; }

    /* Input bar: sticky bottom, keyboard safe */
    .chat-input-bar, [id*="chatInput"], form[id*="message"],
    .chat-compose {
        position: sticky !important;
        bottom: 0 !important;
        width: 100% !important;
        background: #fff !important;
        padding: 8px 12px !important;
        padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)) !important;
        border-top: 1px solid #e5e7eb !important;
        z-index: 10 !important;
    }
    .chat-input-bar input, [id*="chatInput"] input,
    .chat-compose input, .chat-compose textarea {
        font-size: 16px !important; /* prevent iOS zoom */
        width: 100% !important;
        min-height: 44px !important;
    }

    /* New chat modal: bottom sheet */
    [id*="newChat"], [id*="newConversation"] {
        width: 95vw !important;
        max-width: 95vw !important;
        border-radius: 16px 16px 0 0 !important;
        bottom: 0 !important;
        position: fixed !important;
    }

    /* Back/menu button: show sidebar toggle */
    .chat-back-btn, .chat-menu-btn { min-height: 44px !important; min-width: 44px !important; }
}
```

- [ ] **Step 2: Find the fixed `width: 420px` on the sidebar div and remove it (or set to `width: 100%`)**

Search for `style="width: 420px"` or similar and change to `style="width: 100%"` — the mobile CSS will handle hiding it on small screens.

- [ ] **Step 3: Add a back/toggle button in the chat header for mobile**

Find the chat header (top bar of the chat area) and add before its closing tag:

```html
<!-- Mobile sidebar toggle -->
<button
    class="md:hidden mr-2"
    style="min-width:44px;min-height:44px;background:none;border:none;cursor:pointer;"
    onclick="document.querySelector('.chat-sidebar,[id*=chatSidebar]')?.classList.toggle('mob-show')"
    aria-label="Toggle conversations"
>
    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
</button>
```

- [ ] **Step 4: Test at 360px**

- [ ] No horizontal scroll
- [ ] Chat takes full screen
- [ ] Input bar stays above keyboard (test by tapping input)
- [ ] Sidebar toggles via button

- [ ] **Step 5: Commit**

```bash
git add public/chat.html
git commit -m "fix(mobile): chat — full-screen layout, sidebar drawer, keyboard-safe input"
```

---

## Task 11: P3 — Fix `public/admin-dashboard.html`

**Files:**
- Modify: `public/admin-dashboard.html`

- [ ] **Step 1: Add mobile CSS**

```css
/* ─── MOBILE: admin-dashboard.html ─── */
@media (max-width: 639px) {
    .container, .p-6, .p-8 { padding: 12px !important; }

    /* Quick links: 2-column grid on mobile */
    .grid.grid-cols-3, .quick-links-grid {
        grid-template-columns: repeat(2, 1fr) !important;
    }
    /* Quick link items */
    .quick-link-item, [class*="quick-link"] {
        padding: 12px 8px !important;
        font-size: 12px !important;
    }

    /* Data cards: already 2×2 — verify on 360px */
    .grid.grid-cols-4 { grid-template-columns: repeat(2, 1fr) !important; }
    .grid.grid-cols-2 { grid-template-columns: repeat(2, 1fr) !important; }

    /* Notice board: full-width stacked */
    .notice-board, [id*="noticeBoard"] { width: 100% !important; }
    .notice-card { width: 100% !important; margin: 0 0 8px 0 !important; }

    /* Activity cards: single column */
    .activity-feed, [id*="activity"] { width: 100% !important; }

    /* Section titles */
    h3.text-lg, h3.text-xl { font-size: 1rem !important; }
}
```

- [ ] **Step 2: Test at 360px**

- [ ] Quick links are 2-column
- [ ] No overflow

- [ ] **Step 3: Commit**

```bash
git add public/admin-dashboard.html
git commit -m "fix(mobile): admin-dashboard — 2-col quick links, responsive cards"
```

---

## Task 12: P3 — Fix `public/admin-products.html`

**Files:**
- Modify: `public/admin-products.html`

- [ ] **Step 1: Add mobile CSS**

```css
/* ─── MOBILE: admin-products.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Category filter: horizontal scroll chips */
    .filter-tabs, [id*="categoryFilter"], .flex.gap-2 {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
        padding-bottom: 4px !important;
    }
    .filter-tabs button { flex-shrink: 0 !important; }

    /* Search: full width sticky */
    input[type="search"], input[placeholder*="Search"],
    input[placeholder*="search"] {
        width: 100% !important;
        min-height: 44px !important;
    }

    /* Products table: card grid on mobile */
    #productsTable, table[id*="product"] {
        display: block !important;
    }
    #productsTable thead, table[id*="product"] thead { display: none !important; }
    #productsTable tbody, table[id*="product"] tbody {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 10px !important;
    }
    #productsTable tbody tr, table[id*="product"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        padding: 10px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    #productsTable td, table[id*="product"] td {
        display: block !important;
        font-size: 12px !important;
        border: none !important;
        padding: 2px 0 !important;
    }
    /* Hide SKU, description, dates */
    #productsTable td:nth-child(n+4):nth-child(-n+7),
    table[id*="product"] td:nth-child(n+4):nth-child(-n+7) { display: none !important; }

    /* Stock badge */
    .stock-badge, [class*="stock"] { font-size: 11px !important; }

    /* Action buttons: icon-only */
    .action-btn span, .btn-text { display: none !important; }

    /* Add product modal: full screen */
    [id*="productModal"], [id*="Product"][id*="Modal"] {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        border-radius: 0 !important;
        overflow-y: auto !important;
    }
    [id*="productModal"] .grid-cols-2,
    [id*="Product"][id*="Modal"] .grid-cols-2 {
        grid-template-columns: 1fr !important;
    }
}
```

- [ ] **Step 2: Add FAB for Add Product**

Before closing `</body>`:
```html
<button
    onclick="openAddProductModal ? openAddProductModal() : document.getElementById('addProductBtn')?.click()"
    class="fixed bottom-20 right-4 z-50 md:hidden bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center"
    style="width:56px;height:56px;"
    aria-label="Add Product"
>
    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
</button>
```

- [ ] **Step 3: Test + Commit**

```bash
git add public/admin-products.html
git commit -m "fix(mobile): admin-products — card grid, filter chips scroll, FAB"
```

---

## Task 13: P3 — Fix `public/admin-staff.html`

**Files:**
- Modify: `public/admin-staff.html`

- [ ] **Step 1: Add mobile CSS**

```css
/* ─── MOBILE: admin-staff.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Filter chips: horizontal scroll */
    .flex.gap-2, [id*="branchFilter"], [id*="roleFilter"] {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
    }

    /* Staff table: profile card layout */
    #staffTable, table[id*="staff"] {
        display: block !important;
    }
    #staffTable thead, table[id*="staff"] thead { display: none !important; }
    #staffTable tbody tr, table[id*="staff"] tbody tr {
        display: grid !important;
        grid-template-columns: auto 1fr auto !important;
        align-items: center !important;
        gap: 10px !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 8px !important;
        padding: 12px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    #staffTable td, table[id*="staff"] td {
        display: block !important;
        font-size: 13px !important;
        border: none !important;
        padding: 1px 0 !important;
    }
    /* Show: Avatar(1) | Name+Role(2,3) | Status+Actions(4,5) */
    #staffTable td:nth-child(n+6),
    table[id*="staff"] td:nth-child(n+6) { display: none !important; }

    /* Staff form modal: full screen */
    [id*="staffModal"], [id*="Staff"][id*="Modal"] {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        border-radius: 0 !important;
        overflow-y: auto !important;
    }
    [id*="staffModal"] .grid-cols-2,
    [id*="Staff"][id*="Modal"] .grid-cols-2 {
        grid-template-columns: 1fr !important;
    }
    /* Search: sticky full width */
    input[placeholder*="Search"], input[placeholder*="staff"] {
        width: 100% !important;
        min-height: 44px !important;
        position: sticky !important;
        top: 60px !important;
        z-index: 10 !important;
    }
}
```

- [ ] **Step 2: Test + Commit**

```bash
git add public/admin-staff.html
git commit -m "fix(mobile): admin-staff — profile card layout, full-screen modal"
```

---

## Task 14: P3 — Fix Zoho Sub-pages (5 files)

**Files:**
- Modify: `public/admin-zoho-dashboard.html`
- Modify: `public/admin-zoho-expenses.html`
- Modify: `public/admin-zoho-reports.html`
- Modify: `public/admin-zoho-salesorders.html`
- Modify: `public/admin-zoho-settings.html`

All Zoho pages share similar patterns. Apply the following CSS block to each file's `<style>` section.

- [ ] **Step 1: Add to `admin-zoho-dashboard.html`**

```css
/* ─── MOBILE: admin-zoho-dashboard.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }
    /* Sub-nav: horizontal scroll */
    [class*="subnav"], nav.flex, .tabs-scroll {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
    }
    [class*="subnav"] a, nav.flex a { flex-shrink: 0 !important; }
    /* Summary cards: 2×2 */
    .grid.grid-cols-4, .grid.grid-cols-3, .grid.grid-cols-6 {
        grid-template-columns: repeat(2, 1fr) !important;
    }
    /* Charts: full width */
    canvas, .chart-container { width: 100% !important; max-width: 100% !important; }
    /* Date range: full width stacked */
    .date-range-picker, .flex.gap-3 > input[type="date"] {
        width: 100% !important;
        min-height: 44px !important;
        display: block !important;
    }
    /* Quick stats: single column */
    .quick-stats, [id*="quickStats"] { flex-direction: column !important; }
}
```

- [ ] **Step 2: Add to `admin-zoho-expenses.html`**

```css
/* ─── MOBILE: admin-zoho-expenses.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }
    .grid.grid-cols-4, .grid.grid-cols-3 {
        grid-template-columns: repeat(2, 1fr) !important;
    }
    /* Expenses table: card layout */
    table[id*="expense"] { display: block !important; }
    table[id*="expense"] thead { display: none !important; }
    table[id*="expense"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 8px !important;
        padding: 12px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
    }
    table[id*="expense"] td {
        display: flex !important;
        justify-content: space-between !important;
        padding: 4px 0 !important;
        font-size: 13px !important;
        border: none !important;
    }
    /* Category filter chips */
    [id*="categoryFilter"] {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
    }
    /* Receipt upload: large tap zone */
    input[type="file"] { min-height: 56px !important; width: 100% !important; }
    /* Donut chart: full width */
    canvas { width: 100% !important; height: auto !important; }
}
```

- [ ] **Step 3: Add to `admin-zoho-reports.html`**

```css
/* ─── MOBILE: admin-zoho-reports.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }
    /* Report selector: full width dropdown */
    select[id*="reportType"], .report-type-selector {
        width: 100% !important;
        min-height: 44px !important;
    }
    /* Charts: full width */
    canvas, .chart-container, .chart-wrapper { width: 100% !important; }
    /* Date range: full width stacked */
    .flex.gap-3 > input[type="date"],
    .date-range input { width: 100% !important; display: block !important; margin-bottom: 8px !important; }
    /* Export buttons: full width */
    button[onclick*="export"], .export-btn {
        width: 100% !important;
        min-height: 48px !important;
        margin-bottom: 8px !important;
    }
    /* KPI grid: 2×2 */
    .grid.grid-cols-4, .grid.grid-cols-3 {
        grid-template-columns: repeat(2, 1fr) !important;
    }
    /* Report table: sticky first column */
    .report-table { overflow-x: auto !important; }
    .report-table td:first-child, .report-table th:first-child {
        position: sticky !important;
        left: 0 !important;
        background: #fff !important;
        z-index: 1 !important;
    }
}
```

- [ ] **Step 4: Add to `admin-zoho-salesorders.html`**

```css
/* ─── MOBILE: admin-zoho-salesorders.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }
    /* Filter: collapsible panel (toggle via existing filter toggle btn) */
    .filter-panel, [id*="filterPanel"] { width: 100% !important; }
    /* Sales orders: card layout */
    table[id*="sales"], table[id*="order"] { display: block !important; }
    table[id*="sales"] thead, table[id*="order"] thead { display: none !important; }
    table[id*="sales"] tbody tr, table[id*="order"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 8px !important;
        padding: 14px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    table[id*="sales"] td, table[id*="order"] td {
        display: flex !important;
        justify-content: space-between !important;
        padding: 4px 0 !important;
        font-size: 13px !important;
        border: none !important;
    }
    /* Customer name + total: prominent */
    table[id*="sales"] td:nth-child(2),
    table[id*="order"] td:nth-child(2) { font-weight: 600 !important; font-size: 14px !important; }
    /* Detail bottom sheet */
    [id*="orderModal"] > .bg-white, [id*="salesModal"] > .bg-white {
        width: 95vw !important;
        max-height: 90vh !important;
        overflow-y: auto !important;
        border-radius: 16px 16px 0 0 !important;
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        margin: 0 !important;
    }
}
```

- [ ] **Step 5: Add to `admin-zoho-settings.html`**

```css
/* ─── MOBILE: admin-zoho-settings.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }
    /* Settings sections: accordion style */
    .settings-section, [class*="settings-group"] {
        width: 100% !important;
        margin-bottom: 12px !important;
    }
    /* All inputs: full width stacked */
    .grid.grid-cols-2, .settings-section .flex.gap-4 {
        grid-template-columns: 1fr !important;
        flex-direction: column !important;
    }
    input, select, textarea {
        width: 100% !important;
        min-height: 44px !important;
    }
    /* API keys: truncated with show toggle */
    input[type="password"], input[class*="api-key"] {
        font-family: monospace !important;
        font-size: 13px !important;
    }
    /* Save button: sticky bottom */
    button[type="submit"], button[onclick*="save"], .save-btn {
        width: 100% !important;
        min-height: 48px !important;
        position: sticky !important;
        bottom: 64px !important;
        z-index: 10 !important;
    }
    /* Section tabs: vertical list */
    .settings-tabs, [id*="settingsTabs"] {
        flex-direction: column !important;
    }
    .settings-tabs button { width: 100% !important; text-align: left !important; }
}
```

- [ ] **Step 6: Test all 5 files at 360px + Commit**

```bash
git add public/admin-zoho-dashboard.html public/admin-zoho-expenses.html \
        public/admin-zoho-reports.html public/admin-zoho-salesorders.html \
        public/admin-zoho-settings.html
git commit -m "fix(mobile): admin-zoho-* pages — responsive layout, card tables"
```

---

## Task 15: P3 — Fix `public/admin-profile.html`

**Files:**
- Modify: `public/admin-profile.html`

Issues: 27 input fields, no mobile layout.

- [ ] **Step 1: Add mobile CSS**

```css
/* ─── MOBILE: admin-profile.html ─── */
@media (max-width: 639px) {
    .container, .p-6, .p-8 { padding: 12px !important; }

    /* Profile photo: centered */
    .profile-photo-container, [id*="profilePhoto"] {
        display: flex !important;
        justify-content: center !important;
        margin-bottom: 16px !important;
    }
    .profile-photo-container img, .profile-avatar {
        width: 100px !important;
        height: 100px !important;
        border-radius: 50% !important;
    }

    /* All form grids: single column */
    .grid.grid-cols-2, .grid.grid-cols-3 {
        grid-template-columns: 1fr !important;
    }
    /* Inputs: full width */
    input, select, textarea { width: 100% !important; min-height: 44px !important; }

    /* Sections: card with padding */
    .profile-section, [class*="profile-section"], .card, .bg-white.rounded {
        padding: 16px !important;
        margin-bottom: 12px !important;
    }
    /* Section headers */
    .profile-section h3, .section-title { font-size: 1rem !important; font-weight: 700 !important; }

    /* Password section: collapsible */
    [id*="passwordSection"], [id*="securitySection"] {
        margin-top: 8px !important;
    }

    /* QR modal: centered full width */
    [id*="qrModal"] > .bg-white, [id*="QR"][id*="Modal"] > .bg-white {
        width: 95vw !important;
        max-width: 95vw !important;
    }

    /* Save button: sticky bottom bar */
    button[type="submit"], .save-profile-btn, button[onclick*="save"] {
        width: 100% !important;
        min-height: 48px !important;
        position: sticky !important;
        bottom: 64px !important;
        z-index: 10 !important;
    }
}
```

- [ ] **Step 2: Test + Commit**

```bash
git add public/admin-profile.html
git commit -m "fix(mobile): admin-profile — single column form, sticky save button"
```

---

## Task 16: P3 — Fix `public/estimates.html`

**Files:**
- Modify: `public/estimates.html`

- [ ] **Step 1: Add mobile CSS**

```css
/* ─── MOBILE: estimates.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Estimate list: card layout */
    table[id*="estimate"] { display: block !important; }
    table[id*="estimate"] thead { display: none !important; }
    table[id*="estimate"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 8px !important;
        padding: 14px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    table[id*="estimate"] td {
        display: flex !important;
        justify-content: space-between !important;
        padding: 4px 0 !important;
        font-size: 13px !important;
        border: none !important;
    }

    /* Status filter: horizontal chip scroll */
    .flex.gap-2, [id*="statusFilter"] {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
    }

    /* Search + date filter: collapsible panel */
    .filter-panel, [id*="filterPanel"] { width: 100% !important; }
    .filter-panel input { width: 100% !important; min-height: 44px !important; }

    /* Total section: sticky bottom */
    .total-section, [id*="totalSection"] {
        position: sticky !important;
        bottom: 64px !important;
        background: #fff !important;
        padding: 12px !important;
        border-top: 1px solid #e5e7eb !important;
        z-index: 10 !important;
    }

    /* Line items table in modal: vertical cards */
    [id*="lineItems"] table, [id*="estimateItems"] table {
        display: block !important;
    }
    [id*="lineItems"] thead, [id*="estimateItems"] thead { display: none !important; }
    [id*="lineItems"] tbody tr, [id*="estimateItems"] tbody tr {
        display: block !important;
        background: #f8fafc !important;
        border-radius: 8px !important;
        margin-bottom: 6px !important;
        padding: 10px !important;
    }
    [id*="lineItems"] td, [id*="estimateItems"] td {
        display: flex !important;
        justify-content: space-between !important;
        font-size: 12px !important;
        border: none !important;
        padding: 3px 0 !important;
    }
}
```

- [ ] **Step 2: Test + Commit**

```bash
git add public/estimates.html
git commit -m "fix(mobile): estimates — card layout, filter chips scroll"
```

---

## Task 17: P4 — Fix `public/staff-daily-work.html` (Activities + Daily Tasks + History)

**Files:**
- Modify: `public/staff-daily-work.html`

- [ ] **Step 1: Add mobile CSS**

```css
/* ─── MOBILE: staff-daily-work.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Tabs: horizontal scroll strip */
    .tabs, [id*="tabStrip"], .flex.border-b {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
    }
    .tabs button, [id*="tabStrip"] button { flex-shrink: 0 !important; }

    /* Activity form: full screen */
    [id*="activityModal"], [id*="taskModal"],
    [id*="Activity"][id*="Modal"], [id*="Task"][id*="Modal"] {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        border-radius: 0 !important;
        overflow-y: auto !important;
    }
    /* Activity type selector: large cards */
    [class*="activity-type"], [id*="activityType"] {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 8px !important;
    }
    /* All form inputs: full width */
    [id*="Modal"] input, [id*="Modal"] select, [id*="Modal"] textarea,
    [id*="modal"] input, [id*="modal"] select, [id*="modal"] textarea {
        width: 100% !important;
        min-height: 44px !important;
    }
    /* Submit button: sticky bottom */
    [id*="Modal"] button[type="submit"],
    [id*="modal"] button[type="submit"] {
        width: 100% !important;
        min-height: 48px !important;
        position: sticky !important;
        bottom: 0 !important;
    }
    /* Photo upload: large tap zone */
    input[type="file"] {
        min-height: 56px !important;
        width: 100% !important;
    }

    /* Task list: checkbox cards */
    .task-item, [class*="task-card"] {
        display: flex !important;
        align-items: flex-start !important;
        gap: 12px !important;
        background: #fff !important;
        border-radius: 10px !important;
        padding: 14px !important;
        margin-bottom: 8px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.07) !important;
    }
    .task-item input[type="checkbox"] {
        width: 24px !important;
        height: 24px !important;
        min-height: 24px !important;
        margin-top: 2px !important;
        flex-shrink: 0 !important;
    }

    /* History: timeline cards */
    .history-item, [class*="history-card"] {
        background: #fff !important;
        border-radius: 10px !important;
        padding: 12px !important;
        margin-bottom: 8px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.07) !important;
    }
    /* Date group header: sticky */
    .date-header, [class*="date-group"] {
        position: sticky !important;
        top: 60px !important;
        background: #f8fafc !important;
        z-index: 5 !important;
        padding: 6px 0 !important;
        font-weight: 600 !important;
    }
}
```

- [ ] **Step 2: Test + Commit**

```bash
git add public/staff-daily-work.html
git commit -m "fix(mobile): staff-daily-work — form sheets, task cards, history timeline"
```

---

## Task 18: P4 — Fix `public/staff-requests.html` (Permission Request)

**Files:**
- Modify: `public/staff-requests.html`

Issues: `width: 500px` fixed elements.

- [ ] **Step 1: Find `width: 500px` inline style and change to `width: min(500px, 95vw)`**

- [ ] **Step 2: Add mobile CSS**

```css
/* ─── MOBILE: staff-requests.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Form container: full width */
    .request-form, [id*="requestForm"], .form-container {
        width: 95vw !important;
        max-width: 95vw !important;
    }
    /* Inputs: full width stacked */
    .grid.grid-cols-2 { grid-template-columns: 1fr !important; }
    input, select, textarea { width: 100% !important; min-height: 44px !important; }
    textarea { min-height: 80px !important; }

    /* Submit button: full width */
    button[type="submit"], .submit-btn {
        width: 100% !important;
        min-height: 48px !important;
    }

    /* Past requests list: card with colored badge */
    table[id*="request"] { display: block !important; }
    table[id*="request"] thead { display: none !important; }
    table[id*="request"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        margin-bottom: 8px !important;
        padding: 12px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    table[id*="request"] td {
        display: flex !important;
        justify-content: space-between !important;
        padding: 4px 0 !important;
        font-size: 13px !important;
        border: none !important;
    }
}
```

- [ ] **Step 3: Test + Commit**

```bash
git add public/staff-requests.html
git commit -m "fix(mobile): staff-requests — remove 500px width, full-width form"
```

---

## Task 19: P4 — Fix `public/admin-stock-check.html` (Stock Check)

**Files:**
- Modify: `public/admin-stock-check.html`

Issues: 600px and 480px fixed widths.

- [ ] **Step 1: Find `width: 600px` and `width: 480px` inline styles and change to `width: min(600px, 95vw)` and `width: min(480px, 95vw)` respectively**

- [ ] **Step 2: Add mobile CSS**

```css
/* ─── MOBILE: admin-stock-check.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Stock items: 2-column card grid */
    #stockTable, table[id*="stock"] { display: block !important; }
    #stockTable thead, table[id*="stock"] thead { display: none !important; }
    #stockTable tbody, table[id*="stock"] tbody {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 10px !important;
    }
    #stockTable tbody tr, table[id*="stock"] tbody tr {
        display: block !important;
        background: #fff !important;
        border-radius: 10px !important;
        padding: 12px !important;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        border: 1px solid #e5e7eb !important;
    }
    /* Low stock: red border */
    .low-stock, [class*="low-stock"] {
        border-color: #fca5a5 !important;
        background: #fff5f5 !important;
    }
    #stockTable td, table[id*="stock"] td {
        display: block !important;
        font-size: 12px !important;
        border: none !important;
        padding: 2px 0 !important;
    }

    /* Search: sticky top */
    input[placeholder*="Search"], input[placeholder*="search"] {
        width: 100% !important;
        min-height: 44px !important;
        position: sticky !important;
        top: 60px !important;
        z-index: 5 !important;
    }

    /* Category filter: chip scroll */
    [id*="categoryFilter"], .flex.gap-2 {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: none !important;
    }

    /* Barcode scan button: prominent */
    button[onclick*="scan"], button[onclick*="barcode"], .scan-btn {
        width: 100% !important;
        min-height: 52px !important;
        font-size: 16px !important;
    }

    /* Submit all changes: sticky bottom bar */
    button[onclick*="submit"], button[onclick*="save"], .submit-all-btn {
        position: sticky !important;
        bottom: 64px !important;
        width: 100% !important;
        min-height: 48px !important;
        z-index: 10 !important;
    }
}
```

- [ ] **Step 3: Test + Commit**

```bash
git add public/admin-stock-check.html
git commit -m "fix(mobile): admin-stock-check — remove fixed widths, 2-col card grid"
```

---

## Task 20: P4 — Fix `public/admin-agreements.html` (Staff Agreement)

**Files:**
- Modify: `public/admin-agreements.html`

Issues: `width: 700px` fixed.

- [ ] **Step 1: Find `width: 700px` and change to `width: min(700px, 95vw)` or just `max-width: 700px; width: 95vw`**

- [ ] **Step 2: Add mobile CSS**

```css
/* ─── MOBILE: admin-agreements.html ─── */
@media (max-width: 639px) {
    .container, .p-6 { padding: 12px !important; }

    /* Agreement container: full width */
    .agreement-container, [id*="agreementContainer"],
    [style*="width: 700px"], [style*="max-width: 700px"] {
        width: 95vw !important;
        max-width: 95vw !important;
    }

    /* Agreement text: readable */
    .agreement-text, [id*="agreementText"] {
        font-size: 15px !important;
        line-height: 1.6 !important;
        max-height: 60vh !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
        padding: 12px !important;
        border: 1px solid #e5e7eb !important;
        border-radius: 8px !important;
    }

    /* Signature pad: full width */
    canvas[id*="signature"], canvas[id*="pad"], .signature-pad {
        width: 100% !important;
        height: 160px !important;
    }

    /* Accept/Decline buttons: full width stacked */
    .agreement-actions, [id*="agreementActions"] {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        margin-top: 16px !important;
    }
    .agreement-actions button { width: 100% !important; min-height: 48px !important; }
}
```

- [ ] **Step 3: Test + Commit**

```bash
git add public/admin-agreements.html
git commit -m "fix(mobile): admin-agreements — remove 700px width, readable agreement text"
```

---

## Task 21: Final — Regression Check & Cleanup

**Files:**
- Read: `public/css/mobile.css` (verify no syntax errors)
- Test: All 24 pages at 360px, 390px, 414px, 430px

- [ ] **Step 1: Start the dev server**

```bash
node server.js
```
Or if using pm2 locally: the site is at `http://localhost:3000` (check `server.js` for port).

- [ ] **Step 2: Open Chrome DevTools → Toggle device toolbar → Test each page at 360px**

Checklist for each page:
- [ ] `/admin-dashboard.html` — No horizontal scroll, 2-col quick links
- [ ] `/admin-leads.html` — Table cards, FAB visible
- [ ] `/admin-attendance.html` — No fixed-width clip, card rows
- [ ] `/admin-salary-monthly.html` — No 1600px width, card rows
- [ ] `/admin-zoho-collections.html` — Modals fit 95vw
- [ ] `/admin-ai.html` — Full-width main panel, history toggle works
- [ ] `/admin-zoho-invoices.html` — No min-width clip, card rows
- [ ] `/chat.html` — Full-screen, input above keyboard
- [ ] `/admin-products.html` — Card grid, FAB
- [ ] `/admin-staff.html` — Profile cards
- [ ] `/admin-zoho-dashboard.html` — Summary 2×2 grid
- [ ] `/admin-zoho-expenses.html` — Expense cards
- [ ] `/admin-zoho-reports.html` — Charts full width
- [ ] `/admin-zoho-salesorders.html` — Order cards
- [ ] `/admin-zoho-settings.html` — Full-width inputs
- [ ] `/admin-profile.html` — Single-column form
- [ ] `/estimates.html` — Estimate cards
- [ ] `/staff-daily-work.html` — Task checkbox cards
- [ ] `/staff-requests.html` — No 500px width
- [ ] `/admin-stock-check.html` — No 600px width, card grid
- [ ] `/admin-agreements.html` — No 700px width, readable text

- [ ] **Step 3: Fix any remaining horizontal scroll issues found during testing by adding targeted CSS to the relevant page or `mobile.css`**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(mobile): final cleanup after regression check — 24 pages mobile-responsive"
```

---

## Self-Review Notes

### Spec Coverage Check
- ✅ Global fixes: mobile.css, mobile-init.js auto table wrapper, input font-size 16px, min 44px tap targets
- ✅ Navigation: sidebar already has mobile drawer + bottom quickbar (sidebar-complete.html lines 336–395)
- ✅ P1 pages: admin-leads, admin-salary-monthly, admin-attendance, collections (Tasks 4–7)
- ✅ P2 pages: admin-ai, admin-zoho-invoices, chat (Tasks 8–10)
- ✅ P3 pages: dashboard, products, staff, 5 Zoho pages, profile, estimates (Tasks 11–16)
- ✅ P4 pages: staff-daily-work, staff-requests, admin-stock-check, admin-agreements (Tasks 17–20)
- ⚠️ `mobile-init.js` `fixInlineWidths()` uses a regex on `style` attributes — this handles MOST inline fixed widths automatically without touching HTML. Pages with the worst offenders (salary 1600px, attendance min-widths) also get direct HTML edits.
- ⚠️ CSS selectors like `[id*="Modal"]` are broad — if a page has `mob-no-override` class on a specific modal it won't be affected. Use this to exclude modals that should NOT become bottom sheets.
- ✅ All FABs positioned at `bottom: 20` (above the 56px bottom quickbar from sidebar-complete.html which adds `padding-bottom: 64px` to body on mobile)
- ✅ All `position: sticky; bottom: 64px` on submit buttons accounts for the existing bottom tab bar height

### Breakpoints Used Consistently
- Mobile: `max-width: 639px` (consistent with Tailwind `sm:` = 640px)
- Tablet: `min-width: 640px` and `max-width: 1023px`
- Desktop: `min-width: 1024px`

### Known Limitations
- CSS selectors targeting `[id*="Modal"]` may not match all modal patterns in every page — manual inspection of each page is still needed during Task 21 regression check
- The `mobile-init.js` `fixInlineWidths()` regex catches most `width: Npx` patterns but not CSS-class-applied fixed widths (e.g., `class="w-96"` = 384px Tailwind) — those need per-page CSS overrides
