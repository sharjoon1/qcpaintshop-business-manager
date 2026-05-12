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
    +   '<a href="/engineer-cart.html" class="ep-rail-item" data-page="cart">'
    +     '<svg class="ep-rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>'
    +     '<span>Cart</span>'
    +     '<span class="ep-rail-badge" data-cart-count style="display:none;">0</span>'
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

  /* ──────── Cart (engineer-side, persisted in localStorage) ──────── */
  var CART_KEY = 'engineer_cart_v1';

  function cartRead() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (!data || !Array.isArray(data.items)) return { items: [] };
      return data;
    } catch (_) { return { items: [] }; }
  }
  function cartWrite(cart) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (_) {}
    document.dispatchEvent(new CustomEvent('ep:cart-changed', { detail: cart }));
    refreshCartBadges();
  }
  function cartCount() {
    return cartRead().items.reduce(function (sum, it) { return sum + (parseInt(it.quantity, 10) || 0); }, 0);
  }
  function cartSubtotal() {
    return cartRead().items.reduce(function (sum, it) {
      return sum + (parseFloat(it.effective_rate || 0) * (parseInt(it.quantity, 10) || 0));
    }, 0);
  }
  function cartAdd(item, qty) {
    var cart = cartRead();
    var q = parseInt(qty, 10);
    if (!Number.isFinite(q) || q < 1) q = 1;
    var existing = cart.items.find(function (it) { return it.pack_size_id === item.pack_size_id; });
    if (existing) {
      existing.quantity = (parseInt(existing.quantity, 10) || 0) + q;
    } else {
      cart.items.push({
        product_id:     item.product_id,
        product_name:   item.product_name,
        pack_size_id:   item.pack_size_id,
        zoho_item_id:   item.zoho_item_id,
        zoho_item_name: item.zoho_item_name,
        size_label:     item.size_label,
        color_name:     item.color_name || null,
        brand:          item.brand,
        category:       item.category || null,
        image_url:      item.image_url || null,
        list_rate:      parseFloat(item.list_rate || 0),
        effective_rate: parseFloat(item.effective_rate || item.list_rate || 0),
        discount_pct:   parseFloat(item.discount_pct || 0),
        quantity:       q
      });
    }
    cart.updated_at = Date.now();
    cartWrite(cart);
    return cart;
  }
  function cartSetQty(packSizeId, qty) {
    var cart = cartRead();
    var q = parseInt(qty, 10);
    if (!Number.isFinite(q) || q < 1) {
      cart.items = cart.items.filter(function (it) { return it.pack_size_id !== packSizeId; });
    } else {
      var found = cart.items.find(function (it) { return it.pack_size_id === packSizeId; });
      if (found) found.quantity = q;
    }
    cart.updated_at = Date.now();
    cartWrite(cart);
    return cart;
  }
  function cartRemove(packSizeId) { return cartSetQty(packSizeId, 0); }
  function cartClear() {
    var empty = { items: [], updated_at: Date.now() };
    cartWrite(empty);
    return empty;
  }
  async function cartSubmit(payload) {
    var cart = cartRead();
    if (!cart.items.length) throw new Error('Cart is empty.');
    var body = Object.assign({}, payload, {
      items: cart.items.map(function (it) {
        return { pack_size_id: it.pack_size_id, quantity: parseInt(it.quantity, 10) || 1 };
      })
    });
    var r = await fetch(API_BASE + '/me/orders', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if (handleAuthFail(r)) return null;
    var data = await r.json();
    if (!data.success) throw new Error(data.message || 'Submission failed.');
    cartClear();
    return data;
  }

  function refreshCartBadges() {
    var n = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.style.display = n > 0 ? '' : 'none';
    });
    document.querySelectorAll('[data-cart-empty]').forEach(function (el) {
      el.style.display = n === 0 ? '' : 'none';
    });
    document.querySelectorAll('[data-cart-not-empty]').forEach(function (el) {
      el.style.display = n > 0 ? '' : 'none';
    });
  }

  // Toast
  function toast(text, kind) {
    var t = document.getElementById('epToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'epToast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);background:#0F172A;color:#fff;padding:10px 18px;border-radius:6px;font-size:13px;z-index:200;box-shadow:0 10px 30px rgba(0,0,0,0.25);opacity:0;transition:opacity 0.18s, transform 0.18s;pointer-events:none;font-weight:500;';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.background = kind === 'err' ? '#B91C1C' : (kind === 'ok' ? '#15803D' : '#0F172A');
    requestAnimationFrame(function () {
      t.style.opacity = '1';
      t.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(window.__epToastT);
    window.__epToastT = setTimeout(function () {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(16px)';
    }, 2400);
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
    loadMe: loadMe,
    cart: {
      read: cartRead, write: cartWrite, count: cartCount, subtotal: cartSubtotal,
      add: cartAdd, setQty: cartSetQty, remove: cartRemove, clear: cartClear, submit: cartSubmit
    },
    refreshCartBadges: refreshCartBadges,
    toast: toast
  };

  // Auto-init
  function init() { authGate(); mountRail(); wireRail(); refreshCartBadges(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
