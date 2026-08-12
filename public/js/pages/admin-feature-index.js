// Page logic for admin-feature-index.html. External script (strict-CSP-legal): no inline
// <script> blocks, no on*= handlers — every runtime-rendered control uses data-action +
// a single delegated document click listener.

let allEntries = [];
let activePlatform = 'all';
let searchTimeout = null;

function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

function typeBadgeClass(type) {
    const known = ['page', 'section', 'feature', 'button', 'tab', 'field', 'state'];
    return 'fi-type-badge fi-type-' + (known.includes(type) ? type : 'field');
}

function showState(state) {
    document.getElementById('loadingState').classList.toggle('hidden', state !== 'loading');
    document.getElementById('emptyState').classList.toggle('hidden', state !== 'empty');
    document.getElementById('resultsContainer').classList.toggle('hidden', state !== 'results');
}

async function loadFeatureIndex() {
    showState('loading');
    try {
        const res = await fetch('/api/admin-docs/feature-index', { headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error((data && data.message) || ('HTTP ' + res.status));
        allEntries = (data.feature_index && data.feature_index.entries) || [];
        renderPlatformChips();
        applyFilters();
    } catch (err) {
        console.error('Failed to load feature index:', err);
        document.getElementById('resultsContainer').innerHTML =
            '<div class="empty-state"><h3 class="empty-state-title">Failed to load</h3><p class="empty-state-description">' + esc(err.message) + '</p></div>';
        showState('results');
    }
}

function renderPlatformChips() {
    const counts = new Map();
    allEntries.forEach(e => { counts.set(e.platform, (counts.get(e.platform) || 0) + 1); });

    const chipsEl = document.getElementById('platformChips');
    const platforms = Array.from(counts.keys()).sort();

    let html = '<button type="button" class="fi-chip' + (activePlatform === 'all' ? ' active' : '') +
        '" data-action="filter-platform" data-platform="all">All <span class="fi-chip-count">' + allEntries.length + '</span></button>';
    platforms.forEach(p => {
        html += '<button type="button" class="fi-chip' + (activePlatform === p ? ' active' : '') +
            '" data-action="filter-platform" data-platform="' + esc(p) + '">' + esc(p) +
            ' <span class="fi-chip-count">' + counts.get(p) + '</span></button>';
    });
    chipsEl.innerHTML = html;
}

/** AND of whitespace-separated search terms. A purely-numeric term or one starting with
 * '#' matches the entry id exactly; every other term substring-matches (case-insensitive)
 * across title/does/page/code/api/navigatesTo. */
function matchesSearch(entry, terms) {
    for (const term of terms) {
        const t = term.trim();
        if (!t) continue;
        const idTerm = t.startsWith('#') ? t.slice(1) : t;
        if (/^\d+$/.test(idTerm)) {
            if (String(entry.id) === idTerm) continue;
            return false;
        }
        const haystack = [entry.title, entry.does, entry.page, entry.code, entry.api, entry.navigatesTo]
            .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(t.toLowerCase())) return false;
    }
    return true;
}

function applyFilters() {
    const raw = document.getElementById('searchInput').value || '';
    const terms = raw.split(/\s+/).filter(Boolean);

    const filtered = allEntries.filter(e => {
        if (activePlatform !== 'all' && e.platform !== activePlatform) return false;
        return matchesSearch(e, terms);
    });

    document.getElementById('resultCount').textContent = filtered.length + ' / ' + allEntries.length + ' entries';
    renderEntries(filtered);
}

function groupByPlatformThenPage(entries) {
    const groups = new Map(); // platform -> Map(page -> entries[])
    entries.forEach(e => {
        if (!groups.has(e.platform)) groups.set(e.platform, new Map());
        const pageMap = groups.get(e.platform);
        if (!pageMap.has(e.page)) pageMap.set(e.page, []);
        pageMap.get(e.page).push(e);
    });
    return groups;
}

function renderEntries(entries) {
    if (entries.length === 0) { showState('empty'); return; }

    const groups = groupByPlatformThenPage(entries);
    let html = '';
    groups.forEach((pageMap, platform) => {
        pageMap.forEach((rows, page) => {
            html += '<div class="fi-page-group">' +
                '<div class="fi-page-group-header">' +
                    '<span class="fi-page-group-title">' + esc(page) + '</span>' +
                    '<span class="fi-page-group-meta">' + esc(platform) + ' &middot; ' + rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + '</span>' +
                '</div>' +
                rows.map(rowHtml).join('') +
            '</div>';
        });
    });

    document.getElementById('resultsContainer').innerHTML = html;
    showState('results');
}

function rowHtml(e) {
    const refText = '#' + e.id + ' — ' + e.page + ' ▸ ' + e.title;
    return '<div class="fi-row">' +
        '<div class="fi-row-main" data-action="toggle-detail" data-id="' + e.id + '">' +
            '<span class="fi-row-id">#' + e.id + '</span>' +
            '<span class="' + typeBadgeClass(e.type) + '">' + esc(e.type) + '</span>' +
            '<div class="fi-row-body">' +
                '<div class="fi-row-title">' + esc(e.title) + '</div>' +
                '<div class="fi-row-does">' + esc(e.does) + '</div>' +
            '</div>' +
        '</div>' +
        '<div class="fi-row-detail" id="detail-' + e.id + '">' +
            (e.code ? '<div class="fi-detail-item"><b>Code</b><code>' + esc(e.code) + '</code></div>' : '') +
            (e.api ? '<div class="fi-detail-item"><b>API</b><code>' + esc(e.api) + '</code></div>' : '') +
            (e.design ? '<div class="fi-detail-item"><b>Design</b>' + esc(e.design) + '</div>' : '') +
            (e.navigatesTo ? '<div class="fi-detail-item"><b>Navigates to</b>' + esc(e.navigatesTo) + '</div>' : '') +
            (e.route ? '<div class="fi-detail-item"><b>Route</b><code>' + esc(e.route) + '</code></div>' : '') +
            '<div class="fi-detail-item"><b>Updated</b>' + esc(e.updated || '—') + '</div>' +
            '<button type="button" class="fi-copy-btn" data-action="copy-ref" data-id="' + e.id + '" data-ref="' + esc(refText) + '">Copy ref</button>' +
        '</div>' +
    '</div>';
}

async function copyRef(btn, ref) {
    try {
        await navigator.clipboard.writeText(ref);
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
    } catch (err) {
        console.warn('Clipboard write failed:', err);
    }
}

// ── Delegated click handling (strict-CSP-legal: no inline handlers) ──
document.addEventListener('click', function (e) {
    const chip = e.target.closest('[data-action="filter-platform"]');
    if (chip) {
        activePlatform = chip.getAttribute('data-platform');
        renderPlatformChips();
        applyFilters();
        return;
    }

    const copyBtn = e.target.closest('[data-action="copy-ref"]');
    if (copyBtn) {
        copyRef(copyBtn, copyBtn.getAttribute('data-ref'));
        return;
    }

    const row = e.target.closest('[data-action="toggle-detail"]');
    if (row) {
        const detail = document.getElementById('detail-' + row.getAttribute('data-id'));
        if (detail) detail.classList.toggle('open');
    }
});

document.getElementById('searchInput').addEventListener('input', function () {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 200);
});

loadFeatureIndex();
