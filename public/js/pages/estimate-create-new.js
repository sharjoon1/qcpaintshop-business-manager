// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
let selectedCustomer = null;
let estimateItems = [];
let laborItems = [];
let filterOptions = { brands: [], categories: [] };
let activeFilters = { brand: '', category: '' };
let itemIdCounter = 1;
let laborIdCounter = 1;
let _customerSearchTimer = null;
let _productSearchTimer = null;

const RECENT_CUSTOMERS_KEY = 'est_recent_customers';

// Edit mode state
let isEditMode = false;
let editEstimateId = null;
let editEstimateNumber = null;
let originalEstimateDate = null;
let originalValidUntil = null;
// One idempotency key per create-page load (regenerated only on a fresh page load)
let estimateCreateIdemKey = (typeof window !== 'undefined' && window.qcIdempotencyKey) ? window.qcIdempotencyKey() : null;

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n) {
    return '₹' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function roundUp10(n) { return Math.ceil(parseFloat(n) / 10) * 10; }

// ════════════════════════════════════════
// RECENT CUSTOMERS (localStorage)
// ════════════════════════════════════════
function getRecentCustomers() {
    try { return JSON.parse(localStorage.getItem(RECENT_CUSTOMERS_KEY) || '[]'); } catch { return []; }
}
function saveRecentCustomer(c) {
    const list = getRecentCustomers().filter(r => r.id !== c.id);
    list.unshift(c);
    localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(list.slice(0, 5)));
}

// ════════════════════════════════════════
// CUSTOMER SEARCH
// ════════════════════════════════════════
function initCustomerSearch(inputId, dropdownId, cardId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    const card = document.getElementById(cardId);
    if (!input) return;

    input.addEventListener('focus', () => {
        const recents = getRecentCustomers();
        if (recents.length) showCustomerResults(recents, dropdown, input, card, true);
    });

    input.addEventListener('input', () => {
        clearTimeout(_customerSearchTimer);
        const q = input.value.trim();
        if (q.length < 2) {
            const recents = getRecentCustomers();
            if (recents.length) showCustomerResults(recents, dropdown, input, card, true);
            else dropdown.style.display = 'none';
            return;
        }
        _customerSearchTimer = setTimeout(async () => {
            try {
                const res = await apiRequest('/api/estimates/search-customers?q=' + encodeURIComponent(q));
                const results = await res.json();
                showCustomerResults(results, dropdown, input, card, false);
            } catch(e) { console.error('Customer search error', e); }
        }, 300);
    });

}

document.addEventListener('click', function(e) {
    ['customerDropdownPanel', 'customerDropdownPanelMobile'].forEach(function(ddId) {
        const dd = document.getElementById(ddId);
        if (!dd) return;
        const inputId = ddId === 'customerDropdownPanel' ? 'customerSearchInput' : 'customerSearchInputMobile';
        const inp = document.getElementById(inputId);
        if (inp && !inp.contains(e.target) && !dd.contains(e.target)) {
            dd.style.display = 'none';
        }
    });
});

function showCustomerResults(results, dropdown, input, card, isRecent) {
    if (!Array.isArray(results) || !results.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = '';
    if (isRecent) {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:10px;color:#9ca3af;padding:6px 14px;font-weight:600;';
        hdr.textContent = 'RECENT';
        dropdown.appendChild(hdr);
    }
    results.forEach(function(c) {
        const badgeClass = c.source === 'zoho' ? 'badge-zoho' : c.source === 'both' ? 'badge-both' : 'badge-local';
        const badgeLabel = c.source === 'zoho' ? 'Zoho' : c.source === 'both' ? 'Both' : 'Local';
        const item = document.createElement('div');
        item.className = 'customer-item';
        item.dataset.customer = JSON.stringify(c);
        item.innerHTML = '<div>'
            + '<div style="font-size:13px;font-weight:700;">' + esc(c.name) + '</div>'
            + '<div style="font-size:11px;color:#6b7280;">' + esc(c.phone) + '</div>'
            + '</div>'
            + '<span class="source-badge ' + badgeClass + '">' + badgeLabel + '</span>';
        item.addEventListener('click', function() {
            selectCustomer(c, input.id, dropdown.id, card.id);
        });
        dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
}

function selectCustomer(c, inputId, dropdownId, cardId) {
    selectedCustomer = c;
    saveRecentCustomer(c);
    document.getElementById(inputId).value = c.name;
    document.getElementById(dropdownId).style.display = 'none';
    const card = document.getElementById(cardId);
    card.innerHTML = '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + esc(c.name) + '</div>'
        + '<div style="font-size:12px;color:#374151;">' + esc(c.phone) + (c.email ? ' · ' + esc(c.email) : '') + '</div>'
        + (c.address ? '<div style="font-size:11px;color:#6b7280;margin-top:2px;">' + esc(c.address) + '</div>' : '');
    card.style.display = 'block';

    // Sync both desktop + mobile inputs
    ['customerSearchInput','customerSearchInputMobile'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && el.id !== inputId) el.value = c.name;
    });
    ['customerCard','customerCardMobile'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && el.id !== cardId) { el.innerHTML = card.innerHTML; el.style.display = 'block'; }
    });
}

// ════════════════════════════════════════
// NEW CUSTOMER MODAL
// ════════════════════════════════════════
function openNewCustomerModal() {
    document.getElementById('newCustomerModal').classList.add('open');
    loadBranches();
}
function closeNewCustomerModal() {
    document.getElementById('newCustomerModal').classList.remove('open');
}
async function loadBranches() {
    const sel = document.getElementById('newCustBranch');
    if (sel.options.length > 1) return;
    try {
        const res = await apiRequest('/api/branches/list');
        const data = await res.json();
        const branches = data.data || data;
        sel.innerHTML = '<option value="">-- Select --</option>'
            + branches.map(function(b) { return '<option value="' + b.id + '">' + esc(b.name) + '</option>'; }).join('');
    } catch(e) { console.error('loadBranches', e); }
}
async function createCustomer(e) {
    try {
        const payload = {
            name: document.getElementById('newCustName').value.trim(),
            phone: document.getElementById('newCustPhone').value.trim(),
            email: document.getElementById('newCustEmail').value.trim() || null,
            address: document.getElementById('newCustAddress').value.trim() || null,
            branch_id: document.getElementById('newCustBranch').value || null
        };
        const res = await apiRequest('/api/customers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        const customer = { id: String(data.id), name: payload.name, phone: payload.phone, email: payload.email || '', address: payload.address || '', source: 'local', zoho_contact_id: null, local_customer_id: data.id };
        selectCustomer(customer, 'customerSearchInput', 'customerDropdownPanel', 'customerCard');
        closeNewCustomerModal();
    } catch(e) { alert('Error: ' + e.message); }
}

// ════════════════════════════════════════
// FILTER OPTIONS + CHIPS
// ════════════════════════════════════════
async function loadFilterOptions() {
    try {
        const res = await apiRequest('/api/estimates/filter-options');
        filterOptions = await res.json();
        renderChips('brandChips', filterOptions.brands, 'brand');
        renderChips('categoryChips', filterOptions.categories, 'category');
        renderChips('brandChipsMobile', filterOptions.brands, 'brand');
        renderChips('categoryChipsMobile', filterOptions.categories, 'category');
    } catch(e) { console.error('loadFilterOptions', e); }
}

function renderChips(containerId, items, filterKey) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    items.forEach(function(item) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.dataset.key = filterKey;
        chip.dataset.val = item;
        chip.textContent = item;
        chip.addEventListener('click', function() { toggleChip(chip, filterKey, item); });
        el.appendChild(chip);
    });
}

