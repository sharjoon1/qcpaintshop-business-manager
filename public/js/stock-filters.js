/**
 * StockFilterManager — reusable filter panel for stock management pages
 * Provides multi-select dropdowns for Brand/Category, single-select for Stock Status & Last Checked,
 * filter chips with remove, badge count, and both server-side query params and client-side predicates.
 */
class StockFilterManager {
    constructor(opts) {
        this.containerId = opts.containerId || 'filterPanel';
        this.chipsContainerId = opts.chipsContainerId || 'filterChips';
        this.toggleBtnId = opts.toggleBtnId || 'filterToggleBtn';
        this.badgeId = opts.badgeId || 'filterBadge';
        this.showLastChecked = opts.showLastChecked || false;
        this.onFilterChange = opts.onFilterChange || function(){};
        this.filterOptionsUrl = opts.filterOptionsUrl || '/api/zoho/stock/filter-options';

        this.brands = [];
        this.categories = [];
        this.selectedBrands = new Set();
        this.selectedCategories = new Set();
        this.stockStatus = '';
        this.lastChecked = '';
        this.isOpen = false;
        this._openDropdown = null;
    }

    async init() {
        try {
            const resp = await fetch(this.filterOptionsUrl, { headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : {} });
            if (resp.ok) {
                const data = await resp.json();
                if (data.success) {
                    this.brands = data.brands || [];
                    this.categories = data.categories || [];
                }
            }
        } catch (e) { console.warn('Failed to load filter options', e); }

        this._renderPanel();
        this._renderChips();
        this._bindOutsideClick();
    }

    _renderPanel() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        let html = '<div class="filter-panel-inner">';
        // Brand multi-select
        html += '<div class="filter-group"><label>Brand</label>' + this._multiSelectHtml('brand', this.brands, this.selectedBrands) + '</div>';
        // Category multi-select
        html += '<div class="filter-group"><label>Category</label>' + this._multiSelectHtml('category', this.categories, this.selectedCategories) + '</div>';
        // Stock status single-select
        html += '<div class="filter-group"><label>Stock Status</label>';
        html += '<select class="filter-select" id="sfStockStatus" onchange="window._sfm.onStockStatusChange(this.value)">';
        html += '<option value="">All</option><option value="in_stock">In Stock</option><option value="low_stock">Low Stock</option><option value="out_of_stock">Out of Stock</option>';
        html += '</select></div>';
        // Last checked (only for stock-check page)
        if (this.showLastChecked) {
            html += '<div class="filter-group"><label>Last Checked</label>';
            html += '<select class="filter-select" id="sfLastChecked" onchange="window._sfm.onLastCheckedChange(this.value)">';
            html += '<option value="">All</option><option value="never">Never Checked</option><option value="7d">7+ Days Ago</option><option value="30d">30+ Days Ago</option></select></div>';
        }
        html += '</div>';
        container.innerHTML = html;

