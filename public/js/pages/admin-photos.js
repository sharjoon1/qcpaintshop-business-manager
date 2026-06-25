// Page logic externalized from admin-photos.html inline <script> (S9+F5 Phase E batch 11, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping/preview/lightbox helpers untouched.
const API = '/api/photos';
const token = localStorage.getItem('auth_token');
const headers = { 'Authorization': 'Bearer ' + token };

function escHtml(s){ if(s==null) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

let categories = [];
let currentCat = '';
let currentPhotos = [];
let currentPage = 1;
let totalPhotos = 0;
let lbIndex = 0;

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
    await loadCategories();
    document.getElementById('dateFilter').addEventListener('change', () => {
        currentPage = 1;
        loadPhotos();
    });
    // Set today as default
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('dateFilter').value = `${yyyy}-${mm}-${dd}`;
});

// ── Load categories ──
async function loadCategories() {
    try {
        const resp = await fetch(API + '/categories', { headers });
        const data = await resp.json();
        if (!data.success) return;
        categories = data.categories;

        // Summary
        const totalFiles = categories.reduce((s, c) => s + c.count, 0);
        const totalSize = categories.reduce((s, c) => s + parseFloat(c.totalSizeMB), 0);
        const attCount = categories.filter(c => c.group === 'attendance').reduce((s, c) => s + c.count, 0);
        const otherCount = categories.filter(c => c.group === 'other').reduce((s, c) => s + c.count, 0);

        document.getElementById('summaryStrip').innerHTML = `
            <div class="summary-item"><div class="val">${totalFiles}</div><div class="lbl">Total Photos</div></div>
            <div class="summary-item"><div class="val">${totalSize.toFixed(1)} MB</div><div class="lbl">Total Size</div></div>
            <div class="summary-item"><div class="val">${attCount}</div><div class="lbl">Attendance (2d)</div></div>
            <div class="summary-item"><div class="val">${otherCount}</div><div class="lbl">Other (7d)</div></div>
        `;

        // Category pills
        let html = '<span class="group-label">Attendance</span>';
        categories.filter(c => c.group === 'attendance').forEach(c => {
            html += `<button class="cat-pill" data-cat="${c.key}" data-action="select-cat">
                ${escHtml(c.label)} <span class="count">${c.count}</span>
            </button>`;
        });
        html += '<div class="group-sep"></div><span class="group-label">Other</span>';
        categories.filter(c => c.group === 'other').forEach(c => {
            html += `<button class="cat-pill" data-cat="${c.key}" data-action="select-cat">
                ${escHtml(c.label)} <span class="count">${c.count}</span>
            </button>`;
        });
        document.getElementById('catBar').innerHTML = html;

        // Auto-select first category with photos, or first
        const firstWithPhotos = categories.find(c => c.count > 0) || categories[0];
        if (firstWithPhotos) selectCat(firstWithPhotos.key);
    } catch (err) {
        console.error('loadCategories error:', err);
    }
}

// ── Select category ──
function selectCat(key) {
    currentCat = key;
    currentPage = 1;
    currentPhotos = [];

    // Update pill active state
    document.querySelectorAll('.cat-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.cat === key);
    });

    loadPhotos();
}

// ── Load photos ──
async function loadPhotos() {
    const grid = document.getElementById('photoGrid');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('emptyState');
    const loadMoreWrap = document.getElementById('loadMoreWrap');

    if (currentPage === 1) {
        grid.innerHTML = '';
        currentPhotos = [];
    }
    loading.style.display = 'block';
    empty.style.display = 'none';
    loadMoreWrap.style.display = 'none';

    try {
        const date = document.getElementById('dateFilter').value;
        const url = `${API}/list?category=${currentCat}&page=${currentPage}&limit=60${date ? '&date=' + date : ''}`;
        const resp = await fetch(url, { headers });
        const data = await resp.json();

        loading.style.display = 'none';

        if (!data.success) return;

        totalPhotos = data.total;
        document.getElementById('photoCount').textContent = `${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''}`;

        if (data.photos.length === 0 && currentPage === 1) {
            empty.style.display = 'block';
            return;
        }

        const startIdx = currentPhotos.length;
        currentPhotos.push(...data.photos);

        data.photos.forEach((photo, i) => {
            const card = document.createElement('div');
            card.className = 'photo-card';
            card.onclick = () => openLightbox(startIdx + i);

            const timeStr = fmtTime(photo.mtime);
            card.innerHTML = `
                <img src="${photo.url}" alt="${escHtml(photo.filename)}" loading="lazy" data-action="img-fallback">
                <div class="info">
                    <div class="name">${escHtml(photo.userName || 'Unknown')}</div>
                    <div class="meta">${timeStr} &bull; ${photo.sizeMB} MB</div>
                </div>
            `;
            grid.appendChild(card);
        });

        // Show load more if there's more
        if (currentPhotos.length < totalPhotos) {
            loadMoreWrap.style.display = 'block';
        }
    } catch (err) {
        loading.style.display = 'none';
        console.error('loadPhotos error:', err);
    }
}

