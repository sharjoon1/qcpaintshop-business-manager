// Page logic for staff/agreement.html. Externalized verbatim from the page's end-of-body
// inline <script> (S9+F5 Phase E batch 10, 2026-06-25) so the page runs under the enforced strict
// CSP. Loaded as a NON-deferred classic script right before </body>, matching the original timing.
// Inline on*= handlers converted to addEventListener + data-action delegation. No logic changes,
// no renames. Static handler wiring appended at the bottom.
let selectedFile = null;

async function loadAgreement() {
    try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/agreements/my', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();

        document.getElementById('loadingCard').style.display = 'none';

        if (!data.success || !data.agreement) {
            document.getElementById('agreementCard').innerHTML = '<p style="text-align:center;color:#6b7280;padding:30px;">ஒப்பந்தம் இல்லை.</p>';
            document.getElementById('agreementCard').style.display = 'block';
            return;
        }

        const staff = data.staff || {};
        const record = data.record || {};

        // Fill staff info
        document.getElementById('infoName').textContent   = staff.full_name || '—';
        document.getElementById('infoRole').textContent   = staff.role || '—';
        document.getElementById('infoBranch').textContent = staff.branch_name || '—';
        document.getElementById('infoJoined').textContent = staff.joined_at
            ? new Date(staff.joined_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', timeZone:'Asia/Kolkata' })
            : '—';
        document.getElementById('role1').textContent      = staff.role || 'ஊழியராக';
        document.getElementById('signName').textContent   = staff.full_name || 'ஊழியர் கையொப்பம்';
        document.getElementById('signRole').textContent   = staff.role || '';
        document.getElementById('agrVersion').textContent = 'Version ' + (data.agreement.version || '1.0');

        document.getElementById('agreementCard').style.display = 'block';

        // Status badge
        const badge = document.getElementById('statusBadge');
        const status = record.status || 'pending';
        const labels = { pending:'⏳ Pending', viewed:'👁️ Viewed', uploaded:'✅ Signed & Uploaded' };
        badge.textContent = labels[status] || status;
        badge.className = 'status-badge status-' + status;

        // Mark viewed
        if (status === 'pending') {
            await fetch('/api/agreements/viewed', { method:'POST', headers: { Authorization:`Bearer ${token}` } });
            badge.textContent = '👁️ Viewed';
            badge.className = 'status-badge status-viewed';
        }

        // Actions
        const actionCard = document.getElementById('actionCard');
        actionCard.style.display = 'block';
        if (status === 'uploaded') {
            document.getElementById('showUploadBtn').style.display = 'none';
            document.getElementById('uploadedMsg').style.display = 'block';
        }

    } catch (err) {
        console.error(err);
        document.getElementById('loadingCard').innerHTML = '<p style="color:#dc2626;text-align:center;">ஏற்றுவதில் பிழை. பின்னர் முயற்சிக்கவும்.</p>';
    }
}

// ── Print footer (fixed — repeats on every page on Chrome Android) ───────────
(function () {
    let footer = null;
    function inject() {
        if (footer) return;
        footer = document.createElement('div');
        footer.className = 'pn-footer';
        footer.innerHTML =
            '<span class="pn-left">Quality Colours — வேலை ஒப்பந்தம் | Confidential</span>' +
            '<span class="pn-right"></span>';
        document.body.appendChild(footer);
    }
    function cleanup() { if (footer) { footer.remove(); footer = null; } }
    window.addEventListener('beforeprint', inject);
    window.addEventListener('afterprint', cleanup);
})();