function toggleChip(el, key, val) {
    var isMobile = el.closest('#productDrawer') !== null;
    var isActive = el.classList.contains('active');

    el.closest('.filter-chips').querySelectorAll('.chip').forEach(function(c) { c.classList.remove('active'); });

    if (!isActive) {
        el.classList.add('active');
        activeFilters[key] = val;
    } else {
        activeFilters[key] = '';
    }

    var otherContainerId = isMobile
        ? (key === 'brand' ? 'brandChips' : 'categoryChips')
        : (key === 'brand' ? 'brandChipsMobile' : 'categoryChipsMobile');
    document.querySelectorAll('#' + otherContainerId + ' .chip').forEach(function(c) {
        c.classList.toggle('active', c.dataset.val === activeFilters[key]);
    });

    triggerProductSearch();
}

// ════════════════════════════════════════
// PRODUCT SEARCH
// ════════════════════════════════════════
function initProductSearch(inputId, listId, brandChipsId, categoryChipsId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', function() {
        clearTimeout(_productSearchTimer);
        _productSearchTimer = setTimeout(triggerProductSearch, 400);
    });
}

async function triggerProductSearch() {
    var desktopInput = document.getElementById('productSearchInput');
    var mobileInput  = document.getElementById('productSearchInputMobile');
    var activeInput  = document.activeElement;
    var q = '';
    if (activeInput === desktopInput && desktopInput) q = desktopInput.value;
    else if (activeInput === mobileInput && mobileInput) q = mobileInput.value;
    else if (desktopInput) q = desktopInput.value;

    if (desktopInput && document.activeElement !== desktopInput) desktopInput.value = q;
    if (mobileInput  && document.activeElement !== mobileInput)  mobileInput.value  = q;

    var empty = '<div class="text-center text-gray-400 text-sm py-6">Type to search products...</div>';
    if (!q && !activeFilters.brand && !activeFilters.category) {
        var pl = document.getElementById('productList');
        var plm = document.getElementById('productListMobile');
        if (pl) pl.innerHTML = empty;
        if (plm) plm.innerHTML = empty;
        return;
    }

    var params = new URLSearchParams({ q: q });
    if (activeFilters.brand) params.set('brand', activeFilters.brand);
    if (activeFilters.category) params.set('category', activeFilters.category);

    try {
        var res = await apiRequest('/api/estimates/search-products?' + params.toString());
        var products = await res.json();
        renderProductList(products, 'productList');
        renderProductList(products, 'productListMobile');
    } catch(e) { console.error('product search', e); }
}

// ════════════════════════════════════════
// PRODUCT LIST RENDERING
// ════════════════════════════════════════
function renderProductList(products, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    if (!products.length) {
        el.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No products found</div>';
        return;
    }
    products.forEach(function(p) {
        el.appendChild(buildProductRowEl(p));
    });
}

function buildProductRowEl(p) {
    var stockClass = p.stock_on_hand > 0 ? 'stock-in' : 'stock-out';
    var stockLabel = p.stock_on_hand > 0 ? 'Stock: ' + p.stock_on_hand : 'Out of stock';
    var rowId = 'pr_' + p.zoho_item_id.replace(/[^a-z0-9]/gi, '_');

    var row = document.createElement('div');
    row.className = 'product-row';
    row.id = rowId;

    var header = document.createElement('div');
    header.className = 'product-row-header';
    header.innerHTML = '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p.name) + '</div>'
        + '<div style="font-size:11px;color:#6b7280;">' + esc(p.brand) + (p.category ? ' · ' + esc(p.category) : '') + ' · ' + fmt(p.rate) + '</div>'
        + '</div>'
        + '<span class="stock-badge ' + stockClass + ' ml-2">' + esc(stockLabel) + '</span>';

    var expand = document.createElement('div');
    expand.className = 'product-row-expand';
    expand.id = rowId + '_expand';
    expand.dataset.rate = p.rate;

    row.appendChild(header);
    row.appendChild(expand);

    row.addEventListener('click', function() {
        toggleProductRow(row, expand, p);
    });

    return row;
}

function toggleProductRow(row, expand, p) {
    var isOpen = row.classList.contains('expanded');
    document.querySelectorAll('.product-row.expanded').forEach(function(r) {
        r.classList.remove('expanded');
    });
    if (!isOpen) {
        row.classList.add('expanded');
        renderProductExpand(expand, p);
    }
}

