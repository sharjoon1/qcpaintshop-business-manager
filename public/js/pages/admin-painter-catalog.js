// Painter Catalog Curation — admin controls which products appear in the
// painter app catalog. Uses the existing painter_catalog_* endpoints:
//   GET /api/painters/admin/catalog/brands      -> { success, brands:[{brand,sort_order,is_hidden,product_count}] }
//   GET /api/painters/admin/catalog/products    -> { success, products:[{product_id,name,brand,category,sort_order,is_hidden,variant_count}] }
//   PUT /api/painters/admin/catalog/brands/order    { items:[{brand,sort_order,is_hidden}] }
//   PUT /api/painters/admin/catalog/products/order  { items:[{product_id,sort_order,is_hidden}] }
// Everything starts hidden; the owner un-hides products per brand.

(function () {
    'use strict';

    const $ = (s) => document.querySelector(s);

    let brandData = [];        // [{brand, sort_order, is_hidden, product_count}]
    let productData = [];      // [{product_id, name, brand, category, sort_order, is_hidden, variant_count}]
    let dirty = false;

    const API = '/api/painters/admin/catalog';

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    async function api(url, opts = {}) {
        const h = Object.assign({}, getAuthHeaders(), opts.headers || {});
        if (opts.body && !(opts.body instanceof FormData) && !h['Content-Type']) h['Content-Type'] = 'application/json';
        const r = await fetch(url, Object.assign({}, opts, { headers: h }));
        if (r.status === 401) { window.location.href = '/login.html'; throw new Error('Auth'); }
        if (!r.ok) throw new Error((await r.text()).slice(0, 300));
        return r.json();
    }

    function markDirty(msg) {
        dirty = true;
        $('#saveMsg').textContent = msg || 'Unsaved changes';
        $('#saveBar').classList.remove('hidden');
    }

    // ---------- Brands ----------
    async function loadBrands() {
        try {
            const j = await api(API + '/brands');
            brandData = (j.brands || []).slice().sort((a, b) => a.brand.localeCompare(b.brand));
            renderBrands();
        } catch (e) {
            $('#brandGrid').innerHTML = '<div class="col-span-full text-sm text-red-500">Failed to load brands: ' + esc(e.message) + '</div>';
        }
    }

    function renderBrands() {
        const grid = $('#brandGrid');
        if (!brandData.length) {
            grid.innerHTML = '<div class="col-span-full text-sm text-slate-500">No brands yet — run the catalog import or wait for product sync.</div>';
            return;
        }
        grid.innerHTML = brandData.map(b => {
            const hidden = !!b.is_hidden;
            return '<div class="rounded-xl border p-4 flex flex-col gap-2 ' + (hidden ? 'bg-gray-50 border-gray-200' : 'border-emerald-200 bg-emerald-50/40') + '">' +
                '<div class="flex items-center justify-between">' +
                    '<span class="font-bold text-gray-800 text-sm">' + esc(b.brand) + '</span>' +
                    '<span class="text-xs px-2 py-0.5 rounded-full ' + (hidden ? 'bg-gray-200 text-gray-600' : 'bg-emerald-100 text-emerald-700') + '">' + (hidden ? 'Hidden' : 'Visible') + '</span>' +
                '</div>' +
                '<span class="text-xs text-gray-500">' + (b.product_count || 0) + ' catalog products</span>' +
                '<div class="flex gap-2 mt-1">' +
                    '<button data-brand="' + esc(b.brand) + '" data-show="1" class="brand-act px-3 py-1.5 rounded-lg border text-xs font-semibold bg-white hover:bg-emerald-50">Show all</button>' +
                    '<button data-brand="' + esc(b.brand) + '" data-show="0" class="brand-act px-3 py-1.5 rounded-lg border text-xs font-semibold bg-white hover:bg-red-50">Hide all</button>' +
                '</div>' +
            '</div>';
        }).join('');
        grid.querySelectorAll('.brand-act').forEach(btn => {
            btn.addEventListener('click', () => setBrandProducts(btn.dataset.brand, btn.dataset.show === '1'));
        });
    }

    // Show/hide every product of a brand (bulk)
    async function setBrandProducts(brand, show) {
        try {
            const j = await api(API + '/products?brand=' + encodeURIComponent(brand) + '&limit=1000');
            const items = (j.products || []).map(p => ({ product_id: p.product_id, sort_order: p.sort_order || 999, is_hidden: show ? 0 : 1 }));
            if (!items.length) { alert('No products found for ' + brand); return; }
            await api(API + '/products/order', { method: 'PUT', body: JSON.stringify({ items }) });
            // also flip the brand flag for consistency
            await api(API + '/brands/order', { method: 'PUT', body: JSON.stringify({ items: [{ brand, sort_order: 999, is_hidden: show ? 0 : 1 }] }) });
            await Promise.all([loadBrands(), loadProducts()]);
            if ($('#brandFilter').value === brand || !$('#brandFilter').value) { /* keep view */ }
        } catch (e) {
            alert('Failed: ' + e.message);
        }
    }

    // ---------- Products ----------
    async function loadProducts() {
        const brand = $('#brandFilter').value;
        const cat = $('#catFilter').value;
        try {
            let url = API + '/products?limit=1000';
            if (brand) url += '&brand=' + encodeURIComponent(brand);
            if (cat) url += '&category=' + encodeURIComponent(cat);
            const j = await api(url);
            productData = j.products || [];
            renderProducts();
        } catch (e) {
            $('#prodBody').innerHTML = '<tr><td colspan="4" class="p-2 text-sm text-red-500">Failed: ' + esc(e.message) + '</td></tr>';
        }
    }

    function renderProducts() {
        const tb = $('#prodBody');
        $('#prodEmpty').classList.toggle('hidden', productData.length > 0);
        tb.innerHTML = productData.map(p => {
            const checked = !p.is_hidden;
            return '<tr class="border-t">' +
                '<td class="p-2"><input type="checkbox" data-pid="' + p.product_id + '" ' + (checked ? 'checked' : '') + ' class="w-4 h-4 accent-[#0F3A5F]"></td>' +
                '<td class="p-2 font-medium text-gray-800">' + esc(p.name) + '</td>' +
                '<td class="p-2 text-xs text-gray-500">' + esc(p.category || '—') + '</td>' +
                '<td class="p-2 text-right text-xs text-gray-500">' + (p.variant_count || 0) + '</td>' +
            '</tr>';
        }).join('');
        $('#prodCount').textContent = productData.length + ' shown';
        tb.querySelectorAll('input[type=checkbox]').forEach(cb => {
            cb.addEventListener('change', () => markDirty('Product visibility changed — save to apply'));
        });
    }

    function collectProducts() {
        const items = productData.map(p => {
            const cb = document.querySelector('input[data-pid="' + p.product_id + '"]');
            return {
                product_id: p.product_id,
                sort_order: p.sort_order || 999,
                is_hidden: cb && !cb.checked ? 1 : 0
            };
        });
        return items;
    }

    async function saveProducts() {
        const items = collectProducts();
        if (!items.length) return;
        const btn = $('#btnSave');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            await api(API + '/products/order', { method: 'PUT', body: JSON.stringify({ items }) });
            // Recompute brand visibility: a brand with zero visible products becomes hidden
            const visibleBrands = {};
            productData.forEach(p => {
                const cb = document.querySelector('input[data-pid="' + p.product_id + '"]');
                if (cb && cb.checked) visibleBrands[p.brand] = true;
            });
            const brandItems = brandData.map(b => ({ brand: b.brand, sort_order: 999, is_hidden: visibleBrands[b.brand] ? 0 : 1 }));
            await api(API + '/brands/order', { method: 'PUT', body: JSON.stringify({ items: brandItems }) });
            dirty = false;
            $('#saveBar').classList.add('hidden');
            await Promise.all([loadBrands(), loadProducts()]);
        } catch (e) {
            alert('Save failed: ' + e.message);
        } finally {
            btn.disabled = false; btn.textContent = 'Save Changes';
        }
    }

    // Hide everything (initial state / panic)
    async function hideAll() {
        if (!confirm('Hide ALL products from the painter catalog? This removes every product until you re-show them.')) return;
        const btn = $('#btnHideAll');
        btn.disabled = true; btn.textContent = 'Hiding…';
        try {
            const j = await api(API + '/products?limit=1000');
            const items = (j.products || []).map(p => ({ product_id: p.product_id, sort_order: p.sort_order || 999, is_hidden: 1 }));
            await api(API + '/products/order', { method: 'PUT', body: JSON.stringify({ items }) });
            const brandItems = brandData.map(b => ({ brand: b.brand, sort_order: 999, is_hidden: 1 }));
            await api(API + '/brands/order', { method: 'PUT', body: JSON.stringify({ items: brandItems }) });
            await Promise.all([loadBrands(), loadProducts()]);
        } catch (e) {
            alert('Failed: ' + e.message);
        } finally {
            btn.disabled = false; btn.textContent = 'Hide All Products';
        }
    }

    // ---------- init ----------
    $('#btnSave').addEventListener('click', saveProducts);
    $('#btnHideAll').addEventListener('click', hideAll);
    $('#btnRefresh').addEventListener('click', () => { loadBrands(); loadProducts(); });
    $('#btnShowBrand').addEventListener('click', () => {
        const items = productData.map(p => ({ product_id: p.product_id, sort_order: p.sort_order || 999, is_hidden: 0 }));
        if (!items.length) return;
        api(API + '/products/order', { method: 'PUT', body: JSON.stringify({ items }) })
            .then(() => loadProducts())
            .then(() => loadBrands())
            .catch(e => alert('Failed: ' + e.message));
    });
    $('#brandFilter').addEventListener('change', async () => { await loadProducts(); populateCats(); });
    $('#catFilter').addEventListener('change', loadProducts);
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    async function populateCats() {
        const sel = $('#catFilter');
        const brand = $('#brandFilter').value;
        const cats = [...new Set(productData.map(p => p.category).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
        if (brand) { /* loaded with brand */ }
    }

    async function init() {
        await loadBrands();
        const opts = brandData.map(b => '<option value="' + esc(b.brand) + '">' + esc(b.brand) + '</option>').join('');
        $('#brandFilter').innerHTML = '<option value="">All brands</option>' + opts;
        await loadProducts();
    }

    init();
})();
