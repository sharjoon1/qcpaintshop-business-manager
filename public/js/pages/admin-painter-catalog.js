// Painter Catalog Curation — admin controls which products appear in the
// painter app catalog. Uses the existing painter_catalog_* endpoints:
//   GET /api/painters/admin/catalog/brands      -> { success, brands:[{brand,sort_order,is_hidden,product_count}] }
//   GET /api/painters/admin/catalog/products    -> { success, products:[{product_id,name,brand,category,sort_order,is_hidden,variant_count,main_base_key,base_keys[]}] }
//   PUT /api/painters/admin/catalog/brands/order    { items:[{brand,sort_order,is_hidden}] }
//   PUT /api/painters/admin/catalog/products/order  { items:[{product_id,sort_order,is_hidden}] }
//   PUT /api/painters/admin/catalog/products/main-base { product_id, main_base_key|null }
//   PUT /api/painters/admin/catalog/products/rename    { product_id, name }
//   POST /api/painters/admin/catalog/products/:id/image (multipart "image")
// Everything starts hidden; the owner un-hides products per brand. Products with
// multiple tint bases (emulsions) show a "Main base" picker — the painter catalog
// then displays only that base's pack sizes.

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
        // getAuthHeaders() always includes Content-Type: application/json — for
        // FormData bodies it must be removed so the browser sets the multipart
        // boundary (otherwise express.json() rejects the body with a 400).
        if (opts.body instanceof FormData) delete h['Content-Type'];
        else if (opts.body && !h['Content-Type']) h['Content-Type'] = 'application/json';
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
            return '<div class="flex-none w-28 h-28 rounded-xl border flex flex-col items-center justify-between p-2 ' + (hidden ? 'bg-gray-50 border-gray-200' : 'border-emerald-200 bg-emerald-50/40') + '">' +
                '<span class="text-[11px] font-bold text-gray-800 text-center leading-tight break-words" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + esc(b.brand) + '</span>' +
                '<span class="text-[10px] text-gray-500">' + (b.product_count || 0) + ' products</span>' +
                '<span class="text-[9px] px-1.5 py-0.5 rounded-full ' + (hidden ? 'bg-gray-200 text-gray-600' : 'bg-emerald-100 text-emerald-700') + '">' + (hidden ? 'Hidden' : 'Visible') + '</span>' +
                '<div class="flex gap-1 w-full">' +
                    '<button data-brand="' + esc(b.brand) + '" data-show="1" class="brand-act flex-1 px-1 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Show</button>' +
                    '<button data-brand="' + esc(b.brand) + '" data-show="0" class="brand-act flex-1 px-1 py-0.5 rounded text-[9px] font-semibold bg-red-50 text-red-600 hover:bg-red-100">Hide</button>' +
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
            // also flip the brand flag for consistency (keep its curated sort_order)
            const cur = brandData.find(b => b.brand === brand);
            await api(API + '/brands/order', { method: 'PUT', body: JSON.stringify({ items: [{ brand, sort_order: (cur && cur.sort_order) || 999, is_hidden: show ? 0 : 1 }] }) });
            await Promise.all([loadBrands(), loadProducts()]);
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
            populateCats();
        } catch (e) {
            $('#prodBody').innerHTML = '<tr><td colspan="6" class="p-2 text-sm text-red-500">Failed: ' + esc(e.message) + '</td></tr>';
        }
    }

    // Rows shown = productData narrowed by the client-side search box.
    function visibleProducts() {
        const term = ($('#searchBox') && $('#searchBox').value || '').trim().toUpperCase();
        if (!term) return productData;
        return productData.filter(p => ((p.name || '') + ' ' + (p.brand || '') + ' ' + (p.category || '')).toUpperCase().includes(term));
    }

    function renderProducts() {
        const tb = $('#prodBody');
        const rows = visibleProducts();
        $('#prodEmpty').classList.toggle('hidden', rows.length > 0);
        tb.innerHTML = rows.map(p => {
            const checked = !p.is_hidden;
            const bases = p.product_type === 'area_wise' ? (p.base_keys || []).filter(Boolean) : [];
            const multiBase = bases.length > 1;
            const mainSel = multiBase
                ? '<div class="flex items-center gap-1.5 mt-1.5">' +
                    '<span class="text-[10px] uppercase tracking-wide text-gray-400">Main base</span>' +
                    '<select data-mainbase="' + p.product_id + '" class="text-[11px] border border-gray-300 rounded-md px-1.5 py-0.5 bg-white">' +
                        '<option value="">All bases</option>' +
                        bases.map(b => '<option value="' + esc(b) + '"' + (p.main_base_key === b ? ' selected' : '') + '>' + esc(b) + '</option>').join('') +
                    '</select>' +
                  '</div>'
                : '';
            const baseChips = bases.length
                ? '<div class="flex flex-wrap gap-1 mt-1">' + bases.map(b =>
                    '<span class="text-[10px] px-1.5 py-0.5 rounded ' + (p.main_base_key === b ? 'bg-[#0F3A5F] text-white' : 'bg-gray-100 text-gray-500') + '">' + esc(b) + '</span>').join('') + '</div>'
                : '';
            const imgCell = '<div class="flex items-center gap-2">' +
                (p.image_url
                    ? '<img src="' + esc(p.image_url) + '" class="w-12 h-12 object-cover rounded-lg border border-gray-200">'
                    : '<div class="w-12 h-12 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-[9px] text-gray-400 text-center leading-tight">No<br>img</div>') +
                '<button data-imgbtn="' + p.product_id + '" class="text-[10px] px-1.5 py-1 rounded border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 font-semibold whitespace-nowrap">Upload</button>' +
                '<input type="file" data-imgfile="' + p.product_id + '" accept="image/*" class="hidden">' +
              '</div>';
            const nameCell = '<div class="flex items-start gap-1.5">' +
                '<span class="font-medium text-gray-800">' + esc(p.name) + '</span>' +
                '<button data-rename="' + p.product_id + '" title="Rename product" class="shrink-0 text-gray-300 hover:text-[#0F3A5F] text-xs leading-5">&#9998;</button>' +
              '</div>' + baseChips + mainSel;
            return '<tr class="border-t align-top hover:bg-gray-50/60">' +
                '<td class="p-2"><input type="checkbox" data-pid="' + p.product_id + '" ' + (checked ? 'checked' : '') + ' class="w-4 h-4 accent-[#0F3A5F]"></td>' +
                '<td class="p-2">' + nameCell + '</td>' +
                '<td class="p-2"><span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold whitespace-nowrap">' + esc(p.brand || '—') + '</span></td>' +
                '<td class="p-2 text-xs text-gray-500 whitespace-nowrap">' + esc(p.category || '—') + '</td>' +
                '<td class="p-2 text-right text-xs text-gray-500">' + (p.variant_count || 0) + '</td>' +
                '<td class="p-2">' + imgCell + '</td>' +
            '</tr>';
        }).join('');
        tb.querySelectorAll('select[data-mainbase]').forEach(sel => {
            sel.addEventListener('change', () => setMainBase(parseInt(sel.dataset.mainbase, 10), sel.value));
        });
        tb.querySelectorAll('button[data-imgbtn]').forEach(btn => {
            btn.addEventListener('click', () => {
                const inp = document.querySelector('input[data-imgfile="' + btn.dataset.imgbtn + '"]');
                if (inp) inp.click();
            });
        });
        tb.querySelectorAll('input[data-imgfile]').forEach(inp => {
            inp.addEventListener('change', () => {
                if (inp.files && inp.files[0]) uploadImage(parseInt(inp.dataset.imgfile, 10), inp.files[0]);
                inp.value = '';
            });
        });
        tb.querySelectorAll('button[data-rename]').forEach(btn => {
            btn.addEventListener('click', () => renameProduct(parseInt(btn.dataset.rename, 10)));
        });
        $('#prodCount').textContent = rows.length + (rows.length === productData.length ? ' shown' : ' of ' + productData.length + ' shown');
        // Keep is_hidden in productData in sync so save works even when the row
        // is later hidden by the search box (checkbox no longer in the DOM).
        tb.querySelectorAll('input[type=checkbox][data-pid]').forEach(cb => {
            cb.addEventListener('change', () => {
                const p = productData.find(x => x.product_id === parseInt(cb.dataset.pid, 10));
                if (p) p.is_hidden = cb.checked ? 0 : 1;
                markDirty('Product visibility changed — save to apply');
            });
        });
    }

    // Upload a product image (used by the curation table)
    async function uploadImage(productId, file) {
        if (!file) return;
        const fd = new FormData();
        fd.append('image', file);
        try {
            await api(API + '/products/' + productId + '/image', { method: 'POST', body: fd });
            await loadProducts();
        } catch (e) {
            alert('Image upload failed: ' + e.message);
        }
    }

    // Rename the grouped product (display name in curation + painter catalog)
    async function renameProduct(productId) {
        const p = productData.find(x => x.product_id === productId);
        if (!p) return;
        const name = prompt('Product name:', p.name || '');
        if (name == null) return;                     // cancelled
        const clean = name.replace(/\s+/g, ' ').trim();
        if (!clean || clean === p.name) return;
        try {
            const j = await api(API + '/products/rename', {
                method: 'PUT',
                body: JSON.stringify({ product_id: productId, name: clean })
            });
            if (j.success) { p.name = j.name; renderProducts(); }
        } catch (e) {
            alert('Rename failed: ' + e.message);
        }
    }

    // Set the main (catalog-visible) tint base for a product; '' clears it.
    async function setMainBase(productId, baseKey) {
        try {
            const j = await api(API + '/products/main-base', {
                method: 'PUT',
                body: JSON.stringify({ product_id: productId, main_base_key: baseKey || null })
            });
            if (j.success) {
                markDirty('Main base updated for #' + productId + ' — save to apply');
                loadProducts();
            }
        } catch (e) {
            alert('Failed to set main base: ' + e.message);
            loadProducts();
        }
    }

    function collectProducts() {
        // productData.is_hidden is kept current by the checkbox handler, so this
        // is correct even for rows filtered out of the DOM by the search box.
        return productData.map(p => ({
            product_id: p.product_id,
            sort_order: p.sort_order || 999,
            is_hidden: p.is_hidden ? 1 : 0
        }));
    }

    async function saveProducts() {
        const items = collectProducts();
        if (!items.length) return;
        const btn = $('#btnSave');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            await api(API + '/products/order', { method: 'PUT', body: JSON.stringify({ items }) });
            // Recompute visibility ONLY for brands present in the current view —
            // a brand-filtered save must not hide every other brand.
            const inView = {};
            productData.forEach(p => {
                if (!(p.brand in inView)) inView[p.brand] = false;
                if (!p.is_hidden) inView[p.brand] = true;
            });
            const brandItems = brandData
                .filter(b => b.brand in inView)
                .map(b => ({ brand: b.brand, sort_order: b.sort_order || 999, is_hidden: inView[b.brand] ? 0 : 1 }));
            if (brandItems.length) {
                await api(API + '/brands/order', { method: 'PUT', body: JSON.stringify({ items: brandItems }) });
            }
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
            const brandItems = brandData.map(b => ({ brand: b.brand, sort_order: b.sort_order || 999, is_hidden: 1 }));
            await api(API + '/brands/order', { method: 'PUT', body: JSON.stringify({ items: brandItems }) });
            await Promise.all([loadBrands(), loadProducts()]);
        } catch (e) {
            alert('Failed: ' + e.message);
        } finally {
            btn.disabled = false; btn.textContent = 'Hide All Products';
        }
    }

    // ---------- Category filter ----------
    // Rebuild the dropdown only from a category-UNFILTERED load; while a
    // category is selected the option list (and the selection) must survive.
    function populateCats() {
        const sel = $('#catFilter');
        if (sel.value) return;
        const cats = [...new Set(productData.map(p => p.category).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
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
    $('#brandFilter').addEventListener('change', () => {
        $('#catFilter').value = '';       // categories belong to the new brand
        loadProducts();
    });
    $('#catFilter').addEventListener('change', loadProducts);
    $('#searchBox').addEventListener('input', renderProducts);
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    async function init() {
        await loadBrands();
        const opts = brandData.map(b => '<option value="' + esc(b.brand) + '">' + esc(b.brand) + '</option>').join('');
        $('#brandFilter').innerHTML = '<option value="">All brands</option>' + opts;
        await loadProducts();
    }

    init();
})();
