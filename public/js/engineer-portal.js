/* =====================================================================
   Quality Colours · Engineer Portal — shared client helpers
   Loaded by every authenticated engineer page after the inline rail.
   ===================================================================== */
(function () {
  'use strict';

  var API_BASE = '/api/engineers';
  var ENG_KEYS = [
    'engineer_token', 'engineer_logged_in', 'engineer_id',
    'engineer_phone', 'engineer_name', 'engineer_company', 'engineer_status'
  ];

  function authHeaders(extra) {
    var t = localStorage.getItem('engineer_token') || '';
    var h = { 'X-Engineer-Token': t };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function clearSession() {
    ENG_KEYS.forEach(function (k) { localStorage.removeItem(k); });
  }

  function handleAuthFail(r) {
    if (r && (r.status === 401 || r.status === 403)) {
      clearSession();
      window.location.href = '/engineer-login.html';
      return true;
    }
    return false;
  }

  async function logout() {
    try { await fetch(API_BASE + '/logout', { method: 'POST', headers: authHeaders() }); } catch (_) {}
    clearSession();
    window.location.href = '/engineer-login.html';
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function fmtINR(n, withRupee) {
    if (n == null || isNaN(n)) return '—';
    var num = Math.round(parseFloat(n));
    var s = num.toLocaleString('en-IN');
    return withRupee === false ? s : '₹ ' + s;
  }

  function fmtTimeAgo(d) {
    if (!d) return '';
    var diff = Date.now() - new Date(d).getTime();
    var h = Math.floor(diff / 3600000);
    if (h < 1) return 'just now';
    if (h < 24) return h + 'h ago';
    var days = Math.floor(h / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var STATUS_LABEL = {
    'new': 'Submitted',
    'contacted': 'Under Review',
    'quote_sent': 'Quotation Issued',
    'accepted': 'Approved',
    'rejected': 'Declined',
    'completed': 'Completed',
    'pending':  'Pending Approval',
    'approved': 'Approved',
    'suspended':'Suspended'
  };
  function statusLabel(s) { return STATUS_LABEL[s] || s; }

  var PROJECT_TYPE_LABEL = {
    'interior': 'Interior Painting',
    'exterior': 'Exterior Painting',
    'both': 'Interior & Exterior',
    'commercial': 'Commercial Project',
    'renovation': 'Renovation / Repainting',
    'new_construction': 'New Construction'
  };
  function projectTypeLabel(t) { return PROJECT_TYPE_LABEL[t] || (t || 'Project'); }

  /* ──────── Rail HTML (inlined so authenticated pages only need <div id="epRailMount"></div>) ──────── */
  var RAIL_HTML = ''
    + '<aside class="ep-rail" id="epRail" aria-label="Engineer portal navigation">'
    +   '<div class="ep-rail-head">'
    +     '<div>'
    +       '<div class="ep-rail-brand-name">Quality Colours</div>'
    +       '<div class="ep-rail-brand-sub">Project Engineer</div>'
    +     '</div>'
    +     '<button class="ep-rail-collapse" id="epRailCollapse" type="button" aria-label="Toggle sidebar" title="Toggle sidebar">'
    +       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>'
    +     '</button>'
    +   '</div>'
    +   '<div class="ep-rail-section">Workspace</div>'
    +   '<a href="/engineer-dashboard.html" class="ep-rail-item" data-page="dashboard">'
    +     '<svg class="ep-rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>'
    +     '<span>Dashboard</span>'
    +   '</a>'
    +   '<a href="/engineer-dashboard.html#requisitions" class="ep-rail-item" data-page="requisitions">'
    +     '<svg class="ep-rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>'
    +     '<span>Requisitions</span>'
    +     '<span class="ep-rail-badge" id="epBadgeRequisitions" style="display:none;"></span>'
    +   '</a>'
    +   '<div class="ep-rail-section">Procurement</div>'
    +   '<a href="/engineer-catalog.html" class="ep-rail-item" data-page="catalog">'
    +     '<svg class="ep-rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'
    +     '<span>Catalogue</span>'
    +   '</a>'
    +   '<a href="/engineer-new-quote.html" class="ep-rail-item" data-page="new-quote">'
    +     '<svg class="ep-rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'
    +     '<span>Submit Quotation</span>'
    +   '</a>'
    +   '<div class="ep-rail-section">Account</div>'
    +   '<a href="/engineer-profile.html" class="ep-rail-item" data-page="profile">'
    +     '<svg class="ep-rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    +     '<span>Profile</span>'
    +   '</a>'
    +   '<a href="#" id="epLogout" class="ep-rail-item">'
    +     '<svg class="ep-rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
    +     '<span>Sign Out</span>'
    +   '</a>'
    +   '<div class="ep-rail-foot">'
    +     '<div class="ep-rail-avatar" id="epRailAvatar">E</div>'
    +     '<div class="ep-rail-meta">'
    +       '<b id="epRailName">Engineer</b>'
    +       '<span id="epRailCompany">Account #—</span>'
    +     '</div>'
    +   '</div>'
    + '</aside>';

  function mountRail() {
    var mount = document.getElementById('epRailMount');
    if (mount && !mount.firstChild) mount.outerHTML = RAIL_HTML;
  }

  /* ──────── Rail wiring ──────── */
  function wireRail() {
    var shell = document.getElementById('epShell');
    if (!shell) return;

    // Mark active nav item from <body data-page="...">
    var activePage = document.body.getAttribute('data-page');
    if (activePage) {
      document.querySelectorAll('.ep-rail-item[data-page="' + activePage + '"]').forEach(function (el) {
        el.classList.add('is-active');
      });
    }

    // Logout
    var logoutEl = document.getElementById('epLogout');
    if (logoutEl) logoutEl.addEventListener('click', function (e) { e.preventDefault(); logout(); });

    // Sidebar collapse
    var collapseBtn = document.getElementById('epRailCollapse');
    if (collapseBtn) {
      var saved = localStorage.getItem('ep_rail_collapsed');
      if (saved === '1') shell.classList.add('is-collapsed');
      collapseBtn.addEventListener('click', function () {
        shell.classList.toggle('is-collapsed');
        localStorage.setItem('ep_rail_collapsed', shell.classList.contains('is-collapsed') ? '1' : '0');
      });
    }

    // Mobile open
    var mobileBtn = document.getElementById('epRailMobileBtn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', function () {
        shell.classList.toggle('is-mobile-open');
      });
      shell.addEventListener('click', function (e) {
        if (e.target === shell || (e.target.classList && e.target.classList.contains('ep-main'))) {
          shell.classList.remove('is-mobile-open');
        }
      });
    }

    // Populate avatar / name / company from localStorage
    var name = localStorage.getItem('engineer_name') || '—';
    var company = localStorage.getItem('engineer_company') || '';
    var id = localStorage.getItem('engineer_id') || '';
    var av = document.getElementById('epRailAvatar');
    var n  = document.getElementById('epRailName');
    var c  = document.getElementById('epRailCompany');
    if (av) av.textContent = (name || 'E').charAt(0).toUpperCase();
    if (n)  n.textContent = name;
    if (c)  c.textContent = company || ('Account #' + (id || '—'));
  }

  /* ──────── Auth gate ──────── */
  function authGate() {
    if (document.body.dataset.public === '1') return; // skip for login/register
    var hasToken = localStorage.getItem('engineer_token');
    var loggedIn = localStorage.getItem('engineer_logged_in') === 'true';
    if (!hasToken || !loggedIn) {
      window.location.href = '/engineer-login.html';
    }
  }

  /* ──────── Fetch and hydrate /me ──────── */
  async function loadMe() {
    try {
      var r = await fetch(API_BASE + '/me/status', { headers: authHeaders() });
      if (handleAuthFail(r)) return null;
      var json = await r.json();
      if (!json.success) return null;
      var e = json.engineer;
      try {
        localStorage.setItem('engineer_name', e.full_name || 'Engineer');
        localStorage.setItem('engineer_phone', e.phone || '');
        localStorage.setItem('engineer_company', e.company_name || '');
        localStorage.setItem('engineer_status', e.status || 'pending');
        localStorage.setItem('engineer_id', e.id || '');
      } catch (_) {}
      wireRail(); // refresh rail with newest values
      return e;
    } catch (err) { console.error('[ep] loadMe', err); return null; }
  }

  /* ──────── Expose ──────── */
  window.EP = {
    API_BASE: API_BASE,
    authHeaders: authHeaders,
    handleAuthFail: handleAuthFail,
    logout: logout,
    clearSession: clearSession,
    escapeHTML: escapeHTML,
    fmtINR: fmtINR,
    fmtDate: fmtDate,
    fmtTimeAgo: fmtTimeAgo,
    statusLabel: statusLabel,
    projectTypeLabel: projectTypeLabel,
    loadMe: loadMe
  };

  // Auto-init
  function init() { authGate(); mountRail(); wireRail(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