        // Store ref globally for inline handlers
        window._sfm = this;
    }

    _multiSelectHtml(type, options, selected) {
        const id = 'sf_' + type;
        const label = selected.size ? selected.size + ' selected' : 'All ' + (type === 'brand' ? 'Brands' : 'Categories');
        let html = '<div class="multi-select-wrap" id="' + id + '_wrap">';
        html += '<div class="multi-select-trigger" id="' + id + '_trigger" onclick="window._sfm.toggleDropdown(\'' + type + '\')">';
        html += '<span class="trigger-text">' + this._esc(label) + '</span>';
        html += '<span class="arrow">&#9660;</span></div>';
        html += '<div class="multi-select-dropdown" id="' + id + '_dropdown">';
        html += '<input type="text" class="multi-select-search" placeholder="Search..." oninput="window._sfm.filterOptions(\'' + type + '\', this.value)">';
        html += '<div class="multi-select-options" id="' + id + '_options">';
        if (options.length === 0) {
            html += '<div class="multi-select-empty">No options available</div>';
        } else {
            options.forEach(opt => {
                const checked = selected.has(opt) ? 'checked' : '';
                html += '<div class="multi-select-option" data-value="' + this._esc(opt) + '" onclick="window._sfm.toggleOption(\'' + type + '\', \'' + this._esc(opt).replace(/'/g, "\\'") + '\')">';
                html += '<input type="checkbox" ' + checked + ' tabindex="-1"><span class="opt-label">' + this._esc(opt) + '</span></div>';
            });
        }
        html += '</div></div></div>';
        return html;
    }

    toggleDropdown(type) {
        const id = 'sf_' + type;
        const dd = document.getElementById(id + '_dropdown');
        const trigger = document.getElementById(id + '_trigger');
        if (!dd) return;

        if (dd.classList.contains('show')) {
            dd.classList.remove('show');
            trigger.classList.remove('active');
            this._openDropdown = null;
        } else {
            // Close any other open dropdown
            this._closeAllDropdowns();
            dd.classList.add('show');
            trigger.classList.add('active');
            this._openDropdown = type;
            const searchInput = dd.querySelector('.multi-select-search');
            if (searchInput) { searchInput.value = ''; this.filterOptions(type, ''); searchInput.focus(); }
        }
    }

    _closeAllDropdowns() {
        ['brand', 'category'].forEach(t => {
            const dd = document.getElementById('sf_' + t + '_dropdown');
            const trigger = document.getElementById('sf_' + t + '_trigger');
            if (dd) dd.classList.remove('show');
            if (trigger) trigger.classList.remove('active');
        });
        this._openDropdown = null;
    }

    filterOptions(type, query) {
        const id = 'sf_' + type;
        const container = document.getElementById(id + '_options');
        if (!container) return;
        const q = query.toLowerCase();
        container.querySelectorAll('.multi-select-option').forEach(el => {
            const val = (el.getAttribute('data-value') || '').toLowerCase();
            el.style.display = val.includes(q) ? '' : 'none';
        });
    }

    toggleOption(type, value) {
        const set = type === 'brand' ? this.selectedBrands : this.selectedCategories;
        if (set.has(value)) set.delete(value);
        else set.add(value);

        // Update checkbox visual
        const id = 'sf_' + type;
        const container = document.getElementById(id + '_options');
        if (container) {
            container.querySelectorAll('.multi-select-option').forEach(el => {
                if (el.getAttribute('data-value') === value) {
                    el.querySelector('input').checked = set.has(value);
                }
            });
        }
        // Update trigger text
        this._updateTriggerText(type);
        this._renderChips();
        this._updateBadge();
        this.onFilterChange(this.getFilters());
    }

    _updateTriggerText(type) {
        const id = 'sf_' + type;
        const trigger = document.getElementById(id + '_trigger');
        if (!trigger) return;
        const set = type === 'brand' ? this.selectedBrands : this.selectedCategories;
        const text = set.size ? set.size + ' selected' : 'All ' + (type === 'brand' ? 'Brands' : 'Categories');
        trigger.querySelector('.trigger-text').textContent = text;
    }

    onStockStatusChange(val) {
        this.stockStatus = val;
        this._renderChips();
        this._updateBadge();
        this.onFilterChange(this.getFilters());
    }

    onLastCheckedChange(val) {
        this.lastChecked = val;
        this._renderChips();
        this._updateBadge();
        this.onFilterChange(this.getFilters());
    }

    getFilters() {
        return {
            brands: [...this.selectedBrands],
            categories: [...this.selectedCategories],
            stock_status: this.stockStatus,
            last_checked: this.lastChecked
        };
    }

    /** For server-side pages — returns URL params string pieces */
    getQueryParams() {
        const p = {};
        if (this.selectedBrands.size) p.brands = [...this.selectedBrands].join(',');
        if (this.selectedCategories.size) p.categories = [...this.selectedCategories].join(',');
        if (this.stockStatus) p.stock_status = this.stockStatus;
        return p;
    }

    /** For client-side page — returns a predicate function */
    getFilterPredicate() {
        const brands = this.selectedBrands;
        const cats = this.selectedCategories;
        const status = this.stockStatus;
        const lastChecked = this.lastChecked;

        return function(item) {
            if (brands.size && !brands.has(item.brand || '')) return false;
            if (cats.size && !cats.has(item.category || '')) return false;
            if (status) {
                const qty = parseFloat(item.stock_on_hand) || 0;
                if (status === 'out_of_stock' && qty > 0) return false;
                if (status === 'in_stock' && qty <= 0) return false;
                if (status === 'low_stock' && (qty <= 0 || qty > 5)) return false;
            }
            if (lastChecked) {
                const lc = item.last_checked ? new Date(item.last_checked).getTime() : 0;
                const now = Date.now();
                if (lastChecked === 'never' && lc > 0) return false;
                if (lastChecked === '7d' && (lc === 0 ? true : (now - lc) < 7 * 86400000)) {
                    if (lc !== 0) return false;
                }
                if (lastChecked === '30d' && (lc === 0 ? true : (now - lc) < 30 * 86400000)) {
                    if (lc !== 0) return false;
                }
            }
            return true;
        };
    }

    getActiveFilterCount() {
        let n = 0;
        if (this.selectedBrands.size) n++;
        if (this.selectedCategories.size) n++;
        if (this.stockStatus) n++;
        if (this.lastChecked) n++;
        return n;
    }

    togglePanel() {
        const panel = document.getElementById(this.containerId);
        if (!panel) return;
        this.isOpen = !this.isOpen;
        panel.classList.toggle('open', this.isOpen);
        const btn = document.getElementById(this.toggleBtnId);
        if (btn) btn.classList.toggle('has-filters-open', this.isOpen);
    }

    clearAll() {
        this.selectedBrands.clear();
        this.selectedCategories.clear();
        this.stockStatus = '';
        this.lastChecked = '';

        // Reset UI
        const ssEl = document.getElementById('sfStockStatus');
        if (ssEl) ssEl.value = '';
        const lcEl = document.getElementById('sfLastChecked');
        if (lcEl) lcEl.value = '';

        ['brand', 'category'].forEach(t => {
            this._updateTriggerText(t);
            const container = document.getElementById('sf_' + t + '_options');
            if (container) container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        });

        this._renderChips();
        this._updateBadge();
        this.onFilterChange(this.getFilters());
    }

    removeFilter(type, value) {
        if (type === 'brand') {
            this.selectedBrands.delete(value);
            this._uncheckOption('brand', value);
            this._updateTriggerText('brand');
        } else if (type === 'category') {
            this.selectedCategories.delete(value);
            this._uncheckOption('category', value);
            this._updateTriggerText('category');
        } else if (type === 'stock_status') {
            this.stockStatus = '';
            var el = document.getElementById('sfStockStatus');
            if (el) el.value = '';
        } else if (type === 'last_checked') {
            this.lastChecked = '';
            var el2 = document.getElementById('sfLastChecked');
            if (el2) el2.value = '';
        }
        this._renderChips();
        this._updateBadge();
        this.onFilterChange(this.getFilters());
    }

    _uncheckOption(type, value) {
        const container = document.getElementById('sf_' + type + '_options');
        if (!container) return;
        container.querySelectorAll('.multi-select-option').forEach(el => {
            if (el.getAttribute('data-value') === value) {
                el.querySelector('input').checked = false;
            }
        });
    }

    _renderChips() {
        const el = document.getElementById(this.chipsContainerId);
        if (!el) return;
        let html = '';

        this.selectedBrands.forEach(b => {
            html += '<span class="filter-chip">Brand: ' + this._esc(b) + '<button class="chip-remove" onclick="window._sfm.removeFilter(\'brand\',\'' + this._esc(b).replace(/'/g, "\\'") + '\')">&times;</button></span>';
        });
        this.selectedCategories.forEach(c => {
            html += '<span class="filter-chip">Category: ' + this._esc(c) + '<button class="chip-remove" onclick="window._sfm.removeFilter(\'category\',\'' + this._esc(c).replace(/'/g, "\\'") + '\')">&times;</button></span>';
        });
        if (this.stockStatus) {
            const labels = { in_stock: 'In Stock', low_stock: 'Low Stock', out_of_stock: 'Out of Stock' };
            html += '<span class="filter-chip">' + (labels[this.stockStatus] || this.stockStatus) + '<button class="chip-remove" onclick="window._sfm.removeFilter(\'stock_status\',\'\')">&times;</button></span>';
        }
        if (this.lastChecked) {
            const labels = { never: 'Never Checked', '7d': '7+ Days Ago', '30d': '30+ Days Ago' };
            html += '<span class="filter-chip">' + (labels[this.lastChecked] || this.lastChecked) + '<button class="chip-remove" onclick="window._sfm.removeFilter(\'last_checked\',\'\')">&times;</button></span>';
        }
        if (this.getActiveFilterCount() > 1) {
            html += '<button class="chip-clear-all" onclick="window._sfm.clearAll()">Clear All</button>';
        }
        el.innerHTML = html;
    }

    _updateBadge() {
        const count = this.getActiveFilterCount();
        const badge = document.getElementById(this.badgeId);
        const btn = document.getElementById(this.toggleBtnId);
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        if (btn) btn.classList.toggle('has-filters', count > 0);
    }

    _bindOutsideClick() {
        document.addEventListener('click', (e) => {
            if (!this._openDropdown) return;
            const wrap = document.getElementById('sf_' + this._openDropdown + '_wrap');
            if (wrap && !wrap.contains(e.target)) {
                this._closeAllDropdowns();
            }
        });
    }

    _esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

/**
 * ColumnSort — adds sort dropdowns to table column headers.
 *
 * Usage:
 *   const colSort = new ColumnSort({
 *       tableId: 'myTable',
 *       currentSort: 'name_asc',
 *       onSort: function(key) { ... }
 *   });
 *
 * Table headers need: <th class="col-sortable" data-sort-asc="name_asc" data-sort-desc="name_desc">Name</th>
 */
class ColumnSort {
    constructor(opts) {
        this.tableId = opts.tableId;
        this.currentSort = opts.currentSort || '';
        this.onSort = opts.onSort || function(){};
        this._openTh = null;
        this._init();
    }

    _init() {
        const table = document.getElementById(this.tableId);
        if (!table) return;
        this._dropdowns = [];

        // Build dropdowns for each sortable th
        table.querySelectorAll('th.col-sortable').forEach(th => {
            const ascKey = th.dataset.sortAsc;
            const descKey = th.dataset.sortDesc;
            if (!ascKey && !descKey) return;

            // Add sort icon
            const icon = document.createElement('span');
            icon.className = 'col-sort-icon';
            icon.innerHTML = '&#9650;&#9660;';
            th.appendChild(icon);

            // Build dropdown — appended to body to avoid overflow clipping
            const dd = document.createElement('div');
            dd.className = 'col-dropdown';

            const ascLabel = th.dataset.sortAscLabel || 'Sort A → Z';
            const descLabel = th.dataset.sortDescLabel || 'Sort Z → A';

            if (ascKey) {
                const optAsc = document.createElement('div');
                optAsc.className = 'col-sort-opt';
                optAsc.dataset.sort = ascKey;
                optAsc.innerHTML = '<span class="sort-arrow">&#9650;</span> ' + ascLabel;
                optAsc.addEventListener('click', (e) => { e.stopPropagation(); this._apply(ascKey); });
                dd.appendChild(optAsc);
            }
            if (descKey) {
                const optDesc = document.createElement('div');
                optDesc.className = 'col-sort-opt';
                optDesc.dataset.sort = descKey;
                optDesc.innerHTML = '<span class="sort-arrow">&#9660;</span> ' + descLabel;
                optDesc.addEventListener('click', (e) => { e.stopPropagation(); this._apply(descKey); });
                dd.appendChild(optDesc);
            }

            document.body.appendChild(dd);
            this._dropdowns.push({ th, dd, ascKey, descKey });

            // Click header to toggle dropdown
            th.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._openTh === th) {
                    this._closeAll();
                } else {
                    this._closeAll();
                    // Position dropdown below the th
                    const rect = th.getBoundingClientRect();
                    dd.style.position = 'fixed';
                    dd.style.top = rect.bottom + 2 + 'px';
                    // Align left for left-aligned, right for right-aligned columns
                    if (th.classList.contains('text-right')) {
                        dd.style.left = 'auto';
                        dd.style.right = (window.innerWidth - rect.right) + 'px';
                    } else {
                        dd.style.left = rect.left + 'px';
                        dd.style.right = 'auto';
                    }
                    dd.classList.add('show');
                    this._openTh = th;
                }
            });
        });

        // Outside click closes
        document.addEventListener('click', () => this._closeAll());

        // Mark initial active
        this._updateActive();
    }

    _apply(sortKey) {
        this.currentSort = sortKey;
        this._closeAll();
        this._updateActive();
        this.onSort(sortKey);
    }

    _closeAll() {
        if (!this._dropdowns) return;
        this._dropdowns.forEach(({ dd }) => dd.classList.remove('show'));
        this._openTh = null;
    }

    _updateActive() {
        if (!this._dropdowns) return;

        this._dropdowns.forEach(({ th, dd, ascKey, descKey }) => {
            const isActive = (this.currentSort === ascKey || this.currentSort === descKey);
            th.classList.toggle('sort-active', isActive);

            // Update icon to show current direction
            const icon = th.querySelector('.col-sort-icon');
            if (icon) {
                if (this.currentSort === ascKey) icon.innerHTML = '&#9650;';
                else if (this.currentSort === descKey) icon.innerHTML = '&#9660;';
                else icon.innerHTML = '&#9650;&#9660;';
            }

            // Mark active option in dropdown
            dd.querySelectorAll('.col-sort-opt').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.sort === this.currentSort);
            });
        });
    }

    setSort(sortKey) {
        this.currentSort = sortKey;
        this._updateActive();
    }
}