// ════════════════════════════════════════
// PRODUCT EXPAND PANEL
// ════════════════════════════════════════
function renderProductExpand(expandEl, p) {
    var hasArea = p.has_area_calc && p.area_coverage > 0;
    expandEl.innerHTML = '';

    var wrapper = document.createElement('div');

    if (hasArea) {
        var modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:flex;gap:12px;margin-bottom:10px;';

        var unitLabel = document.createElement('label');
        unitLabel.style.cssText = 'font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;';
        var unitRadio = document.createElement('input');
        unitRadio.type = 'radio';
        unitRadio.name = 'mode_' + p.zoho_item_id;
        unitRadio.value = 'unit';
        unitRadio.checked = true;
        unitRadio.addEventListener('change', function() { switchMode(p.zoho_item_id, 'unit'); });
        unitLabel.appendChild(unitRadio);
        unitLabel.appendChild(document.createTextNode(' Unit qty'));

        var areaLabel = document.createElement('label');
        areaLabel.style.cssText = 'font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;';
        var areaRadio = document.createElement('input');
        areaRadio.type = 'radio';
        areaRadio.name = 'mode_' + p.zoho_item_id;
        areaRadio.value = 'area';
        areaRadio.addEventListener('change', function() { switchMode(p.zoho_item_id, 'area'); });
        areaLabel.appendChild(areaRadio);
        areaLabel.appendChild(document.createTextNode(' Area (sq.ft)'));

        modeRow.appendChild(unitLabel);
        modeRow.appendChild(areaLabel);
        wrapper.appendChild(modeRow);
    }

    // Unit mode div
    var unitDiv = document.createElement('div');
    unitDiv.id = 'unitMode_' + p.zoho_item_id;

    var stepper = document.createElement('div');
    stepper.className = 'qty-stepper mb-3';

    var minusBtn = document.createElement('button');
    minusBtn.className = 'qty-btn';
    minusBtn.type = 'button';
    minusBtn.textContent = '−';
    minusBtn.addEventListener('click', function(e) { e.stopPropagation(); stepQty(p.zoho_item_id, -1, p.rate); });

    var qtySpan = document.createElement('span');
    qtySpan.className = 'qty-display';
    qtySpan.id = 'qty_' + p.zoho_item_id;
    qtySpan.textContent = '1';

    var plusBtn = document.createElement('button');
    plusBtn.className = 'qty-btn';
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', function(e) { e.stopPropagation(); stepQty(p.zoho_item_id, 1, p.rate); });

    var unitLabel2 = document.createElement('span');
    unitLabel2.style.cssText = 'font-size:12px;color:#6b7280;margin-left:4px;';
    unitLabel2.textContent = p.unit || 'Nos';

    var unitTotal = document.createElement('span');
    unitTotal.id = 'unitTotal_' + p.zoho_item_id;
    unitTotal.style.cssText = 'font-size:13px;font-weight:700;margin-left:auto;';
    unitTotal.textContent = fmt(p.rate);

    stepper.appendChild(minusBtn);
    stepper.appendChild(qtySpan);
    stepper.appendChild(plusBtn);
    stepper.appendChild(unitLabel2);
    stepper.appendChild(unitTotal);
    unitDiv.appendChild(stepper);

    // Optional name override + description inputs
    var safeItemId = p.zoho_item_id.replace(/[^a-z0-9]/gi, '_');

    function mkField(label, id, placeholder, isTextarea) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:6px;';
        var lbl = document.createElement('label');
        lbl.style.cssText = 'font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:2px;';
        lbl.textContent = label;
        var inp = isTextarea ? document.createElement('textarea') : document.createElement('input');
        if (!isTextarea) inp.type = 'text';
        inp.id = id;
        inp.placeholder = placeholder;
        inp.style.cssText = 'width:100%;padding:5px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;resize:vertical;';
        if (isTextarea) { inp.rows = 2; }
        inp.addEventListener('click', function(e) { e.stopPropagation(); });
        wrap.appendChild(lbl);
        wrap.appendChild(inp);
        return wrap;
    }

    unitDiv.appendChild(mkField('Item Name (leave blank to use product name)', 'iname_' + safeItemId, p.name));
    unitDiv.appendChild(mkField('Description (optional)', 'idesc_' + safeItemId, 'Add a note or description...', true));

    var addUnitBtn = document.createElement('button');
    addUnitBtn.className = 'btn-primary';
    addUnitBtn.type = 'button';
    addUnitBtn.style.padding = '8px';
    addUnitBtn.textContent = '+ Add to Estimate';
    addUnitBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        addUnitToEstimate(p);
    });
    unitDiv.appendChild(addUnitBtn);
    wrapper.appendChild(unitDiv);

    // Area mode div (only if has_area_calc)
    if (hasArea) {
        var areaDiv = document.createElement('div');
        areaDiv.id = 'areaMode_' + p.zoho_item_id;
        areaDiv.style.display = 'none';

        var areaInputs = document.createElement('div');
        areaInputs.className = 'area-inputs';

        var sqftGroup = document.createElement('div');
        sqftGroup.className = 'area-input-group';
        var sqftLabel = document.createElement('label');
        sqftLabel.textContent = 'Square Feet';
        var sqftInput = document.createElement('input');
        sqftInput.type = 'number';
        sqftInput.id = 'sqft_' + p.zoho_item_id;
        sqftInput.min = '1';
        sqftInput.step = '1';
        sqftInput.placeholder = 'e.g. 500';
        sqftInput.addEventListener('input', function() {
            recalcArea(p.zoho_item_id, p.area_coverage, p.local_product_id, p);
        });
        sqftGroup.appendChild(sqftLabel);
        sqftGroup.appendChild(sqftInput);

        var coatsGroup = document.createElement('div');
        coatsGroup.className = 'area-input-group';
        var coatsLabel = document.createElement('label');
        coatsLabel.textContent = 'Coats';
        var coatsInput = document.createElement('input');
        coatsInput.type = 'number';
        coatsInput.id = 'coats_' + p.zoho_item_id;
        coatsInput.min = '1';
        coatsInput.max = '5';
        coatsInput.value = '2';
        coatsInput.addEventListener('input', function() {
            recalcArea(p.zoho_item_id, p.area_coverage, p.local_product_id, p);
        });
        coatsGroup.appendChild(coatsLabel);
        coatsGroup.appendChild(coatsInput);

        areaInputs.appendChild(sqftGroup);
        areaInputs.appendChild(coatsGroup);
        areaDiv.appendChild(areaInputs);

        var areaResult = document.createElement('div');
        areaResult.className = 'calc-result';
        areaResult.id = 'areaResult_' + p.zoho_item_id;
        areaResult.style.display = 'none';
        areaDiv.appendChild(areaResult);

        var addAreaBtn = document.createElement('button');
        addAreaBtn.className = 'btn-primary mt-2';
        addAreaBtn.type = 'button';
        addAreaBtn.style.cssText = 'padding:8px;display:none;';
        addAreaBtn.id = 'areaAddBtn_' + p.zoho_item_id;
        addAreaBtn.textContent = '+ Add to Estimate';
        addAreaBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            addAreaToEstimate(p.zoho_item_id);
        });
        areaDiv.appendChild(addAreaBtn);

        wrapper.appendChild(areaDiv);
    }

    expandEl.appendChild(wrapper);
}

function switchMode(itemId, mode) {
    var unitEl = document.getElementById('unitMode_' + itemId);
    var areaEl = document.getElementById('areaMode_' + itemId);
    if (unitEl) unitEl.style.display = mode === 'unit' ? 'block' : 'none';
    if (areaEl) areaEl.style.display = mode === 'area' ? 'block' : 'none';
}

function stepQty(itemId, delta, rate) {
    var el = document.getElementById('qty_' + itemId);
    var totalEl = document.getElementById('unitTotal_' + itemId);
    if (!el) return;
    var qty = Math.max(1, parseInt(el.textContent) + delta);
    el.textContent = qty;
    if (totalEl) totalEl.textContent = fmt(rate * qty);
}

// ════════════════════════════════════════
// AREA CALCULATOR
// ════════════════════════════════════════
var _areaComboCache = {};

