// admin-engineers page logic — externalized from admin-engineers.html (S9+F5 strict CSP).
// Non-deferred, loaded right before </body> (matches original end-of-body timing).
//
// Inline on*= handlers (static + runtime-injected inside innerHTML templates) were converted
// to data-action attributes + a single delegated document-level click listener. No logic,
// function names, or escaping (escHTML) were changed.
    var API = '/api/engineers';
    var state = {
      page: 1,
      perPage: 20,
      status: '',
      q: '',
      total: 0,
      current: null
    };

    function authHeaders(extra) {
      var t = localStorage.getItem('auth_token') || '';
      var h = { 'Authorization': 'Bearer ' + t };
      if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
      return h;
    }
    function toast(msg, kind) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.toggle('err', kind === 'err');
      t.classList.add('show');
      setTimeout(function () { t.classList.remove('show'); }, 2400);
    }
    function escHTML(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
      });
    }
    function fmtINR(n) {
      var num = Number(n || 0);
      return '₹ ' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }

    async function fetchList() {
      var params = new URLSearchParams();
      params.set('page', state.page);
      params.set('per_page', state.perPage);
      if (state.status) params.set('status', state.status);
      if (state.q) params.set('q', state.q);
      var r = await fetch(API + '?' + params.toString(), { headers: authHeaders() });
      if (r.status === 401 || r.status === 403) {
        toast('Session expired — sign in again', 'err');
        setTimeout(function () { window.location.href = '/login.html'; }, 1200);
        return null;
      }
      return r.json();
    }

    function renderStats(counts) {
      var p = +counts.pending || 0, a = +counts.approved || 0, s = +counts.suspended || 0, r = +counts.rejected || 0;
      document.getElementById('stTotal').textContent = (p + a + s + r);
      document.getElementById('stPending').textContent = p;
      document.getElementById('stApproved').textContent = a;
      document.getElementById('stSuspended').textContent = (s + r);
    }

    function renderRows(rows) {
      var tbody = document.getElementById('engBody');
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="em">— No engineers found —</div><div>Adjust your filter or wait for new registrations.</div></div></td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(function (e) {
        var initial = (e.full_name || 'E').charAt(0).toUpperCase();
        var status = e.status || 'pending';
        var company = e.company_name || '<span class="text-gray-400">—</span>';
        var gst = e.gst_number ? '<div class="text-xs text-gray-500 mt-0.5">GST ' + escHTML(e.gst_number) + '</div>' : '';
        return '<tr>'
          + '<td><div class="flex items-center gap-3">'
          +   '<div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">' + escHTML(initial) + '</div>'
          +   '<div><div class="font-semibold text-gray-900">' + escHTML(e.full_name || '—') + '</div>'
          +     (e.designation ? '<div class="text-xs text-gray-500">' + escHTML(e.designation) + '</div>' : '')
          +   '</div></div></td>'
          + '<td>+91 ' + escHTML(e.phone) + '</td>'
          + '<td>' + (typeof company === 'string' ? escHTML(company) : company) + gst + '</td>'
          + '<td>' + escHTML(e.city || '—') + '</td>'
          + '<td>' + (e.credit_enabled ? fmtINR(e.credit_limit) : '<span class="text-gray-400">Disabled</span>') + '</td>'
          + '<td><span class="badge badge-' + status + '">' + status + '</span></td>'
          + '<td style="text-align:right;">'
          +   '<button class="btn-sm btn-outline" data-action="open-modal" data-id="' + e.id + '">Manage</button>'
          + '</td>'
          + '</tr>';
      }).join('');
    }

    function renderPager(total) {
      var pages = Math.max(1, Math.ceil(total / state.perPage));
      var info = document.getElementById('pagerInfo');
      var w = document.getElementById('pagerWrap');
      if (total <= state.perPage) { w.style.display = 'none'; return; }
      w.style.display = 'flex';
      info.textContent = 'Page ' + state.page + ' of ' + pages + ' · ' + total + ' total';
      document.getElementById('prevBtn').disabled = state.page <= 1;
      document.getElementById('nextBtn').disabled = state.page >= pages;
    }

    async function reload() {
      var data = await fetchList();
      if (!data) return;
      if (!data.success) { toast(data.message || 'Failed to load', 'err'); return; }
      state.total = data.total || 0;
      renderStats(data.counts || {});
      renderRows(data.data || []);
      renderPager(data.total || 0);
    }

    // === Modal ===
    async function openModal(id) {
      try {
        var r = await fetch(API + '/' + id, { headers: authHeaders() });
        var data = await r.json();
        if (!data.success) { toast(data.message || 'Failed to load', 'err'); return; }
        var e = data.engineer;
        state.current = e;

        document.getElementById('mTitle').textContent = e.full_name || 'Engineer';
        document.getElementById('mSubtitle').textContent = (e.designation || '—') + ' · ' + (e.company_name || 'no company');
        document.getElementById('m_phone').textContent = '+91 ' + e.phone;
        ['full_name','email','designation','company_name','gst_number','address','city','district','pincode','pan_number','notes'].forEach(function (k) {
          var el = document.getElementById('m_' + k);
          if (el) el.value = e[k] || '';
        });
        document.getElementById('m_credit_limit').value = e.credit_limit || 0;
        document.getElementById('m_credit_enabled').value = e.credit_enabled ? '1' : '0';
        document.getElementById('m_credit_used').textContent = fmtINR(e.credit_used);
        document.getElementById('m_total_spend').textContent = fmtINR(e.total_spend);
        document.getElementById('m_rejected_block').style.display = e.rejected_reason ? 'block' : 'none';
        document.getElementById('m_rejected_reason').textContent = e.rejected_reason || '';

        var actions = [];
        if (e.status === 'pending') {
          actions.push('<button class="btn-sm btn-success" data-action="approve">✓ Approve</button>');
          actions.push('<button class="btn-sm btn-danger" data-action="reject">✗ Reject</button>');
        } else if (e.status === 'approved') {
          actions.push('<button class="btn-sm btn-outline" data-action="suspend">Suspend</button>');
        } else if (e.status === 'suspended' || e.status === 'rejected') {
          actions.push('<button class="btn-sm btn-success" data-action="reinstate">Re-approve</button>');
        }
        actions.push('<button class="btn-sm btn-danger" data-action="delete">Delete</button>');
        actions.push('<button class="btn-sm btn-primary" data-action="save">Save changes</button>');
        document.getElementById('mActions').innerHTML = actions.join('');

        document.getElementById('engModal').classList.add('open');
        loadRates();
      } catch (err) {
        toast('Failed to load engineer', 'err');
      }
    }
    function closeModal() { document.getElementById('engModal').classList.remove('open'); state.current = null; }

    async function doSave() {
      if (!state.current) return;
      var payload = {};
      ['full_name','email','designation','company_name','gst_number','address','city','district','pincode','pan_number','notes'].forEach(function (k) {
        var el = document.getElementById('m_' + k);
        if (!el) return;
        payload[k] = el.value === '' ? null : el.value.trim();
      });
      if (payload.gst_number) payload.gst_number = payload.gst_number.toUpperCase();
      if (payload.pan_number) payload.pan_number = payload.pan_number.toUpperCase();
      payload.credit_limit = parseFloat(document.getElementById('m_credit_limit').value) || 0;
      payload.credit_enabled = document.getElementById('m_credit_enabled').value === '1' ? 1 : 0;

      try {
        var r = await fetch(API + '/' + state.current.id, {
          method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Save failed');
        toast('Saved.');
        await reload();
        closeModal();
      } catch (err) { toast(err.message, 'err'); }
    }

    async function doApprove() {
      if (!state.current) return;
      try {
        var r = await fetch(API + '/' + state.current.id + '/approve', { method: 'POST', headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Approve failed');
        toast('Engineer approved.');
        await reload(); closeModal();
      } catch (err) { toast(err.message, 'err'); }
    }
    async function doSuspend() {
      if (!state.current) return;
      if (!confirm('Suspend this engineer?')) return;
      try {
        var r = await fetch(API + '/' + state.current.id + '/suspend', { method: 'POST', headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Suspend failed');
        toast('Engineer suspended.');
        await reload(); closeModal();
      } catch (err) { toast(err.message, 'err'); }
    }
    async function doReinstate() {
      if (!state.current) return;
      try {
        var r = await fetch(API + '/' + state.current.id + '/reinstate', { method: 'POST', headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Reinstate failed');
        toast('Engineer reinstated.');
        await reload(); closeModal();
      } catch (err) { toast(err.message, 'err'); }
    }
    async function doDelete() {
      if (!state.current) return;
      if (!confirm('Permanently delete ' + (state.current.full_name || 'this engineer') + '? This cannot be undone.')) return;
      try {
        var r = await fetch(API + '/' + state.current.id, { method: 'DELETE', headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Delete failed');
        toast('Engineer deleted.');
        await reload(); closeModal();
      } catch (err) { toast(err.message, 'err'); }
    }

    function openRejectModal() { document.getElementById('rejectReason').value = ''; document.getElementById('rejectModal').classList.add('open'); }
    function closeRejectModal() { document.getElementById('rejectModal').classList.remove('open'); }
    document.getElementById('rejectConfirm').addEventListener('click', async function () {
      if (!state.current) return;
      var reason = document.getElementById('rejectReason').value.trim();
      if (!reason) { toast('Please provide a reason', 'err'); return; }
      try {
        var r = await fetch(API + '/' + state.current.id + '/reject', {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ reason: reason })
        });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Reject failed');
        toast('Engineer rejected.');
        closeRejectModal();
        await reload(); closeModal();
      } catch (err) { toast(err.message, 'err'); }
    });

    // === Rates management ===
    async function loadRates() {
      if (!state.current) return;
      var wrap = document.getElementById('ratesListWrap');
      wrap.innerHTML = '<div style="padding:14px;text-align:center;color:#94a3b8;font-size:13px;">Loading rates...</div>';
      try {
        var r = await fetch(API + '/' + state.current.id + '/rates', { headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Failed to load rates');
        var rates = data.rates || [];
        if (!rates.length) {
          wrap.innerHTML = '<div style="padding:14px; text-align:center; color:#94a3b8; font-size: 13px;">No custom rates configured. Engineer sees list prices.</div>';
          return;
        }
        wrap.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
          + '<thead><tr style="border-bottom:1px solid #e8ecf1;">'
          +   '<th style="text-align:left;padding:6px 8px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Scope</th>'
          +   '<th style="text-align:left;padding:6px 8px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Target</th>'
          +   '<th style="text-align:right;padding:6px 8px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Discount</th>'
          +   '<th style="padding:6px 8px;"></th>'
          + '</tr></thead><tbody>'
          + rates.map(function (rt) {
              var badge = '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:0.65rem;">' + escHTML(rt.scope) + '</span>';
              return '<tr style="border-bottom:1px solid #f1f5f9;">'
                + '<td style="padding:8px;">' + badge + '</td>'
                + '<td style="padding:8px;color:#1e293b;font-weight:500;">' + escHTML(rt.display_name || rt.target_id) + (rt.notes ? '<div style="font-size:11px;color:#64748b;">' + escHTML(rt.notes) + '</div>' : '') + '</td>'
                + '<td style="padding:8px;text-align:right;color:#10b981;font-weight:700;">' + parseFloat(rt.discount_pct).toFixed(2) + '%</td>'
                + '<td style="padding:8px;text-align:right;"><button class="btn-sm btn-danger" type="button" data-action="delete-rate" data-id="' + rt.id + '" style="padding:3px 8px;font-size:0.7rem;">Remove</button></td>'
                + '</tr>';
            }).join('')
          + '</tbody></table>';
      } catch (err) {
        wrap.innerHTML = '<div style="padding:14px;text-align:center;color:#b91c1c;font-size:13px;">' + escHTML(err.message) + '</div>';
      }
    }
    async function addRate() {
      if (!state.current) return;
      var scope = document.getElementById('r_scope').value;
      var target = document.getElementById('r_target').value.trim();
      var disc = parseFloat(document.getElementById('r_discount').value);
      var notes = document.getElementById('r_notes').value.trim();
      if (!target) { toast('Enter a target value', 'err'); return; }
      if (!Number.isFinite(disc) || disc < 0 || disc > 100) { toast('Discount must be 0-100', 'err'); return; }
      try {
        var r = await fetch(API + '/' + state.current.id + '/rates', {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ scope: scope, target_id: target, discount_pct: disc, notes: notes || null })
        });
        var data = await r.json();
        if (!data.success) throw new Error(data.message);
        document.getElementById('r_target').value = '';
        document.getElementById('r_discount').value = '';
        document.getElementById('r_notes').value = '';
        toast('Rate saved.');
        await loadRates();
      } catch (err) { toast(err.message, 'err'); }
    }
    async function deleteRate(rateId) {
      if (!state.current) return;
      if (!confirm('Remove this rate?')) return;
      try {
        var r = await fetch(API + '/' + state.current.id + '/rates/' + rateId, { method: 'DELETE', headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message);
        toast('Rate removed.');
        await loadRates();
      } catch (err) { toast(err.message, 'err'); }
    }

    // === Filter & search wiring ===
    document.getElementById('statusPills').addEventListener('click', function (e) {
      var t = e.target.closest('.pill');
      if (!t) return;
      document.querySelectorAll('#statusPills .pill').forEach(function (p) { p.classList.remove('active'); });
      t.classList.add('active');
      state.status = t.getAttribute('data-status') || '';
      state.page = 1;
      reload();
    });
    var sTimer;
    document.getElementById('searchInput').addEventListener('input', function (e) {
      clearTimeout(sTimer);
      sTimer = setTimeout(function () { state.q = e.target.value.trim(); state.page = 1; reload(); }, 280);
    });
    document.getElementById('refreshBtn').addEventListener('click', reload);
    document.getElementById('prevBtn').addEventListener('click', function () { if (state.page > 1) { state.page--; reload(); } });
    document.getElementById('nextBtn').addEventListener('click', function () { state.page++; reload(); });

    // Close modal on backdrop click
    document.getElementById('engModal').addEventListener('click', function (e) { if (e.target.id === 'engModal') closeModal(); });
    document.getElementById('rejectModal').addEventListener('click', function (e) { if (e.target.id === 'rejectModal') closeRejectModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeModal(); closeRejectModal(); }
    });

    // === Delegated click listener for runtime-injected data-action buttons ===
    // Replaces the former inline onclick="openModal(id)" / doApprove() / deleteRate(id) handlers
    // that lived inside innerHTML template strings.
    document.addEventListener('click', function (ev) {
      var t = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
      if (!t) return;
      var action = t.getAttribute('data-action');
      if (action === 'open-modal') {
        openModal(t.getAttribute('data-id'));
      } else if (action === 'approve') {
        doApprove();
      } else if (action === 'reject') {
        openRejectModal();
      } else if (action === 'suspend') {
        doSuspend();
      } else if (action === 'reinstate') {
        doReinstate();
      } else if (action === 'delete') {
        doDelete();
      } else if (action === 'save') {
        doSave();
      } else if (action === 'delete-rate') {
        deleteRate(t.getAttribute('data-id'));
      }
    });

    // === Static handler wiring (converted from inline on*= attributes in the HTML) ===
    // Modal "Close ×" button (was onclick="closeModal()")
    var closeBtn = document.querySelector('#engModal .modal-head .btn-outline');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    // Modal "Close" was converted to id below; cover both for safety.
    var closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    // Reject modal "Cancel" button (was onclick="closeRejectModal()")
    var cancelRejectBtn = document.getElementById('cancelRejectBtn');
    if (cancelRejectBtn) cancelRejectBtn.addEventListener('click', closeRejectModal);
    // Modal "Add / Update Rate" button (was onclick="addRate()")
    var addRateBtn = document.getElementById('addRateBtn');
    if (addRateBtn) addRateBtn.addEventListener('click', addRate);

    // Initial: honor ?status= deep link
    (function initFromUrl() {
      var u = new URLSearchParams(window.location.search);
      var s = u.get('status');
      if (s && ['pending','approved','suspended','rejected'].indexOf(s) !== -1) {
        state.status = s;
        document.querySelectorAll('#statusPills .pill').forEach(function (p) {
          p.classList.toggle('active', p.getAttribute('data-status') === s);
        });
      }
    })();
    reload();