// ── Async printAgreement — measures via off-screen clone at print width ───────
// Chrome Android measures at mobile viewport (~360px) which inflates scrollHeight.
// Fix: clone the doc into a hidden fixed div at actual print content width (703px),
// measure there, then insert markers at corresponding positions in original doc.
async function printAgreement() {
    const doc = document.getElementById('agreementDoc');

    // Hide nav chrome
    const navSels = ['.qc-mobile-quickbar','#mobileQuickbar','.qc-sidebar','#qcSidebar','.qc-topbar','#qcTopbar','.qc-subnav','#qcSubnav','[class*="quickbar"]','[class*="sidebar"]'];
    const hidden = [];
    navSels.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (el.style.display !== 'none') {
                el.dataset.prevDisplay = el.style.display || '';
                el.style.setProperty('display','none','important');
                hidden.push(el);
            }
        });
    });

    // Remove leftover stamps
    document.querySelectorAll('.pn-abs').forEach(el => el.remove());

    // ── Measure print height via off-screen clone at actual print width ──────────
    // Mobile viewport (~360px) inflates scrollHeight vs print width (~703–726px).
    // Clone into a hidden fixed div at 703px (≈ A4 content; Letter is 726px).
    const PRINT_W = 703;
    // Letter: (279.4mm − 14mm − 24mm) × 96/25.4 = 912px  |  A4: 978px
    const PAGE_H  = 912;

    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
        position: 'fixed', left: '-9999px', top: '0',
        width: PRINT_W + 'px', visibility: 'hidden', pointerEvents: 'none', zIndex: '-1'
    });
    const clone = doc.cloneNode(true);
    clone.querySelectorAll('.pn-abs').forEach(el => el.remove());
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const H = wrapper.scrollHeight;
    const N = Math.max(1, Math.ceil(H / PAGE_H));
    document.body.removeChild(wrapper);

    // ── Insert absolute page-number stamps at the bottom of each page ─────────
    // position:absolute inside position:relative #agreementDoc.
    // top = p×PAGE_H − 14  places the stamp 14px above page p's content-area bottom.
    // Last page uses H−14 so the stamp never exceeds the document height.
    // Absolute children don't affect normal-flow height → no extra pages.
    for (let p = 1; p <= N; p++) {
        const topPx = (p < N) ? (p * PAGE_H - 14) : (H - 14);
        const stamp = document.createElement('div');
        stamp.className = 'pn-abs';
        stamp.style.top = topPx + 'px';
        stamp.textContent = 'பக்கம் ' + p + ' / ' + N;
        doc.appendChild(stamp);
    }

    window.print();

    window.addEventListener('afterprint', function cleanup() {
        document.querySelectorAll('.pn-abs').forEach(el => el.remove());
        hidden.forEach(el => { el.style.display = el.dataset.prevDisplay || ''; });
        window.removeEventListener('afterprint', cleanup);
    });
}

function handleFileSelect(input) {
    if (!input.files || !input.files[0]) return;
    selectedFile = input.files[0];
    document.getElementById('uploadPlaceholder').style.display = 'none';
    document.getElementById('fileSelected').style.display = 'block';
    document.getElementById('fileName').textContent = selectedFile.name;
    document.getElementById('uploadBtn').disabled = false;
}

async function uploadDocument() {
    if (!selectedFile) return;
    const btn = document.getElementById('uploadBtn');
    const btnText = document.getElementById('uploadBtnText');
    btn.disabled = true;
    btnText.textContent = 'Uploading...';

    const formData = new FormData();
    formData.append('document', selectedFile);

    try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/agreements/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('uploadedMsg').style.display = 'block';
            document.getElementById('statusBadge').textContent = '✅ Signed & Uploaded';
            document.getElementById('statusBadge').className = 'status-badge status-uploaded';
        } else {
            alert(data.message || 'Upload failed. Please try again.');
            btn.disabled = false;
            btnText.textContent = '✓ Submit';
        }
    } catch (err) {
        alert('Network error. Please try again.');
        btn.disabled = false;
        btnText.textContent = '✓ Submit';
    }
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 10, 2026-06-25) ──
// Back button (was onclick="history.back()")
document.getElementById('backBtn').addEventListener('click', () => history.back());
// Logo img error → hide (was onerror="this.style.display='none'")
document.getElementById('agrLogo').addEventListener('error', function () { this.style.display = 'none'; });
// Print button (was onclick="printAgreement()")
document.getElementById('printBtn').addEventListener('click', printAgreement);
// Show Upload button → reveal upload section, hide itself
// (was onclick="document.getElementById('uploadSection').style.display='block';this.style.display='none';")
document.getElementById('showUploadBtn').addEventListener('click', function () {
    document.getElementById('uploadSection').style.display = 'block';
    this.style.display = 'none';
});
// Upload zone → trigger file picker (was onclick="document.getElementById('fileInput').click();")
document.getElementById('uploadZone').addEventListener('click', function () {
    document.getElementById('fileInput').click();
});
// File input change (was onchange="handleFileSelect(this)")
document.getElementById('fileInput').addEventListener('change', function () { handleFileSelect(this); });
// Upload/Submit button (was onclick="uploadDocument()")
document.getElementById('uploadBtn').addEventListener('click', uploadDocument);

// Initialize
loadAgreement();