async function fetchSiblingPacks(localProductId) {
    if (_areaComboCache[localProductId]) return _areaComboCache[localProductId];
    try {
        var res = await apiRequest('/api/products/' + localProductId);
        var data = await res.json();
        var packs = (data.pack_sizes || [])
            .filter(function(ps) { return ps.is_active && ps.zoho_item_id; })
            .map(function(ps) {
                return {
                    zoho_item_id: ps.zoho_item_id,
                    name: data.name + ' ' + ps.size + (ps.unit || 'L'),
                    size: parseFloat(ps.size),
                    rate: parseFloat(ps.base_price)
                };
            });
        _areaComboCache[localProductId] = packs;
        return packs;
    } catch(e) { return []; }
}

function calculatePackCombo(litersNeeded, packSizes) {
    if (!packSizes || !packSizes.length) return [];
    var sorted = packSizes.slice().sort(function(a, b) { return b.size - a.size; });
    var result = [];
    var remaining = litersNeeded;
    for (var i = 0; i < sorted.length; i++) {
        var pack = sorted[i];
        if (remaining <= 0.001) break;
        var count = Math.floor(remaining / pack.size);
        if (count > 0) {
            result.push({ zoho_item_id: pack.zoho_item_id, name: pack.name, size: pack.size, rate: pack.rate, quantity: count });
            remaining -= count * pack.size;
        }
    }
    if (remaining > 0.001) {
        var smallest = sorted[sorted.length - 1];
        var existing = null;
        for (var j = 0; j < result.length; j++) {
            if (result[j].zoho_item_id === smallest.zoho_item_id) { existing = result[j]; break; }
        }
        if (existing) existing.quantity += 1;
        else result.push({ zoho_item_id: smallest.zoho_item_id, name: smallest.name, size: smallest.size, rate: smallest.rate, quantity: 1 });
    }
    return result;
}

var _pendingAreaCombo = {};
var _pendingAreaMeta = {};
var _recalcToken = {};

async function recalcArea(itemId, coverage, localProductId, p) {
    var token = (_recalcToken[itemId] = ((_recalcToken[itemId] || 0) + 1));
    var myToken = token;
    var sqftEl = document.getElementById('sqft_' + itemId);
    var coatsEl = document.getElementById('coats_' + itemId);
    var resultEl = document.getElementById('areaResult_' + itemId);
    var addBtn = document.getElementById('areaAddBtn_' + itemId);
    if (!sqftEl || !resultEl || !addBtn) return;

    var sqft = parseFloat(sqftEl.value) || 0;
    var coats = parseFloat(coatsEl ? coatsEl.value : 2) || 2;
    if (sqft <= 0) { resultEl.style.display = 'none'; addBtn.style.display = 'none'; return; }

    var liters = (sqft * coats) / coverage;

    if (localProductId) {
        var sibs = await fetchSiblingPacks(localProductId);
        if (_recalcToken[itemId] !== myToken) return;
        if (sibs.length > 0) {
            var combo = calculatePackCombo(liters, sibs);
            _pendingAreaCombo[itemId] = combo;
            var comboStr = combo.map(function(c) { return c.quantity + '×' + c.name; }).join(' + ');
            _pendingAreaMeta[itemId] = { sqft: sqft, coats: coats, mix_info: comboStr };
            resultEl.textContent = '→ ' + liters.toFixed(1) + 'L needed → ' + comboStr;
            resultEl.style.display = 'block';
            addBtn.style.display = 'block';
            return;
        }
    }

    var singleQty = Math.max(1, Math.ceil(liters));
    var singleText = '→ ' + liters.toFixed(1) + 'L needed → approx ' + singleQty + ' unit(s) of this item';
    _pendingAreaCombo[itemId] = [{ zoho_item_id: p.zoho_item_id, name: p.name, size: 1, rate: p.rate, quantity: singleQty }];
    _pendingAreaMeta[itemId] = { sqft: sqft, coats: coats, mix_info: singleText };
    resultEl.textContent = singleText;
    resultEl.style.display = 'block';
    addBtn.style.display = 'block';
}