function loadMore() {
    currentPage++;
    loadPhotos();
}

// ── Lightbox ──
function openLightbox(idx) {
    lbIndex = idx;
    showLightboxPhoto();
    document.getElementById('lightbox').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
    document.body.style.overflow = '';
}

function navLightbox(dir) {
    lbIndex = Math.max(0, Math.min(currentPhotos.length - 1, lbIndex + dir));
    showLightboxPhoto();
}

function showLightboxPhoto() {
    const photo = currentPhotos[lbIndex];
    if (!photo) return;
    document.getElementById('lbImg').src = photo.url;
    document.getElementById('lbInfo').innerHTML =
        `<strong>${escHtml(photo.userName || 'Unknown')}</strong> &bull; ${fmtTime(photo.mtime)} &bull; ${photo.sizeMB} MB<br>
        <span style="opacity:0.6; font-size:11px;">${escHtml(photo.filename)}</span>`;
}

// Keyboard nav
document.addEventListener('keydown', e => {
    if (!document.getElementById('lightbox').classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navLightbox(-1);
    if (e.key === 'ArrowRight') navLightbox(1);
});

// ── Manual cleanup ──
async function manualCleanup() {
    if (!confirm('Delete all photos older than their retention period?\n\nAttendance: 2 days\nOther: 7 days')) return;
    const btn = document.getElementById('cleanupBtn');
    btn.disabled = true;
    btn.textContent = 'Cleaning...';
    try {
        const resp = await fetch(API + '/cleanup', { method: 'DELETE', headers });
        const data = await resp.json();
        if (data.success) {
            let msg = `Deleted ${data.deleted} files.`;
            if (data.errors > 0) msg += ` (${data.errors} errors)`;

            // Show per-category breakdown
            const details = Object.entries(data.byCategory || {})
                .filter(([, v]) => v.deleted > 0)
                .map(([k, v]) => `${k}: ${v.deleted}`)
                .join(', ');
            if (details) msg += '\n\n' + details;

            alert(msg);
            loadCategories(); // Refresh
        } else {
            alert('Cleanup failed: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
    btn.disabled = false;
    btn.textContent = '🗑 Run Cleanup';
}

// ── Helpers ──
function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const day = d.getDate();
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    const h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${day} ${mon} ${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Run Cleanup button (was onclick="manualCleanup()")
document.getElementById('cleanupBtn').addEventListener('click', () => manualCleanup());
// All Dates button (was onclick="document.getElementById('dateFilter').value=''; loadPhotos()")
document.getElementById('allDatesBtn').addEventListener('click', () => { document.getElementById('dateFilter').value=''; loadPhotos(); });
// Load More button (was onclick="loadMore()")
document.getElementById('loadMoreBtn').addEventListener('click', () => loadMore());
// Lightbox close × button (was onclick="closeLightbox()")
document.getElementById('lbCloseBtn').addEventListener('click', () => closeLightbox());
// Lightbox prev button (was onclick="navLightbox(-1)")
document.getElementById('lbPrevBtn').addEventListener('click', () => navLightbox(-1));
// Lightbox next button (was onclick="navLightbox(1)")
document.getElementById('lbNextBtn').addEventListener('click', () => navLightbox(1));

// Delegated dispatcher for runtime-rendered buttons (replaces inline onclick="selectCat(...)"
// and the img onerror fallback). One document-level listener routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'select-cat') {
        selectCat(btn.getAttribute('data-cat'));
    }
});

// Delegated img error handler (was onerror="this.src='...svg fallback...'"). Replaces the broken-preview
// inline handler with the same SVG data-URI fallback.
const FALLBACK_SVG = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f1f5f9%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2212%22>No preview</text></svg>";
document.addEventListener('error', function (e) {
    const img = e.target;
    if (!(img instanceof HTMLElement) || img.tagName !== 'IMG' || img.getAttribute('data-action') !== 'img-fallback') return;
    if (img.src === FALLBACK_SVG) return; // avoid loop
    img.src = FALLBACK_SVG;
}, true); // capture phase — 'error' does not bubble
