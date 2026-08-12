// Page logic for admin-features-log.html. External script (strict-CSP-legal): no inline
// <script> blocks, no on*= handlers — the id-chip copy control uses data-action + a single
// delegated document click listener. Date-group expand/collapse uses native <details>.

function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

function typeBadgeClass(entry) {
    if (entry.status === 'removed') return 'fl-type-badge fl-type-removed';
    const known = ['page', 'section', 'feature', 'button', 'tab', 'field', 'state'];
    return 'fl-type-badge fl-type-' + (known.includes(entry.type) ? entry.type : 'field');
}

function showState(state) {
    document.getElementById('loadingState').classList.toggle('hidden', state !== 'loading');
    document.getElementById('emptyState').classList.toggle('hidden', state !== 'empty');
    document.getElementById('logContainer').classList.toggle('hidden', state !== 'results');
}

function computeStats(entries) {
    const active = entries.filter(e => e.status === 'active').length;
    const platforms = new Set(entries.map(e => e.platform)).size;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = entries.filter(e => {
        if (!e.updated) return false;
        const t = new Date(e.updated).getTime();
        return !Number.isNaN(t) && t >= sevenDaysAgo;
    }).length;

    document.getElementById('statActive').textContent = active;
    document.getElementById('statRecent').textContent = recent;
    document.getElementById('statPlatforms').textContent = platforms;
    document.getElementById('statTotal').textContent = entries.length;
}

function groupByUpdatedDesc(entries) {
    const map = new Map();
    entries.forEach(e => {
        const key = e.updated || 'unknown';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(e);
    });
    // Sort date keys descending (ISO yyyy-mm-dd strings sort correctly as strings too,
    // but parse explicitly to also tolerate other formats).
    return Array.from(map.entries()).sort((a, b) => {
        const ta = new Date(a[0]).getTime();
        const tb = new Date(b[0]).getTime();
        if (Number.isNaN(ta) || Number.isNaN(tb)) return a[0] < b[0] ? 1 : -1;
        return tb - ta;
    });
}

function refText(e) { return '#' + e.id + ' — ' + e.page + ' ▸ ' + e.title; }

function rowHtml(e) {
    return '<div class="fl-row">' +
        '<button type="button" class="fl-id-chip" data-action="copy-ref" data-ref="' + esc(refText(e)) + '">#' + e.id + '</button>' +
        '<span class="' + typeBadgeClass(e) + '">' + esc(e.status === 'removed' ? 'removed' : e.type) + '</span>' +
        '<div class="fl-row-body">' +
            '<div class="fl-row-title">' + esc(e.title) + '</div>' +
            '<div class="fl-row-meta">' + esc(e.page) + ' &middot; ' + esc(e.platform) + (e.does ? ' &middot; ' + esc(e.does) : '') + '</div>' +
        '</div>' +
    '</div>';
}

function render(entries) {
    if (entries.length === 0) { showState('empty'); return; }

    const groups = groupByUpdatedDesc(entries);
    let largestIdx = 0;
    groups.forEach((g, i) => { if (g[1].length > groups[largestIdx][1].length) largestIdx = i; });

    let html = '';
    groups.forEach((g, i) => {
        const [date, rows] = g;
        const isBaseline = i === largestIdx;
        html += '<details class="fl-date-group"' + (isBaseline ? '' : ' open') + '>' +
            '<summary class="fl-date-header">' +
                '<span>' + esc(date) + (isBaseline ? ' (baseline)' : '') + '</span>' +
                '<span style="display:flex;align-items:center;gap:0.5rem;">' +
                    '<span style="font-weight:500;color:#6b7280;font-size:0.8125rem;">' + rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + '</span>' +
                    '<svg class="fl-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
                '</span>' +
            '</summary>' +
            rows.map(rowHtml).join('') +
        '</details>';
    });

    document.getElementById('logContainer').innerHTML = html;
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

async function loadFeaturesLog() {
    showState('loading');
    try {
        const res = await fetch('/api/admin-docs/feature-index', { headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error((data && data.message) || ('HTTP ' + res.status));
        const entries = (data.feature_index && data.feature_index.entries) || [];
        computeStats(entries);
        render(entries);
    } catch (err) {
        console.error('Failed to load features log:', err);
        document.getElementById('logContainer').innerHTML =
            '<div class="empty-state"><h3 class="empty-state-title">Failed to load</h3><p class="empty-state-description">' + esc(err.message) + '</p></div>';
        showState('results');
    }
}

document.addEventListener('click', function (e) {
    const copyBtn = e.target.closest('[data-action="copy-ref"]');
    if (copyBtn) {
        copyRef(copyBtn, copyBtn.getAttribute('data-ref'));
    }
});

loadFeaturesLog();
