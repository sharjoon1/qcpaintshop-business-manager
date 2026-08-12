// Page logic for admin-design-reference.html. External script (strict-CSP-legal): no inline
// <script> blocks, no on*= handlers — every runtime-rendered control uses data-action + a
// single delegated document click listener. Screen expand/collapse uses native <details>.

let allScreens = [];
let allEntries = [];

function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

function showState(state) {
    document.getElementById('loadingState').classList.toggle('hidden', state !== 'loading');
    document.getElementById('emptyState').classList.toggle('hidden', state !== 'empty');
    document.getElementById('screensContainer').classList.toggle('hidden', state !== 'results');
}

function refText(e) { return '#' + e.id + ' — ' + e.page + ' ▸ ' + e.title; }

function entryRowHtml(e) {
    return '<div class="dr-entry-row">' +
        '<button type="button" class="dr-entry-id" data-action="copy-ref" data-ref="' + esc(refText(e)) + '">#' + e.id + '</button>' +
        '<div class="dr-entry-body">' +
            '<div class="dr-entry-title">' + esc(e.title) + '</div>' +
            '<div class="dr-entry-meta">' + esc(e.type) + ' &middot; ' + esc(e.page) + (e.does ? ' &middot; ' + esc(e.does) : '') + '</div>' +
        '</div>' +
    '</div>';
}

function screenGroupHtml(screen) {
    const linked = allEntries.filter(e => e.design === screen.title);
    const body = linked.length
        ? linked.map(entryRowHtml).join('')
        : '<div class="dr-no-entries">No feature-index entries reference this screen yet.</div>';

    return '<details class="dr-screen-group">' +
        '<summary class="dr-screen-header">' +
            '<span class="dr-screen-title">' + esc(screen.title) +
                (screen.pendingRefresh ? '<span class="dr-pending-tag">Pending refresh</span>' : '') +
            '</span>' +
            '<span style="display:flex;align-items:center;gap:0.5rem;">' +
                '<span class="dr-screen-meta">' + linked.length + ' linked entr' + (linked.length === 1 ? 'y' : 'ies') + '</span>' +
                '<svg class="dr-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
            '</span>' +
        '</summary>' +
        body +
    '</details>';
}

function renderPendingNotice() {
    const pending = allScreens.filter(s => s.pendingRefresh);
    const notice = document.getElementById('pendingNotice');
    if (pending.length === 0) { notice.classList.add('hidden'); notice.innerHTML = ''; return; }
    notice.classList.remove('hidden');
    notice.innerHTML = '<b>' + pending.length + ' screen' + (pending.length === 1 ? '' : 's') + ' pending a mockup refresh:</b> ' +
        pending.map(s => esc(s.title)).join(', ');
}

function renderScreens() {
    const term = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    const filtered = term ? allScreens.filter(s => s.title.toLowerCase().includes(term)) : allScreens;

    if (filtered.length === 0) { showState('empty'); return; }

    document.getElementById('screensContainer').innerHTML = filtered.map(screenGroupHtml).join('');
    showState('results');
}

async function copyRef(btn, ref) {
    try {
        await navigator.clipboard.writeText(ref);
        const original = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
    } catch (err) {
        console.warn('Clipboard write failed:', err);
    }
}

/**
 * Opens the design mockup in a new window. window.open() alone can't attach the Bearer
 * auth header, so the blank window is opened synchronously (on the click, to dodge popup
 * blockers) and then filled via fetch + document.write once the authenticated HTML arrives.
 */
async function openMockup() {
    const win = window.open('', '_blank');
    if (!win) { alert('Popup blocked. Please allow popups for this site to view the mockup.'); return; }
    try {
        const res = await fetch('/api/admin-docs/design', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const html = await res.text();
        win.document.open();
        win.document.write(html);
        win.document.close();
    } catch (err) {
        console.error('Failed to load design mockup:', err);
        win.close();
        alert('Failed to load the design mockup.');
    }
}

async function loadDesignReference() {
    showState('loading');
    try {
        const res = await fetch('/api/admin-docs/feature-index', { headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error((data && data.message) || ('HTTP ' + res.status));
        allEntries = (data.feature_index && data.feature_index.entries) || [];
        allScreens = (data.design_screens && data.design_screens.screens) || [];
        renderPendingNotice();
        renderScreens();
    } catch (err) {
        console.error('Failed to load design reference:', err);
        document.getElementById('screensContainer').innerHTML =
            '<div class="empty-state"><h3 class="empty-state-title">Failed to load</h3><p class="empty-state-description">' + esc(err.message) + '</p></div>';
        showState('results');
    }
}

document.addEventListener('click', function (e) {
    const copyBtn = e.target.closest('[data-action="copy-ref"]');
    if (copyBtn) { copyRef(copyBtn, copyBtn.getAttribute('data-ref')); return; }
});

document.getElementById('openMockupBtn').addEventListener('click', openMockup);
document.getElementById('searchInput').addEventListener('input', renderScreens);

loadDesignReference();
