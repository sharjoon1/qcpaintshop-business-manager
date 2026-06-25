// Page logic for Painter Catalogue. Externalized from the admin-painter-catalog.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener /
// data-action delegation. No logic changes, no renames, escaping helpers untouched.
    var API = '/api/painters';
    var state = {
      brands: [],            // [{brand, sort_order, is_hidden, product_count}]
      categoriesByBrand: {}, // brand → [{brand, category, sort_order, is_hidden, product_count}]
      productsByKey: {},     // 'brand|category' → [{product_id, name, brand, category, sort_order, is_hidden, variant_count}]
      painters: [],
      selectedPainter: null,
      overrides: { brand: [], category: {}, product: {} },
      sortables: {},
    };

    function authHeaders(extra) {
      var t = localStorage.getItem('auth_token') || '';
      var h = { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
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

    // ===== Top tabs =====
    document.querySelectorAll('.tabbar .tab-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.tabbar .tab-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
        document.getElementById('tab-' + b.dataset.tab).classList.add('active');
        if (b.dataset.tab === 'overrides') ensurePaintersLoaded();
      });
    });

    // ===== Sub-tabs =====
    document.querySelectorAll('.subtab-row').forEach(function (row) {
      row.querySelectorAll('.subtab-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          row.querySelectorAll('.subtab-btn').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          // Hide siblings in same .tab-pane
          var pane = row.closest('.tab-pane');
          pane.querySelectorAll('.subtab-pane').forEach(function (p) { p.style.display = 'none'; });
          document.getElementById('sub-' + b.dataset.sub).style.display = 'block';
          // Triggers
          var sub = b.dataset.sub;
          if (sub === 'g-category') loadGlobalCategories();
          if (sub === 'g-product')  loadGlobalProducts();
          if (sub === 'o-category') loadOverrideCategories();
          if (sub === 'o-product')  loadOverrideProducts();
        });
      });
    });

    // ===== GLOBAL: brands =====
    async function loadGlobalBrands() {
      var ul = document.getElementById('list-g-brand');
      ul.innerHTML = '<li class="loading">Loading brands…</li>';
      try {
        var r = await fetch(API + '/admin/catalog/brands', { headers: authHeaders() });
        var j = await r.json();
        if (!j.success) throw new Error(j.message || 'Failed');
        state.brands = j.brands || [];
        renderSortList(ul, state.brands.map(function (b, i) {
          return {
            key: b.brand,
            rank: i + 1,
            label: b.brand,
            sub: b.product_count + ' product(s)',
            is_hidden: !!b.is_hidden,
            data: b,
          };
        }), 'brand-list');
        populateBrandDropdowns();
      } catch (e) {
        ul.innerHTML = '<li class="empty">Failed to load: ' + escHTML(e.message) + '</li>';
      }
    }

    function populateBrandDropdowns() {
      ['filter-g-cat-brand','filter-g-prod-brand','filter-o-cat-brand','filter-o-prod-brand'].forEach(function (id) {
        var sel = document.getElementById(id);
        if (!sel) return;
        var current = sel.value;
        var first = sel.options[0] ? sel.options[0].outerHTML : '';
        sel.innerHTML = first + state.brands.map(function (b) {
          return '<option value="' + escHTML(b.brand) + '">' + escHTML(b.brand) + '</option>';
        }).join('');
        sel.value = current;
      });
    }

    // ===== GLOBAL: categories =====
    async function loadGlobalCategories() {
      var brand = document.getElementById('filter-g-cat-brand').value || '';
      var ul = document.getElementById('list-g-category');
      ul.innerHTML = '<li class="loading">Loading…</li>';
      try {
        var url = API + '/admin/catalog/categories' + (brand ? ('?brand=' + encodeURIComponent(brand)) : '');
        var r = await fetch(url, { headers: authHeaders() });
        var j = await r.json();
        if (!j.success) throw new Error(j.message || 'Failed');
        // group by brand and re-rank within brand
        var rows = j.categories || [];
        var byBrand = {};
        rows.forEach(function (c) { (byBrand[c.brand] = byBrand[c.brand] || []).push(c); });
        state.categoriesByBrand = byBrand;
        var items = [];
        Object.keys(byBrand).forEach(function (br) {
          byBrand[br].forEach(function (c, i) {
            items.push({
              key: c.brand + '||' + c.category,
              rank: i + 1,
              label: c.category,
              sub: c.brand + ' · ' + c.product_count + ' product(s)',
              is_hidden: !!c.is_hidden,
              data: c,
            });
          });
        });
        if (!items.length) { ul.innerHTML = '<li class="empty">No categories.</li>'; return; }
        renderSortList(ul, items, 'cat-list');
      } catch (e) {
        ul.innerHTML = '<li class="empty">Failed to load: ' + escHTML(e.message) + '</li>';
      }
    }

    // ===== GLOBAL: products =====
    function onProdBrandChange(scope) {
      var brand = document.getElementById('filter-' + scope + '-prod-brand').value || '';
      // Load category dropdown for this brand
      var catSel = document.getElementById('filter-' + scope + '-prod-cat');
      catSel.innerHTML = '<option value="">All categories</option>';
      if (brand && state.categoriesByBrand[brand]) {
        catSel.innerHTML += state.categoriesByBrand[brand].map(function (c) {
          return '<option value="' + escHTML(c.category) + '">' + escHTML(c.category) + '</option>';
        }).join('');
      } else if (brand) {
        // Need categories — fetch
        fetch(API + '/admin/catalog/categories?brand=' + encodeURIComponent(brand), { headers: authHeaders() })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.success) {
              state.categoriesByBrand[brand] = j.categories || [];
              catSel.innerHTML = '<option value="">All categories</option>' +
                (j.categories || []).map(function (c) { return '<option value="' + escHTML(c.category) + '">' + escHTML(c.category) + '</option>'; }).join('');
            }
          });
      }
      if (scope === 'g') loadGlobalProducts(); else loadOverrideProducts();
    }

    async function loadGlobalProducts() {
      var brand = document.getElementById('filter-g-prod-brand').value || '';
      var cat   = document.getElementById('filter-g-prod-cat').value || '';
      var ul = document.getElementById('list-g-product');
      if (!brand) { ul.innerHTML = '<li class="empty">Select a brand to begin.</li>'; return; }
      ul.innerHTML = '<li class="loading">Loading…</li>';
      try {
        var url = API + '/admin/catalog/products?brand=' + encodeURIComponent(brand) + (cat ? ('&category=' + encodeURIComponent(cat)) : '');
        var r = await fetch(url, { headers: authHeaders() });
        var j = await r.json();
        if (!j.success) throw new Error(j.message || 'Failed');
        var products = j.products || [];
        if (!products.length) { ul.innerHTML = '<li class="empty">No products in this scope.</li>'; return; }
        state.productsByKey[brand + '||' + cat] = products;
        renderSortList(ul, products.map(function (p, i) {
          return {
            key: String(p.product_id),
            rank: i + 1,
            label: p.name,
            sub: p.brand + (p.category ? ' · ' + p.category : '') + ' · ' + p.variant_count + ' variant(s)',
            is_hidden: !!p.is_hidden,
            data: p,
          };
        }), 'prod-list');
      } catch (e) {
        ul.innerHTML = '<li class="empty">Failed to load: ' + escHTML(e.message) + '</li>';
      }
    }

    // ===== Sort-list renderer =====
    function renderSortList(ul, items, sortableId) {
      ul.innerHTML = items.map(function (it) {
        return '<li class="sort-item' + (it.is_hidden ? ' is-hidden' : '') + '" data-key="' + escHTML(it.key) + '">' +
          '<span class="drag-handle">⋮⋮</span>' +
          '<span class="sort-rank">' + it.rank + '</span>' +
          '<span class="sort-label">' + escHTML(it.label) +
            (it.sub ? '<small>' + escHTML(it.sub) + '</small>' : '') +
          '</span>' +
          '<div class="sort-controls">' +
            '<span class="switch-label">' + (it.is_hidden ? 'HIDDEN' : 'Visible') + '</span>' +
            '<label class="switch" title="Toggle hidden">' +
              '<input type="checkbox" data-hide ' + (it.is_hidden ? 'checked' : '') + '>' +
              '<span class="slider"></span>' +
            '</label>' +
          '</div>' +
        '</li>';
      }).join('');
      // Wire hide toggles
      ul.querySelectorAll('input[data-hide]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var li = cb.closest('.sort-item');
          li.classList.toggle('is-hidden', cb.checked);
          li.querySelector('.switch-label').textContent = cb.checked ? 'HIDDEN' : 'Visible';
        });
      });
      // Sortable
      if (state.sortables[sortableId]) state.sortables[sortableId].destroy();
      state.sortables[sortableId] = Sortable.create(ul, {
        animation: 150,
        handle: '.drag-handle',
        onEnd: function () { renumber(ul); },
      });
    }

    function renumber(ul) {
      ul.querySelectorAll('.sort-item').forEach(function (li, i) {
        var rank = li.querySelector('.sort-rank');
        if (rank) rank.textContent = (i + 1);
      });
    }

    function readListItems(ulId, mode) {
      // mode = 'brand' | 'category' | 'product'
      var ul = document.getElementById(ulId);
      var items = [];
      ul.querySelectorAll('.sort-item').forEach(function (li, i) {
        var key = li.getAttribute('data-key') || '';
        var hidden = li.querySelector('input[data-hide]').checked ? 1 : 0;
        var sort_order = (i + 1) * 10;
        if (mode === 'brand') {
          items.push({ brand: key, sort_order: sort_order, is_hidden: hidden });
        } else if (mode === 'category') {
          var parts = key.split('||');
          items.push({ brand: parts[0], category: parts[1], sort_order: sort_order, is_hidden: hidden });
        } else {
          items.push({ product_id: parseInt(key, 10), sort_order: sort_order, is_hidden: hidden });
        }
      });
      return items;
    }

    async function saveGlobalOrder(level) {
      var ulId = ({ brand:'list-g-brand', category:'list-g-category', product:'list-g-product' })[level];
      var items = readListItems(ulId, level);
      if (!items.length) { toast('Nothing to save', 'err'); return; }
      try {
        var url = API + '/admin/catalog/' + (level === 'brand' ? 'brands' : level === 'category' ? 'categories' : 'products') + '/order';
        var r = await fetch(url, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ items: items }) });
        var j = await r.json();
        if (!j.success) throw new Error(j.message || 'Save failed');
        toast('Saved ' + items.length + ' ' + level + '(s)');
        if (level === 'brand') loadGlobalBrands();
      } catch (e) { toast(e.message, 'err'); }
    }

    // ===== PAINTERS =====
    async function ensurePaintersLoaded() {
      if (state.painters.length) return;
      try {
        var r = await fetch(API + '/?limit=500&status=approved', { headers: authHeaders() });
        var j = await r.json();
        if (!j.success) throw new Error(j.message || 'Failed');
        state.painters = j.painters || [];
        renderPainterDropdown();
      } catch (e) { toast(e.message, 'err'); }
    }

    function renderPainterDropdown() {
      var q = (document.getElementById('painter-search').value || '').toLowerCase().trim();
      var sel = document.getElementById('painter-picker');
      var current = sel.value;
      var filtered = state.painters.filter(function (p) {
        if (!q) return true;
        return (p.full_name && p.full_name.toLowerCase().includes(q))
            || (p.phone && p.phone.includes(q));
      });
      sel.innerHTML = '<option value="">Select a painter…</option>' +
        filtered.map(function (p) {
          return '<option value="' + p.id + '">' + escHTML(p.full_name) + ' · ' + escHTML(p.phone || '') + '</option>';
        }).join('');
      sel.value = current;
    }

    function filterPainterList() { renderPainterDropdown(); }

    function onPainterChange() {
      var id = parseInt(document.getElementById('painter-picker').value, 10);
      if (!id) {
        state.selectedPainter = null;
        document.getElementById('ov-no-painter').style.display = '';
        document.getElementById('ov-subtabs').style.display = 'none';
        ['sub-o-brand','sub-o-category','sub-o-product'].forEach(function (k) { document.getElementById(k).style.display = 'none'; });
        document.getElementById('painter-meta').textContent = '';
        return;
      }
      state.selectedPainter = state.painters.find(function (p) { return p.id === id; });
      document.getElementById('ov-no-painter').style.display = 'none';
      document.getElementById('ov-subtabs').style.display = '';
      // Default to brand sub-tab
      document.querySelector('#tab-overrides .subtab-btn[data-sub="o-brand"]').click();
      document.getElementById('painter-meta').textContent = state.selectedPainter
        ? (state.selectedPainter.full_name + ' · ' + (state.selectedPainter.phone || ''))
        : '';
    }

    // ===== OVERRIDES =====
    async function fetchOverrides(level, extra) {
      if (!state.selectedPainter) return null;
      var qs = 'level=' + level;
      if (extra && extra.brand) qs += '&brand=' + encodeURIComponent(extra.brand);
      if (extra && extra.category) qs += '&category=' + encodeURIComponent(extra.category);
      var r = await fetch(API + '/admin/catalog/painters/' + state.selectedPainter.id + '/overrides?' + qs, { headers: authHeaders() });
      var j = await r.json();
      if (!j.success) throw new Error(j.message || 'Failed');
      return j.rows || [];
    }

    function renderOverrideList(ulId, rows, mode) {
      // rows: { brand, [category], [product_id, name], global_sort, global_hidden, override_sort, override_hidden }
      var ul = document.getElementById(ulId);
      if (!rows.length) { ul.innerHTML = '<li class="empty">No items.</li>'; return; }
      ul.innerHTML = rows.map(function (r, i) {
        var key;
        var label;
        var sub;
        if (mode === 'brand')    { key = r.brand; label = r.brand; sub = ''; }
        else if (mode === 'category') { key = r.brand + '||' + r.category; label = r.category; sub = r.brand; }
        else                     { key = String(r.product_id); label = r.name; sub = r.brand + (r.category ? ' · ' + r.category : ''); }
        var hasOverride = (r.override_sort != null) || (r.override_hidden != null);
        var effHidden = (r.override_hidden != null ? r.override_hidden : r.global_hidden) ? 1 : 0;
        var posVal = (r.override_sort != null) ? r.override_sort : '';
        return '<li class="sort-item' + (effHidden ? ' is-hidden' : '') + '" data-key="' + escHTML(key) + '">' +
          '<span class="drag-handle">⋮⋮</span>' +
          '<span class="sort-label">' + escHTML(label) +
            (sub ? '<small>' + escHTML(sub) + ' · global pos ' + r.global_sort + (r.global_hidden ? ' · hidden globally' : '') + '</small>' : '<small>global pos ' + r.global_sort + (r.global_hidden ? ' · hidden globally' : '') + '</small>') +
          '</span>' +
          '<div class="sort-controls">' +
            '<span class="override-pill ' + (hasOverride ? 'is-override' : 'is-inherit') + '">' + (hasOverride ? 'OVERRIDE' : 'INHERIT') + '</span>' +
            '<input type="number" data-pos placeholder="—" min="1" value="' + escHTML(posVal) + '" style="width:64px;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;text-align:center" title="Override position (blank = inherit)">' +
            '<span class="switch-label" data-hide-state>' + (r.override_hidden != null ? (r.override_hidden ? 'HIDDEN' : 'SHOWN') : (r.global_hidden ? 'inherit hidden' : 'inherit shown')) + '</span>' +
            '<select data-hide-mode class="filter-select" style="min-width:auto;padding:4px 8px;font-size:11px">' +
              '<option value=""' + (r.override_hidden == null ? ' selected' : '') + '>inherit</option>' +
              '<option value="0"' + (r.override_hidden === 0 ? ' selected' : '') + '>show</option>' +
              '<option value="1"' + (r.override_hidden === 1 ? ' selected' : '') + '>hide</option>' +
            '</select>' +
            '<button class="btn btn-ghost btn-sm" data-action="reset-override" title="Reset to global">Reset</button>' +
          '</div>' +
        '</li>';
      }).join('');
      ul.querySelectorAll('select[data-hide-mode]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var li = sel.closest('.sort-item');
          var span = li.querySelector('[data-hide-state]');
          var v = sel.value;
          span.textContent = v === '' ? 'inherit' : (v === '1' ? 'HIDDEN' : 'SHOWN');
          li.classList.toggle('is-hidden', v === '1');
        });
      });
    }

    function resetOverrideRow(btn) {
      var li = btn.closest('.sort-item');
      li.querySelector('input[data-pos]').value = '';
      li.querySelector('select[data-hide-mode]').value = '';
      li.querySelector('[data-hide-state]').textContent = 'inherit';
      li.classList.remove('is-hidden');
    }

    async function loadOverrideBrands() {
      var ul = document.getElementById('list-o-brand');
      ul.innerHTML = '<li class="loading">Loading…</li>';
      try {
        var rows = await fetchOverrides('brand');
        renderOverrideList('list-o-brand', rows, 'brand');
      } catch (e) { ul.innerHTML = '<li class="empty">Failed: ' + escHTML(e.message) + '</li>'; }
    }
    async function loadOverrideCategories() {
      if (!state.selectedPainter) return;
      var brand = document.getElementById('filter-o-cat-brand').value || '';
      var ul = document.getElementById('list-o-category');
      ul.innerHTML = '<li class="loading">Loading…</li>';
      try {
        var rows = await fetchOverrides('category', brand ? { brand: brand } : null);
        renderOverrideList('list-o-category', rows, 'category');
      } catch (e) { ul.innerHTML = '<li class="empty">Failed: ' + escHTML(e.message) + '</li>'; }
    }
    async function loadOverrideProducts() {
      if (!state.selectedPainter) return;
      var brand = document.getElementById('filter-o-prod-brand').value || '';
      var cat   = document.getElementById('filter-o-prod-cat').value || '';
      var ul = document.getElementById('list-o-product');
      if (!brand) { ul.innerHTML = '<li class="empty">Select a brand.</li>'; return; }
      ul.innerHTML = '<li class="loading">Loading…</li>';
      try {
        var rows = await fetchOverrides('product', { brand: brand, category: cat });
        renderOverrideList('list-o-product', rows, 'product');
      } catch (e) { ul.innerHTML = '<li class="empty">Failed: ' + escHTML(e.message) + '</li>'; }
    }

    function readOverrideListItems(ulId, mode) {
      var ul = document.getElementById(ulId);
      var items = [];
      ul.querySelectorAll('.sort-item').forEach(function (li) {
        var key = li.getAttribute('data-key') || '';
        var posIn = li.querySelector('input[data-pos]');
        var hideIn = li.querySelector('select[data-hide-mode]');
        var posVal = posIn && posIn.value !== '' ? parseInt(posIn.value, 10) : null;
        var hideVal = hideIn && hideIn.value !== '' ? parseInt(hideIn.value, 10) : null;
        if (posVal == null && hideVal == null) {
          // Will trigger DELETE on backend
          if (mode === 'brand')         items.push({ brand: key, sort_order: null, is_hidden: null });
          else if (mode === 'category') { var p = key.split('||'); items.push({ brand: p[0], category: p[1], sort_order: null, is_hidden: null }); }
          else                          items.push({ product_id: parseInt(key, 10), sort_order: null, is_hidden: null });
        } else {
          if (mode === 'brand')         items.push({ brand: key, sort_order: posVal, is_hidden: hideVal });
          else if (mode === 'category') { var pp = key.split('||'); items.push({ brand: pp[0], category: pp[1], sort_order: posVal, is_hidden: hideVal }); }
          else                          items.push({ product_id: parseInt(key, 10), sort_order: posVal, is_hidden: hideVal });
        }
      });
      return items;
    }

    async function saveOverrides(level) {
      if (!state.selectedPainter) { toast('No painter selected', 'err'); return; }
      var ulId = ({ brand:'list-o-brand', category:'list-o-category', product:'list-o-product' })[level];
      var items = readOverrideListItems(ulId, level);
      if (!items.length) { toast('Nothing to save', 'err'); return; }
      try {
        var url = API + '/admin/catalog/painters/' + state.selectedPainter.id + '/overrides/' + level;
        var r = await fetch(url, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ items: items }) });
        var j = await r.json();
        if (!j.success) throw new Error(j.message || 'Save failed');
        toast('Saved ' + items.length + ' override(s)');
      } catch (e) { toast(e.message, 'err'); }
    }

    // Trigger brand overrides load when sub-tab becomes active
    document.querySelector('#tab-overrides .subtab-row').addEventListener('click', function (e) {
      if (e.target.matches('.subtab-btn[data-sub="o-brand"]')) loadOverrideBrands();
    });

    // ===== Inline on*= handler wiring (S9+F5 strict CSP) =====
    // Static buttons/selects (each has a unique id) -> addEventListener.
    document.getElementById('filter-g-cat-brand').addEventListener('change', function () { loadGlobalCategories(); });
    document.getElementById('filter-g-prod-brand').addEventListener('change', function () { onProdBrandChange('g'); });
    document.getElementById('filter-g-prod-cat').addEventListener('change', function () { loadGlobalProducts(); });
    document.getElementById('painter-picker').addEventListener('change', function () { onPainterChange(); });
    document.getElementById('painter-search').addEventListener('input', function () { filterPainterList(); });
    document.getElementById('filter-o-cat-brand').addEventListener('change', function () { loadOverrideCategories(); });
    document.getElementById('filter-o-prod-brand').addEventListener('change', function () { onProdBrandChange('o'); });
    document.getElementById('filter-o-prod-cat').addEventListener('change', function () { loadOverrideProducts(); });

    // Save buttons carry a data-action = the save scope; one delegated click listener.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (!action) return;
      if (action.indexOf('save-global-') === 0) {
        saveGlobalOrder(action.slice('save-global-'.length));
      } else if (action.indexOf('save-override-') === 0) {
        saveOverrides(action.slice('save-override-'.length));
      } else if (action === 'reset-override') {
        // Replaces the old onclick="resetOverrideRow(this)"
        resetOverrideRow(btn);
      }
    });

    // ===== Init =====
    loadGlobalBrands();