// ════════════════════════════════════════
// ADD TO ESTIMATE
// ════════════════════════════════════════
function addUnitToEstimate(p) {
    var qtyEl = document.getElementById('qty_' + p.zoho_item_id);
    var qty = qtyEl ? Math.max(1, parseInt(qtyEl.textContent) || 1) : 1;
    var sid = p.zoho_item_id.replace(/[^a-z0-9]/gi, '_');
    var nameEl = document.getElementById('iname_' + sid);
    var descEl = document.getElementById('idesc_' + sid);
    pushEstimateItem({
        zoho_item_id: p.zoho_item_id,
        name: (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : p.name,
        description: descEl ? descEl.value.trim() : '',
        brand: p.brand || '',
        base_price: p.rate,
        quantity: qty,
        unit: p.unit || 'Nos'
    });
}

function addAreaToEstimate(itemId) {
    var combo = _pendingAreaCombo[itemId];
    var meta  = _pendingAreaMeta[itemId] || {};
    if (!combo || !combo.length) return;
    combo.forEach(function(c, idx) {
        pushEstimateItem({
            zoho_item_id: c.zoho_item_id,
            name: c.name,
            base_price: c.rate,
            quantity: c.quantity,
            unit: 'Nos',
            area: idx === 0 ? meta.sqft || null : null,
            num_coats: idx === 0 ? meta.coats || null : null,
            mix_info: idx === 0 ? meta.mix_info || null : null
        });
    });
}

function pushEstimateItem(item) {
    var id = itemIdCounter++;
    estimateItems.push({
        id: id,
        item_type: 'product',
        zoho_item_id: item.zoho_item_id,
        name: item.name,
        description: item.description || '',
        brand: item.brand || '',
        base_price: parseFloat(item.base_price) || 0,
        quantity: item.quantity || 1,
        unit: item.unit || 'Nos',
        area: item.area || null,
        num_coats: item.num_coats || null,
        mix_info: item.mix_info || null,
        markup_type: '',
        markup_value: '',
        discount_type: '',
        discount_value: ''
    });
    renderEstimateItems();
    updateTotals();
}

// ════════════════════════════════════════
// PRICING CALCULATION
// ════════════════════════════════════════
function recalcItem(item) {
    var bp = parseFloat(item.base_price) || 0;
    var qty = parseFloat(item.quantity) || 1;
    var markup = 0;
    if (item.markup_type && parseFloat(item.markup_value) > 0) {
        var mv = parseFloat(item.markup_value);
        if (item.markup_type === 'price_pct') markup = bp * mv / 100;
        else if (item.markup_type === 'price_value') markup = mv;
    }
    var afterMarkup = bp + markup;
    var discount = 0;
    if (item.discount_type && parseFloat(item.discount_value) > 0) {
        var dv = parseFloat(item.discount_value);
        if (item.discount_type === 'price_pct') discount = afterMarkup * dv / 100;
        else if (item.discount_type === 'price_value') discount = dv;
    }
    // Mirror server calculateItemPricing: round the line total to ₹10 ONCE from the
    // un-rounded unit price, then derive unit price as line/qty (no double-round).
    var finalUnrounded = afterMarkup - discount;
    var safeQty = qty > 0 ? qty : 1;
    item.line_total = roundUp10(finalUnrounded * safeQty);
    item.final_price = Math.round((item.line_total / safeQty) * 100) / 100;
}

// ════════════════════════════════════════
// ESTIMATE ITEMS RENDERING
// ════════════════════════════════════════
function renderEstimateItems() {
    var container = document.getElementById('estimateItemsContainer');
    var empty = document.getElementById('estimateEmpty');
    if (!container) return;

    container.querySelectorAll('.est-item-card').forEach(function(c) { c.remove(); });

    if (!estimateItems.length) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    var laborSection = container.querySelector('.panel-section.mt-3') || null;

    estimateItems.forEach(function(item) {
        recalcItem(item);

        var card = document.createElement('div');
        card.className = 'est-item-card';
        card.id = 'eitm_' + item.id;

        var header = document.createElement('div');
        header.className = 'est-item-header';
        header.addEventListener('click', function() { toggleItemCard(item.id); });

        var headerLeft = document.createElement('div');
        headerLeft.style.cssText = 'flex:1;min-width:0;';
        var nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameDiv.textContent = item.name;
        var subDiv = document.createElement('div');
        subDiv.style.cssText = 'font-size:11px;color:#6b7280;';
        subDiv.textContent = item.quantity + ' ' + item.unit + ' · ' + fmt(item.base_price) + '/unit';
        headerLeft.appendChild(nameDiv);
        headerLeft.appendChild(subDiv);

        var headerRight = document.createElement('div');
        headerRight.style.cssText = 'text-align:right;flex-shrink:0;margin-left:8px;';
        var totalDiv = document.createElement('div');
        totalDiv.style.cssText = 'font-size:15px;font-weight:800;color:#1f2937;';
        totalDiv.textContent = fmt(item.line_total);
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.style.cssText = 'font-size:10px;color:#dc2626;background:none;border:none;cursor:pointer;padding:0;';
        removeBtn.textContent = '✕ Remove';
        removeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            removeItem(item.id);
        });
        headerRight.appendChild(totalDiv);
        headerRight.appendChild(removeBtn);

        header.appendChild(headerLeft);
        header.appendChild(headerRight);

        var expand = document.createElement('div');
        expand.className = 'est-item-expand';

        // Forward-declare priceInfo so qty/price callbacks can update it
        var priceInfo;

        // Qty stepper row
        var qtyRow = document.createElement('div');
        qtyRow.className = 'md-row';
        qtyRow.style.marginBottom = '8px';
        var qtyLabel = document.createElement('span');
        qtyLabel.className = 'md-label';
        qtyLabel.textContent = 'Qty';
        var qtyMinusBtn = document.createElement('button');
        qtyMinusBtn.type = 'button';
        qtyMinusBtn.className = 'qty-btn';
        qtyMinusBtn.textContent = '−';
        var qtyDisplay = document.createElement('span');
        qtyDisplay.className = 'qty-display';
        qtyDisplay.textContent = item.quantity;
        var qtyPlusBtn = document.createElement('button');
        qtyPlusBtn.type = 'button';
        qtyPlusBtn.className = 'qty-btn';
        qtyPlusBtn.textContent = '+';
        var qtyUnitSpan = document.createElement('span');
        qtyUnitSpan.style.cssText = 'font-size:12px;color:#6b7280;margin-left:4px;';
        qtyUnitSpan.textContent = item.unit || 'Nos';

        function refreshItemDisplay() {
            qtyDisplay.textContent = item.quantity;
            subDiv.textContent = item.quantity + ' ' + item.unit + ' · ' + fmt(item.base_price) + '/unit';
            recalcItem(item);
            totalDiv.textContent = fmt(item.line_total);
            if (priceInfo) priceInfo.innerHTML = 'Final price: <strong>' + fmt(item.final_price) + '</strong>/unit · Total: <strong>' + fmt(item.line_total) + '</strong>';
            updateTotals();
        }
        qtyMinusBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (item.quantity > 1) { item.quantity--; refreshItemDisplay(); }
        });
        qtyPlusBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            item.quantity++;
            refreshItemDisplay();
        });
        qtyRow.appendChild(qtyLabel);
        qtyRow.appendChild(qtyMinusBtn);
        qtyRow.appendChild(qtyDisplay);
        qtyRow.appendChild(qtyPlusBtn);
        qtyRow.appendChild(qtyUnitSpan);

        // Base price edit row
        var priceRow = document.createElement('div');
        priceRow.className = 'md-row';
        var priceLabel = document.createElement('span');
        priceLabel.className = 'md-label';
        priceLabel.style.color = '#374151';
        priceLabel.textContent = 'Base Price';
        var priceInput = document.createElement('input');
        priceInput.type = 'number';
        priceInput.className = 'md-input';
        priceInput.min = '0';
        priceInput.step = '0.01';
        priceInput.value = item.base_price || '';
        priceInput.style.width = '100px';
        priceInput.title = 'Edit base price per unit';
        var priceUnit = document.createElement('span');
        priceUnit.style.cssText = 'font-size:11px;color:#6b7280;';
        priceUnit.textContent = '/ ' + (item.unit || 'unit');
        priceInput.addEventListener('input', function() {
            var v = parseFloat(this.value);
            if (!isNaN(v) && v >= 0) {
                item.base_price = v;
                refreshItemDisplay();
            }
        });
        priceRow.appendChild(priceLabel);
        priceRow.appendChild(priceInput);
        priceRow.appendChild(priceUnit);

        // Markup row
        var markupRow = document.createElement('div');
        markupRow.className = 'md-row';
        var markupLabel = document.createElement('span');
        markupLabel.className = 'md-label';
        markupLabel.style.color = '#7c3aed';
        markupLabel.textContent = 'Markup';
        var markupSel = document.createElement('select');
        markupSel.className = 'md-select';
        markupSel.innerHTML = '<option value="">None</option><option value="price_pct">%</option><option value="price_value">₹</option>';
        markupSel.value = item.markup_type || '';
        markupSel.addEventListener('change', function() { item.markup_type = this.value; });
        var markupInput = document.createElement('input');
        markupInput.type = 'number';
        markupInput.className = 'md-input';
        markupInput.min = '0';
        markupInput.step = '0.01';
        markupInput.value = item.markup_value || '';
        markupInput.placeholder = '0';
        markupInput.addEventListener('change', function() { item.markup_value = this.value; });
        var markupApply = document.createElement('button');
        markupApply.type = 'button';
        markupApply.className = 'md-btn';
        markupApply.style.cssText = 'background:#7c3aed;color:white;';
        markupApply.textContent = 'Apply';
        markupApply.addEventListener('click', function() { renderEstimateItems(); updateTotals(); });
        markupRow.appendChild(markupLabel);
        markupRow.appendChild(markupSel);
        markupRow.appendChild(markupInput);
        markupRow.appendChild(markupApply);

        // Discount row
        var discountRow = document.createElement('div');
        discountRow.className = 'md-row';
        var discountLabel = document.createElement('span');
        discountLabel.className = 'md-label';
        discountLabel.style.color = '#dc2626';
        discountLabel.textContent = 'Discount';
        var discountSel = document.createElement('select');
        discountSel.className = 'md-select';
        discountSel.innerHTML = '<option value="">None</option><option value="price_pct">%</option><option value="price_value">₹</option>';
        discountSel.value = item.discount_type || '';
        discountSel.addEventListener('change', function() { item.discount_type = this.value; });
        var discountInput = document.createElement('input');
        discountInput.type = 'number';
        discountInput.className = 'md-input';
        discountInput.min = '0';
        discountInput.step = '0.01';
        discountInput.value = item.discount_value || '';
        discountInput.placeholder = '0';
        discountInput.addEventListener('change', function() { item.discount_value = this.value; });
        var discountApply = document.createElement('button');
        discountApply.type = 'button';
        discountApply.className = 'md-btn';
        discountApply.style.cssText = 'background:#dc2626;color:white;';
        discountApply.textContent = 'Apply';
        discountApply.addEventListener('click', function() { renderEstimateItems(); updateTotals(); });
        discountRow.appendChild(discountLabel);
        discountRow.appendChild(discountSel);
        discountRow.appendChild(discountInput);
        discountRow.appendChild(discountApply);

        priceInfo = document.createElement('div');
        priceInfo.style.cssText = 'font-size:12px;color:#374151;margin-top:4px;';
        priceInfo.innerHTML = 'Final price: <strong>' + fmt(item.final_price) + '</strong>/unit · Total: <strong>' + fmt(item.line_total) + '</strong>';

        // Name edit row
        var nameEditRow = document.createElement('div');
        nameEditRow.className = 'md-row';
        var nameEditLabel = document.createElement('span');
        nameEditLabel.className = 'md-label';
        nameEditLabel.textContent = 'Name';
        var nameEditInput = document.createElement('input');
        nameEditInput.type = 'text';
        nameEditInput.value = item.name;
        nameEditInput.style.cssText = 'flex:1;font-size:12px;border:1px solid #d1d5db;border-radius:5px;padding:4px 6px;';
        nameEditInput.addEventListener('input', function() {
            item.name = this.value;
            nameDiv.textContent = this.value;
        });
        nameEditRow.appendChild(nameEditLabel);
        nameEditRow.appendChild(nameEditInput);

        // Description edit row
        var descEditRow = document.createElement('div');
        descEditRow.className = 'md-row';
        descEditRow.style.alignItems = 'flex-start';
        var descEditLabel = document.createElement('span');
        descEditLabel.className = 'md-label';
        descEditLabel.style.paddingTop = '4px';
        descEditLabel.textContent = 'Desc';
        var descEditInput = document.createElement('textarea');
        descEditInput.rows = 2;
        descEditInput.value = item.description || '';
        descEditInput.placeholder = 'Add description...';
        descEditInput.style.cssText = 'flex:1;font-size:12px;border:1px solid #d1d5db;border-radius:5px;padding:4px 6px;resize:vertical;';
        descEditInput.addEventListener('input', function() {
            item.description = this.value;
        });
        descEditRow.appendChild(descEditLabel);
        descEditRow.appendChild(descEditInput);

        expand.appendChild(qtyRow);
        expand.appendChild(nameEditRow);
        expand.appendChild(descEditRow);
        expand.appendChild(priceRow);
        expand.appendChild(markupRow);
        expand.appendChild(discountRow);
        expand.appendChild(priceInfo);

        card.appendChild(header);
        card.appendChild(expand);

        container.insertBefore(card, laborSection);
    });
}

