// admin-engineer-catalog page logic — externalized from admin-engineer-catalog.html (S9+F5 strict CSP).
// Verbatim move of the original inline script. Runtime onclick= handlers (deleteRate / restoreItem)
// in the table innerHTML templates were converted to data-action + data-* attributes dispatched by a
// single delegated document listener. No logic changes, no renames, escaping helpers untouched.
    var API = '/api/engineers';

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
      if (n == null || isNaN(n)) return '—';
      return '₹ ' + Math.round(parseFloat(n)).toLocaleString('en-IN');
    }
    function fmtDate(d) {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    /* ─── Tabs ─── */
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.tab-pane').forEach(function (p) {
          p.classList.toggle('active', p.dataset.tabPane === tab);
        });
        if (tab === 'rates') loadRates();
        if (tab === 'hidden') loadHidden();
      });
    });

    /* ─── Load filter dropdowns ─── */
    async function loadFilters() {
      try {
        var r = await fetch(API + '/admin/filters', { headers: authHeaders() });
        var data = await r.json();
        if (!data.success) return;
        var b = document.getElementById('rateBrand');
        var c = document.getElementById('rateCategory');
        (data.brands || []).forEach(function (br) {
          var o = document.createElement('option'); o.value = br; o.textContent = br; b.appendChild(o);
        });
        (data.categories || []).forEach(function (cat) {
          var o = document.createElement('option'); o.value = cat; o.textContent = cat; c.appendChild(o);
        });
      } catch (e) { console.error(e); }
    }

    /* ─── Scope switcher ─── */
    document.getElementById('rateScope').addEventListener('change', function (e) {
      var s = e.target.value;
      document.getElementById('brandWrap').style.display    = s === 'brand'    ? '' : 'none';
      document.getElementById('categoryWrap').style.display = s === 'category' ? '' : 'none';
      document.getElementById('itemWrap').style.display     = s === 'item'     ? '' : 'none';
    });

    /* ─── Item picker (shared) ─── */
    function wireItemPicker(searchId, resultsId, hiddenId, selectedId) {
      var input = document.getElementById(searchId);
      var results = document.getElementById(resultsId);
      var hidden = document.getElementById(hiddenId);
      var selected = document.getElementById(selectedId);
      var timer;
      input.addEventListener('input', function () {
        var q = input.value.trim();
        clearTimeout(timer);
        if (q.length < 2) { results.classList.remove('is-open'); return; }
        timer = setTimeout(async function () {
          try {
            var r = await fetch(API + '/admin/items/search?q=' + encodeURIComponent(q), { headers: authHeaders() });
            var data = await r.json();
            if (!data.success) return;
            if (!data.items.length) {
              results.innerHTML = '<div class="picker-row" style="cursor:default;color:#94a3b8;">No matching items.</div>';
            } else {
              results.innerHTML = data.items.map(function (it) {
                return '<div class="picker-row" data-id="' + escHTML(it.zoho_item_id) + '" data-name="' + escHTML(it.zoho_item_name) + '" data-brand="' + escHTML(it.zoho_brand || '') + '">'
                  + '<div class="name">' + escHTML(it.zoho_item_name) + '</div>'
                  + '<div class="meta">' + escHTML(it.zoho_brand || '—') + ' · ' + fmtINR(it.zoho_rate) + ' · ' + escHTML(it.zoho_item_id) + '</div>'
                  + '</div>';
              }).join('');
              results.querySelectorAll('[data-id]').forEach(function (row) {
                row.addEventListener('click', function () {
                  hidden.value = row.dataset.id;
                  selected.innerHTML = 'Selected: <strong>' + escHTML(row.dataset.name) + '</strong> <span class="text-gray-400">(' + escHTML(row.dataset.id) + ')</span>';
                  input.value = row.dataset.name;
                  results.classList.remove('is-open');
                });
              });
            }
            results.classList.add('is-open');
          } catch (e) { console.error(e); }
        }, 240);
      });
      document.addEventListener('click', function (e) {
        if (!input.contains(e.target) && !results.contains(e.target)) results.classList.remove('is-open');
      });
    }
    wireItemPicker('rateItemSearch', 'rateItemResults', 'rateItemId', 'rateItemSelected');
    wireItemPicker('hideItemSearch', 'hideItemResults', 'hideItemId', 'hideItemSelected');

    /* ─── Default rates ─── */
    async function loadRates() {
      var tbody = document.getElementById('ratesBody');
      try {
        var r = await fetch(API + '/admin/default-rates', { headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Failed');
        var rates = data.rates || [];
        document.getElementById('ratesCount').textContent = rates.length + ' rule' + (rates.length === 1 ? '' : 's');
        if (!rates.length) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty"><div class="mark">No Rules</div>No default rates configured. Engineers see list prices unless per-engineer rates are set.</td></tr>';
          return;
        }
        tbody.innerHTML = rates.map(function (rt) {
          return '<tr>'
            + '<td><span class="badge badge-' + rt.scope + '">' + escHTML(rt.scope) + '</span></td>'
            + '<td><div class="font-semibold text-gray-900">' + escHTML(rt.display_name || rt.target_id) + '</div></td>'
            + '<td class="num"><strong style="color:#10b981;">' + parseFloat(rt.discount_pct).toFixed(2) + '%</strong></td>'
            + '<td class="text-gray-500 text-xs">' + escHTML(rt.notes || '—') + '</td>'
            + '<td class="text-gray-500 text-xs">' + fmtDate(rt.updated_at) + '</td>'
            + '<td class="num"><button class="btn btn-danger btn-sm" data-action="delete-rate" data-id="' + escHTML(rt.id) + '">Remove</button></td>'
            + '</tr>';
        }).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty" style="color:#b71c1c;">' + escHTML(err.message) + '</td></tr>';
      }
    }
    document.getElementById('addRateBtn').addEventListener('click', async function () {
      var scope = document.getElementById('rateScope').value;
      var disc = parseFloat(document.getElementById('rateDiscount').value);
      var notes = document.getElementById('rateNotes').value.trim();
      var target = '';
      if (scope === 'brand') target = document.getElementById('rateBrand').value;
      else if (scope === 'category') target = document.getElementById('rateCategory').value;
      else if (scope === 'item') target = document.getElementById('rateItemId').value;
      if (!target) { toast('Choose a target (brand/category/item)', 'err'); return; }
      if (!Number.isFinite(disc) || disc < 0 || disc > 100) { toast('Discount must be 0-100', 'err'); return; }
      try {
        var r = await fetch(API + '/admin/default-rates', {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ scope: scope, target_id: target, discount_pct: disc, notes: notes || null })
        });
        var data = await r.json();
        if (!data.success) throw new Error(data.message);
        toast('Default rate saved.');
        document.getElementById('rateDiscount').value = '';
        document.getElementById('rateNotes').value = '';
        document.getElementById('rateItemSearch').value = '';
        document.getElementById('rateItemId').value = '';
        document.getElementById('rateItemSelected').innerHTML = '';
        await loadRates();
      } catch (err) { toast(err.message, 'err'); }
    });
    async function deleteRate(id) {
      if (!confirm('Remove this default rate?')) return;
      try {
        var r = await fetch(API + '/admin/default-rates/' + id, { method: 'DELETE', headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message);
        toast('Removed.');
        await loadRates();
      } catch (err) { toast(err.message, 'err'); }
    }

    /* ─── Hidden items ─── */
    async function loadHidden() {
      var tbody = document.getElementById('hiddenBody');
      try {
        var r = await fetch(API + '/admin/hidden-items', { headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message || 'Failed');
        var items = data.items || [];
        document.getElementById('hiddenCount').textContent = items.length + ' item' + (items.length === 1 ? '' : 's') + ' hidden';
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty"><div class="mark">All Visible</div>No items hidden from the engineer catalogue. Every active Zoho item is visible by default.</td></tr>';
          return;
        }
        tbody.innerHTML = items.map(function (it) {
          return '<tr>'
            + '<td><div class="font-semibold text-gray-900">' + escHTML(it.zoho_item_name || it.zoho_item_id) + '</div><div class="text-xs text-gray-400 font-mono">' + escHTML(it.zoho_item_id) + '</div></td>'
            + '<td class="text-gray-600">' + escHTML(it.zoho_brand || '—') + (it.zoho_category_name ? ' · ' + escHTML(it.zoho_category_name) : '') + '</td>'
            + '<td class="num">' + fmtINR(it.zoho_rate) + '</td>'
            + '<td class="text-gray-500 text-xs">' + escHTML(it.reason || '—') + '</td>'
            + '<td class="text-gray-500 text-xs">' + fmtDate(it.created_at) + '</td>'
            + '<td class="num"><button class="btn btn-outline btn-sm" data-action="restore-item" data-id="' + escHTML(it.zoho_item_id) + '">Restore</button></td>'
            + '</tr>';
        }).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty" style="color:#b71c1c;">' + escHTML(err.message) + '</td></tr>';
      }
    }
    document.getElementById('hideBtn').addEventListener('click', async function () {
      var id = document.getElementById('hideItemId').value;
      var reason = document.getElementById('hideReason').value.trim();
      if (!id) { toast('Pick an item from the search results', 'err'); return; }
      try {
        var r = await fetch(API + '/admin/hidden-items', {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ zoho_item_id: id, reason: reason || null })
        });
        var data = await r.json();
        if (!data.success) throw new Error(data.message);
        toast('Item hidden.');
        document.getElementById('hideItemSearch').value = '';
        document.getElementById('hideItemId').value = '';
        document.getElementById('hideItemSelected').innerHTML = '';
        document.getElementById('hideReason').value = '';
        await loadHidden();
      } catch (err) { toast(err.message, 'err'); }
    });
    async function restoreItem(id) {
      if (!confirm('Restore this item to the engineer catalogue?')) return;
      try {
        var r = await fetch(API + '/admin/hidden-items/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
        var data = await r.json();
        if (!data.success) throw new Error(data.message);
        toast('Restored.');
        await loadHidden();
      } catch (err) { toast(err.message, 'err'); }
    }

    // Delegated dispatcher for runtime-rendered buttons (replaces inline onclick="deleteRate(...)"
    // and onclick="restoreItem(...)"). One document-level listener routes by data-action.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (!action) return;
      if (action === 'delete-rate') {
        deleteRate(btn.getAttribute('data-id'));
      } else if (action === 'restore-item') {
        restoreItem(btn.getAttribute('data-id'));
      }
    });

    // Initial load
    loadFilters();
    loadRates();