function toggleItemCard(id) {
    var card = document.getElementById('eitm_' + id);
    if (card) card.classList.toggle('open');
}

function removeItem(id) {
    estimateItems = estimateItems.filter(function(i) { return i.id !== id; });
    renderEstimateItems();
    updateTotals();
}

// ════════════════════════════════════════
// OVERALL MARKUP / DISCOUNT
// ════════════════════════════════════════
function applyOverallMarkup() {
    var type = document.getElementById('overallMarkupType').value;
    var val  = document.getElementById('overallMarkupValue').value;
    estimateItems.forEach(function(i) { i.markup_type = type; i.markup_value = val; });
    renderEstimateItems();
    updateTotals();
}
function clearOverallMarkup() {
    document.getElementById('overallMarkupValue').value = '';
    estimateItems.forEach(function(i) { i.markup_type = ''; i.markup_value = ''; });
    renderEstimateItems();
    updateTotals();
}
function applyOverallDiscount() {
    var type = document.getElementById('overallDiscountType').value;
    var val  = document.getElementById('overallDiscountValue').value;
    estimateItems.forEach(function(i) { i.discount_type = type; i.discount_value = val; });
    renderEstimateItems();
    updateTotals();
}
function clearOverallDiscount() {
    document.getElementById('overallDiscountValue').value = '';
    estimateItems.forEach(function(i) { i.discount_type = ''; i.discount_value = ''; });
    renderEstimateItems();
    updateTotals();
}

// ════════════════════════════════════════
// LABOR CHARGES
// ════════════════════════════════════════
function addLaborItem() {
    var id = laborIdCounter++;
    laborItems.push({ id: id, description: '', amount: 0 });
    renderLaborItems();
}

function renderLaborItems() {
    var container = document.getElementById('laborContainer');
    var totalRow = document.getElementById('laborTotalRow');
    if (!container) return;

    container.innerHTML = '';
    laborItems.forEach(function(l) {
        var row = document.createElement('div');
        row.id = 'labor_' + l.id;
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';

        var descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.placeholder = 'Description (e.g. Wall Painting)';
        descInput.value = l.description || '';
        descInput.style.cssText = 'flex:1;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;';
        descInput.addEventListener('change', function() { l.description = this.value; });

        var amtInput = document.createElement('input');
        amtInput.type = 'number';
        amtInput.placeholder = '₹';
        amtInput.value = l.amount || '';
        amtInput.min = '0';
        amtInput.step = '1';
        amtInput.style.cssText = 'width:90px;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;';
        amtInput.addEventListener('input', function() { l.amount = parseFloat(this.value) || 0; updateTotals(); });

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.style.cssText = 'color:#dc2626;background:none;border:none;font-size:18px;cursor:pointer;line-height:1;';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', function() { removeLabor(l.id); });

        row.appendChild(descInput);
        row.appendChild(amtInput);
        row.appendChild(removeBtn);
        container.appendChild(row);
    });

    if (totalRow) {
        if (laborItems.length) totalRow.classList.remove('hidden');
        else totalRow.classList.add('hidden');
    }
    updateTotals();
}

function removeLabor(id) {
    laborItems = laborItems.filter(function(l) { return l.id !== id; });
    renderLaborItems();
}

// ════════════════════════════════════════
// TOTALS
// ════════════════════════════════════════
function updateTotals() {
    estimateItems.forEach(recalcItem);
    var itemsTotal = estimateItems.reduce(function(s, i) { return s + (i.line_total || 0); }, 0);
    var laborTotal = laborItems.reduce(function(s, l) { return s + (parseFloat(l.amount) || 0); }, 0);
    var grandTotal = itemsTotal + laborTotal;

    var subtotalEl = document.getElementById('subtotalAmt');
    var grandEl    = document.getElementById('grandTotalAmt');
    var grandMobEl = document.getElementById('grandTotalAmtMobile');
    var laborEl    = document.getElementById('laborTotalAmt');

    if (subtotalEl) subtotalEl.textContent = fmt(itemsTotal);
    if (grandEl)    grandEl.textContent    = fmt(grandTotal);
    if (grandMobEl) grandMobEl.textContent = fmt(grandTotal);
    if (laborEl)    laborEl.textContent    = fmt(laborTotal);
}


// ════════════════════════════════════════
// SAVE ESTIMATE
// ════════════════════════════════════════
async function saveEstimate() {
    if (!selectedCustomer) {
        alert('Please select a customer first.');
        return;
    }
    if (!estimateItems.length) {
        alert('Please add at least one product.');
        return;
    }

    var payload = {
        customer_name: selectedCustomer.name,
        customer_phone: selectedCustomer.phone || '',
        customer_address: selectedCustomer.address || '',
        // On edit, keep the estimate's original date/validity; only new estimates get today's date
        estimate_date: (isEditMode && originalEstimateDate)
            ? String(originalEstimateDate).split('T')[0]
            : new Date().toISOString().split('T')[0],
        valid_until: (isEditMode && originalValidUntil)
            ? String(originalValidUntil).split('T')[0]
            : null,
        show_gst_breakdown: 0,
        column_visibility: null,
        show_description_only: 0,
        notes: null,
        admin_notes: null,
        status: 'draft',
        branch_id: null,
        items: estimateItems.map(function(i) {
            return {
                item_type: 'product',
                zoho_item_id: i.zoho_item_id,
                item_name: i.name,
                item_description: i.description || i.name,
                base_price: i.base_price,
                unit_price: i.base_price,
                quantity: i.quantity,
                markup_type: i.markup_type || null,
                markup_value: i.markup_value ? parseFloat(i.markup_value) : null,
                discount_type: i.discount_type || null,
                discount_value: i.discount_value ? parseFloat(i.discount_value) : null,
                area: i.area || null,
                num_coats: i.num_coats || null,
                mix_info: i.mix_info || null,
                show_description_only: 0
            };
        }).concat(laborItems.map(function(l) {
            return {
                item_type: 'labor',
                item_name: l.description || 'Labor',
                item_description: l.description || 'Labor',
                base_price: l.amount,
                unit_price: l.amount,
                quantity: 1,
                markup_type: null,
                markup_value: null,
                discount_type: null,
                discount_value: null,
                area: null,
                num_coats: null,
                mix_info: null,
                show_description_only: 0
            };
        }))
    };

    var saveBtn = document.getElementById('saveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
    var saveBtnMobile = document.getElementById('saveBtnMobile');
    if (saveBtnMobile) { saveBtnMobile.disabled = true; saveBtnMobile.textContent = 'Saving...'; }

    try {
        var method = isEditMode ? 'PUT' : 'POST';
        var url = isEditMode ? '/api/estimates/' + editEstimateId : '/api/estimates';
        var headers = { 'Content-Type': 'application/json' };
        // Idempotency-Key on create prevents a double-tap/retry from producing two
        // estimates. One key per page load; a fresh create page = a fresh key.
        if (!isEditMode && window.qcWithIdempotency && estimateCreateIdemKey) {
            headers = window.qcWithIdempotency(estimateCreateIdemKey, headers);
        }
        var res = await apiRequest(url, {
            method: method,
            headers: headers,
            body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        if (isEditMode) {
            showSaveSuccess(editEstimateId, editEstimateNumber, selectedCustomer, true);
        } else {
            showSaveSuccess(data.id, data.estimate_number, selectedCustomer, false);
        }
    } catch(e) {
        alert('Error saving estimate: ' + e.message);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = isEditMode ? '&#128190; Update Estimate' : '&#128190; Save Estimate'; }
        if (saveBtnMobile) { saveBtnMobile.disabled = false; saveBtnMobile.innerHTML = isEditMode ? '&#128190; Update' : '&#128190; Save'; }
    }
}

// ════════════════════════════════════════
// POST-SAVE MODAL
// ════════════════════════════════════════
function showSaveSuccess(estimateId, estimateNumber, customer, isEdit) {
    estimateId = parseInt(estimateId, 10) || estimateId;
    var itemsTotal = estimateItems.reduce(function(s, i) { return s + (i.line_total || 0); }, 0);
    var laborTotal = laborItems.reduce(function(s, l) { return s + (parseFloat(l.amount) || 0); }, 0);
    var grand = itemsTotal + laborTotal;

    var titleEl = document.getElementById('saveSuccessTitle');
    var totalEl = document.getElementById('saveSuccessTotal');
    var waBtn   = document.getElementById('saveSuccessWA');
    var viewBtn = document.getElementById('saveSuccessView');

    if (titleEl) titleEl.textContent = (estimateNumber || 'Estimate') + (isEdit ? ' Updated!' : ' Saved!');
    if (totalEl) totalEl.textContent = 'Grand Total: ' + fmt(grand);

    if (waBtn) {
        if (!customer.phone) {
            waBtn.style.display = 'none';
        } else {
            waBtn.textContent = '📲 Send to ' + customer.name + ' on WhatsApp';
            waBtn.onclick = async function() {
                try {
                    await apiRequest('/api/estimates/' + estimateId + '/send-whatsapp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: customer.phone })
                    });
                    alert('WhatsApp sent successfully!');
                } catch(e) { alert('WhatsApp send failed: ' + e.message); }
            };
        }
    }

    if (viewBtn) {
        viewBtn.onclick = function() {
            window.location.href = '/estimate-view.html?id=' + estimateId;
        };
    }

    var modal = document.getElementById('saveSuccessModal');
    if (modal) modal.classList.add('open');
}

// ════════════════════════════════════════
// LOAD EXISTING ESTIMATE (EDIT MODE)
// ════════════════════════════════════════
async function loadEstimate(id) {
    try {
        var res = await apiRequest('/api/estimates/' + id);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var est = await res.json();
        if (!est || !est.estimate_number) throw new Error('Estimate not found');

        isEditMode = true;
        editEstimateId = id;
        editEstimateNumber = est.estimate_number;
        // Preserve the original document date/validity instead of resetting to today on save
        originalEstimateDate = est.estimate_date || null;
        originalValidUntil = est.valid_until || null;

        // Populate customer
        selectedCustomer = {
            id: null,
            name: est.customer_name || '',
            phone: est.customer_phone || '',
            email: est.customer_email || '',
            address: est.customer_address || '',
            source: 'local',
            zoho_contact_id: null,
            local_customer_id: null
        };
        ['customerSearchInput', 'customerSearchInputMobile'].forEach(function(elId) {
            var el = document.getElementById(elId);
            if (el) el.value = selectedCustomer.name;
        });
        var cardHtml = '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + esc(selectedCustomer.name) + '</div>'
            + '<div style="font-size:12px;color:#374151;">' + esc(selectedCustomer.phone)
            + (selectedCustomer.email ? ' · ' + esc(selectedCustomer.email) : '') + '</div>'
            + (selectedCustomer.address ? '<div style="font-size:11px;color:#6b7280;margin-top:2px;">' + esc(selectedCustomer.address) + '</div>' : '');
        ['customerCard', 'customerCardMobile'].forEach(function(elId) {
            var el = document.getElementById(elId);
            if (el) { el.innerHTML = cardHtml; el.style.display = 'block'; }
        });

        // Populate items
        if (est.items && est.items.length) {
            est.items.forEach(function(item) {
                if (item.item_type === 'labor') {
                    var lid = laborIdCounter++;
                    laborItems.push({
                        id: lid,
                        description: item.item_name || item.item_description || '',
                        amount: parseFloat(item.unit_price || item.base_price || 0)
                    });
                } else {
                    var iid = itemIdCounter++;
                    estimateItems.push({
                        id: iid,
                        item_type: 'product',
                        zoho_item_id: item.zoho_item_id || null,
                        name: item.item_name || item.item_description || '',
                        description: item.item_description || '',
                        brand: item.brand || '',
                        base_price: parseFloat(item.base_price || item.unit_price || 0),
                        quantity: parseFloat(item.quantity || 1),
                        unit: item.pack_size || 'Nos',
                        area: item.area || null,
                        num_coats: item.num_coats || null,
                        mix_info: item.mix_info || null,
                        markup_type: item.markup_type || '',
                        markup_value: item.markup_value != null ? String(item.markup_value) : '',
                        discount_type: item.discount_type || '',
                        discount_value: item.discount_value != null ? String(item.discount_value) : ''
                    });
                }
            });
            renderEstimateItems();
            renderLaborItems();
            updateTotals();
        }

        // Update UI for edit mode
        document.title = 'Edit ' + est.estimate_number + ' - Quality Colors';
        var banner = document.getElementById('editBanner');
        if (banner) { banner.textContent = '✏ Editing: ' + est.estimate_number; banner.style.display = 'block'; }
        var saveBtn = document.getElementById('saveBtn');
        if (saveBtn) saveBtn.innerHTML = '&#128190; Update Estimate';
        var saveBtnM = document.getElementById('saveBtnMobile');
        if (saveBtnM) saveBtnM.innerHTML = '&#128190; Update';

    } catch(e) {
        alert('Failed to load estimate: ' + e.message);
    }
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async function() {
    initCustomerSearch('customerSearchInput', 'customerDropdownPanel', 'customerCard');
    initCustomerSearch('customerSearchInputMobile', 'customerDropdownPanelMobile', 'customerCardMobile');
    try { await loadFilterOptions(); } catch(e) { console.warn('loadFilterOptions:', e); }
    initProductSearch('productSearchInput', 'productList', 'brandChips', 'categoryChips');
    initProductSearch('productSearchInputMobile', 'productListMobile', 'brandChipsMobile', 'categoryChipsMobile');
    var urlParams = new URLSearchParams(window.location.search);
    var editId = urlParams.get('id');
    if (editId) await loadEstimate(editId);
});

// ════════════════════════════════════════
// STATIC HANDLER WIRING (S9+F5 Phase C, 2026-06-25)
// Replaces the literal on*= attributes that were removed from the HTML markup so
// the page runs under strict CSP (script-src-attr 'none'). Each button keeps its
// original id (or gets one) and is bound via addEventListener; the new-customer
// form uses 'submit' + preventDefault, exactly as the original onsubmit did.
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    // "+ New Customer" buttons (desktop + mobile) — no id originally; bind by selector
    document.querySelectorAll('[data-action="openNewCustomerModal"]').forEach(function(btn) {
        btn.addEventListener('click', openNewCustomerModal);
    });

    // Close-modal buttons inside new-customer modal (header ✕ + Cancel)
    document.querySelectorAll('[data-action="closeNewCustomerModal"]').forEach(function(btn) {
        btn.addEventListener('click', closeNewCustomerModal);
    });

    // Overall markup / discount strip
    var applyMarkupBtn = document.getElementById('applyOverallMarkupBtn');
    if (applyMarkupBtn) applyMarkupBtn.addEventListener('click', applyOverallMarkup);
    var clearMarkupBtn = document.getElementById('clearOverallMarkupBtn');
    if (clearMarkupBtn) clearMarkupBtn.addEventListener('click', clearOverallMarkup);
    var applyDiscountBtn = document.getElementById('applyOverallDiscountBtn');
    if (applyDiscountBtn) applyDiscountBtn.addEventListener('click', applyOverallDiscount);
    var clearDiscountBtn = document.getElementById('clearOverallDiscountBtn');
    if (clearDiscountBtn) clearDiscountBtn.addEventListener('click', clearOverallDiscount);

    // + Add Labor
    var addLaborBtn = document.getElementById('addLaborBtn');
    if (addLaborBtn) addLaborBtn.addEventListener('click', addLaborItem);

    // Save Estimate (desktop + mobile)
    var saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveEstimate);
    var saveBtnMobile = document.getElementById('saveBtnMobile');
    if (saveBtnMobile) saveBtnMobile.addEventListener('click', saveEstimate);

    // New customer form submit — original: onsubmit="event.preventDefault(); createCustomer(event)"
    var newCustForm = document.getElementById('newCustomerForm');
    if (newCustForm) {
        newCustForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createCustomer(e);
        });
    }
});
