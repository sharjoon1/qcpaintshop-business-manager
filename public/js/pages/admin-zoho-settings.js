// admin-zoho-settings page logic — externalized from admin-zoho-settings.html (S9+F5 strict CSP).
// Verbatim move of the page's inline <script>; no logic changes. Runtime-injected on*=
// handlers inside the innerHTML template strings (openMappingDropdown / filterLocalCustomers /
// mapCustomer) were converted to data-action + data-* attributes dispatched by a single
// delegated document-level listener appended at the bottom. Static onclick handlers in the
// HTML were converted to addEventListener wiring at the bottom. escapeHtml usage unchanged.
(function () {
    // ========================
    // Toast Notification
    // ========================
    function showToast(message, type) {
        var toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast toast-' + (type || 'info');
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 3500);
    }

    // ========================
    // API Helper
    // ========================
    async function zohoFetch(url, options) {
        try { return await apiRequest(url, options); }
        catch (err) { showToast(err.message || 'Network error', 'error'); return null; }
    }

    // ========================
    // 1. Connection Status
    // ========================
    async function loadConnectionStatus() {
        const loadingEl = document.getElementById('connectionLoading');
        const contentEl = document.getElementById('connectionContent');
        const connectedEl = document.getElementById('connectedState');
        const disconnectedEl = document.getElementById('disconnectedState');

        loadingEl.classList.remove('hidden');
        contentEl.classList.add('hidden');

        const response = await zohoFetch('/api/zoho/status');
        if (!response) {
            loadingEl.innerHTML = '<span class="text-red-500">Failed to load connection status</span>';
            return;
        }

        const result = await response.json();
        const connection = result.data?.connection || result.connection || {};
        loadingEl.classList.add('hidden');
        contentEl.classList.remove('hidden');

        if (connection.connected) {
            connectedEl.classList.remove('hidden');
            disconnectedEl.classList.add('hidden');
            const mins = connection.expires_in_minutes;
            document.getElementById('tokenExpiry').textContent =
                mins != null ? `Token expires in ${mins} minutes` : `Status: ${connection.status || 'connected'}`;
        } else {
            connectedEl.classList.add('hidden');
            disconnectedEl.classList.remove('hidden');
        }
    }

    async function connectZoho() {
        const response = await zohoFetch('/api/zoho/oauth/url');
        if (!response) return;
        const data = await response.json();
        const authUrl = data.authorization_url || (data.data && data.data.authorization_url);
        if (authUrl) {
            window.open(authUrl, '_blank');
            // Show the manual code entry section
            const manualSection = document.getElementById('manualCodeSection');
            if (manualSection) manualSection.classList.remove('hidden');
            showToast('Zoho authorization page opened. After authorizing, paste the code below.', 'info');
        } else {
            showToast(data.message || 'Failed to get authorization URL', 'error');
        }
    }

    async function exchangeManualCode() {
        const input = document.getElementById('manualAuthCode');
        const btn = document.getElementById('btnExchangeCode');
        let codeValue = input.value.trim();

        if (!codeValue) {
            showToast('Please paste the authorization code or callback URL', 'error');
            return;
        }

        // Extract code from full URL if user pasted the entire callback URL
        try {
            if (codeValue.includes('code=')) {
                const url = new URL(codeValue);
                codeValue = url.searchParams.get('code') || codeValue;
            }
        } catch (e) {
            // If URL parsing fails, check for code= in a simpler way
            const match = codeValue.match(/code=([^&]+)/);
            if (match) codeValue = match[1];
        }

        btn.disabled = true;
        btn.textContent = 'Exchanging...';
        showToast('Sending code to server...', 'info');

        try {
            const token = localStorage.getItem('auth_token');
            const response = await fetch('/api/zoho/oauth/exchange', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code: codeValue })
            });

            btn.disabled = false;
            btn.textContent = 'Exchange Code';

            const data = await response.json();
            console.log('Exchange response:', response.status, data);

            if (response.ok && data.success) {
                showToast('Zoho Books connected successfully!', 'success');
                document.getElementById('manualCodeSection').classList.add('hidden');
                input.value = '';
                loadConnectionStatus();
            } else {
                const errMsg = data.message || 'Failed to exchange code';
                if (errMsg.includes('invalid_code')) {
                    showToast('Code expired! Click "Connect" again, authorize, then paste the URL immediately (within 1-2 minutes).', 'error');
                } else {
                    showToast('Error: ' + errMsg, 'error');
                }
            }
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Exchange Code';
            console.error('Exchange fetch error:', err);
            showToast('Network error: ' + err.message, 'error');
        }
    }

    async function disconnectZoho() {
        if (!confirm('Are you sure you want to disconnect from Zoho Books? This will stop all syncing.')) return;

        const response = await zohoFetch('/api/zoho/oauth/disconnect', { method: 'POST' });
        if (!response) return;
        const result = await response.json();

        if (response.ok && result.success) {
            showToast('Disconnected from Zoho Books', 'success');
            loadConnectionStatus();
        } else {
            showToast(result.message || 'Failed to disconnect', 'error');
        }
    }

    // ========================
    // 2. Sync Configuration
    // ========================
    async function loadSyncConfig() {
        const response = await zohoFetch('/api/zoho/config');
        if (!response) return;
        const result = await response.json();
        const configs = result.data || result.configs || [];

        if (Array.isArray(configs)) {
            configs.forEach(c => {
                const key = c.config_key || c.key;
                const val = c.config_value || c.value;
                switch (key) {
                    case 'sync_enabled':
                        document.getElementById('syncEnabled').checked = val === 'true' || val === true;
                        break;
                    case 'sync_interval_minutes':
                        document.getElementById('syncInterval').value = val || '60';
                        break;
                }
            });
        }
    }

    async function saveSyncSettings() {
        const btn = document.getElementById('btnSaveSyncSettings');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const configs = [
            { key: 'sync_enabled', value: String(document.getElementById('syncEnabled').checked) },
            { key: 'sync_interval_minutes', value: document.getElementById('syncInterval').value }
        ];

        const response = await zohoFetch('/api/zoho/config', {
            method: 'PUT',
            body: JSON.stringify({ configs })
        });

        btn.disabled = false;
        btn.textContent = 'Save Sync Settings';

        if (!response) return;
        const result = await response.json();

        if (response.ok && result.success) {
            showToast('Sync settings saved successfully', 'success');
        } else {
            showToast(result.message || 'Failed to save sync settings', 'error');
        }
    }

    // ========================
    // 3. Manual Sync Actions
    // ========================
    async function triggerSync(type) {
        const btn = document.getElementById(`btn-sync-${type}`);
        const spinner = document.getElementById(`spinner-sync-${type}`);

        btn.disabled = true;
        spinner.classList.remove('hidden');

        const urlMap = {
            full: '/api/zoho/sync/full',
            customers: '/api/zoho/sync/customers',
            invoices: '/api/zoho/sync/invoices',
            payments: '/api/zoho/sync/payments'
        };

        const response = await zohoFetch(urlMap[type], { method: 'POST' });

        btn.disabled = false;
        spinner.classList.add('hidden');

        if (!response) return;
        const result = await response.json();

        if (response.ok && result.success) {
            const label = type.charAt(0).toUpperCase() + type.slice(1);
            showToast(`${label} sync initiated successfully`, 'success');
            loadSyncLog();
        } else {
            showToast(result.message || `Failed to trigger ${type} sync`, 'error');
        }
    }

    // ========================
    // 4. WhatsApp Configuration
    // ========================
    async function loadWhatsAppConfig() {
        const response = await zohoFetch('/api/zoho/config');
        if (!response) return;
        const result = await response.json();
        const configs = result.data || result.configs || [];

        if (Array.isArray(configs)) {
            configs.forEach(c => {
                const key = c.config_key || c.key;
                const val = c.config_value || c.value || '';
                switch (key) {
                    case 'whatsapp_enabled':
                        document.getElementById('whatsappEnabled').checked = val === 'true' || val === true;
                        break;
                    case 'whatsapp_api_url':
                        document.getElementById('whatsappApiUrl').value = val;
                        break;
                    case 'whatsapp_api_key':
                        document.getElementById('whatsappApiKey').placeholder = c.is_set ? '••••••••' : 'Enter API key';
                        break;
                    case 'overdue_reminder_days':
                        document.getElementById('overdueReminderDays').value = val;
                        break;
                }
            });
        }
    }

    async function saveWhatsAppSettings() {
        const btn = document.getElementById('btnSaveWhatsApp');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const configs = [
            { key: 'whatsapp_enabled', value: String(document.getElementById('whatsappEnabled').checked) },
            { key: 'whatsapp_api_url', value: document.getElementById('whatsappApiUrl').value.trim() },
            { key: 'whatsapp_api_key', value: document.getElementById('whatsappApiKey').value.trim() },
            { key: 'overdue_reminder_days', value: document.getElementById('overdueReminderDays').value.trim() }
        ];

        const response = await zohoFetch('/api/zoho/config', {
            method: 'PUT',
            body: JSON.stringify({ configs })
        });

        btn.disabled = false;
        btn.textContent = 'Save WhatsApp Settings';

        if (!response) return;
        const result = await response.json();

        if (response.ok && result.success) {
            showToast('WhatsApp settings saved successfully', 'success');
        } else {
            showToast(result.message || 'Failed to save WhatsApp settings', 'error');
        }
    }

    // ========================
    // 5. Customer Mapping
    // ========================
    let localCustomersCache = [];

    async function loadUnmappedCustomers() {
        const body = document.getElementById('mappingBody');
        body.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-gray-400">Loading unmapped customers...</td></tr>';

        const response = await zohoFetch('/api/zoho/customers?mapped=false&limit=10');
        if (!response) {
            body.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-red-400">Failed to load customers</td></tr>';
            return;
        }

        const result = await response.json();
        const customers = result.data || result.customers || [];
        const mapped = result.mapped_count || result.pagination?.total || 0;
        const unmapped = result.unmapped_count || customers.length || 0;

        document.getElementById('mappingStats').textContent = `Mapped: ${mapped} | Unmapped: ${unmapped}`;

        if (customers.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-gray-400">All customers are mapped</td></tr>';
            return;
        }

        body.innerHTML = customers.map(c => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-3 px-3 font-medium text-gray-800">${escapeHtml(c.zoho_contact_name || c.contact_name || c.name || '--')}</td>
                <td class="py-3 px-3 text-gray-600 hidden sm:table-cell">${escapeHtml(c.zoho_phone || c.phone || '--')}</td>
                <td class="py-3 px-3 text-gray-600 hidden md:table-cell">${escapeHtml(c.zoho_email || c.email || '--')}</td>
                <td class="py-3 px-3 text-right">
                    <div class="relative inline-block">
                        <button data-action="open-mapping-dropdown" data-id="${escapeHtml(c.id)}" class="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-semibold text-xs transition">
                            Map to Local
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async function openMappingDropdown(btn, zohoCustomerId) {
        // Close any existing dropdowns
        document.querySelectorAll('.mapping-dropdown').forEach(d => d.remove());

        const dropdown = document.createElement('div');
        dropdown.className = 'mapping-dropdown';
        dropdown.innerHTML = `
            <div class="p-2 border-b border-gray-100">
                <input type="text" placeholder="Search local customers..."
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    data-action="filter-local-customers" data-id="${escapeHtml(zohoCustomerId)}">
            </div>
            <div class="py-1 customer-list" id="customerList-${escapeHtml(zohoCustomerId)}">
                <div class="px-3 py-2 text-sm text-gray-400">Loading...</div>
            </div>
        `;

        btn.parentElement.appendChild(dropdown);

        // Load local customers if not cached
        if (localCustomersCache.length === 0) {
            const response = await zohoFetch('/api/customers?limit=100');
            if (response) {
                const data = await response.json();
                localCustomersCache = data.customers || data.data || [];
            }
        }

        renderLocalCustomers(zohoCustomerId, localCustomersCache);

        // Close dropdown on outside click
        setTimeout(() => {
            document.addEventListener('click', function closeDropdown(e) {
                if (!dropdown.contains(e.target) && e.target !== btn) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            });
        }, 100);
    }

    function renderLocalCustomers(zohoCustomerId, customers) {
        const listEl = document.getElementById(`customerList-${zohoCustomerId}`);
        if (!listEl) return;

        if (customers.length === 0) {
            listEl.innerHTML = '<div class="px-3 py-2 text-sm text-gray-400">No customers found</div>';
            return;
        }

        listEl.innerHTML = customers.slice(0, 20).map(c => `
            <button data-action="map-customer" data-zoho-id="${escapeHtml(zohoCustomerId)}" data-local-id="${escapeHtml(c.id)}"
                class="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 hover:text-purple-700 transition flex flex-col">
                <span class="font-medium">${escapeHtml(c.name || c.customer_name || '--')}</span>
                <span class="text-xs text-gray-400">${escapeHtml(c.phone || c.email || '')}</span>
            </button>
        `).join('');
    }

    function filterLocalCustomers(input, zohoCustomerId) {
        const query = input.value.toLowerCase().trim();
        const filtered = localCustomersCache.filter(c => {
            const name = (c.name || c.customer_name || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const email = (c.email || '').toLowerCase();
            return name.includes(query) || phone.includes(query) || email.includes(query);
        });
        renderLocalCustomers(zohoCustomerId, filtered);
    }

    async function mapCustomer(zohoCustomerId, localCustomerId) {
        // Close dropdown
        document.querySelectorAll('.mapping-dropdown').forEach(d => d.remove());

        const response = await zohoFetch(`/api/zoho/customers/${zohoCustomerId}/map`, {
            method: 'PUT',
            body: JSON.stringify({ local_customer_id: localCustomerId })
        });

        if (!response) return;
        const result = await response.json();

        if (response.ok && result.success) {
            showToast('Customer mapped successfully', 'success');
            loadUnmappedCustomers();
        } else {
            showToast(result.message || 'Failed to map customer', 'error');
        }
    }

    // ========================
    // 6. Sync History Log
    // ========================
    let syncLogRefreshInterval = null;

    async function loadSyncLog() {
        const body = document.getElementById('syncLogBody');

        const response = await zohoFetch('/api/zoho/sync/log?limit=20');
        if (!response) {
            body.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-red-400">Failed to load sync history</td></tr>';
            return;
        }

        const result = await response.json();
        const logs = result.data || result.logs || [];

        if (logs.length === 0) {
            body.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-gray-400">No sync history yet</td></tr>';
            clearAutoRefresh();
            return;
        }

        let hasActiveSync = false;

        body.innerHTML = logs.map(log => {
            const status = (log.status || '').toLowerCase();
            if (status === 'started' || status === 'in_progress') hasActiveSync = true;

            let badgeClass = 'badge-blue';
            if (status === 'completed') badgeClass = 'badge-green';
            else if (status === 'failed') badgeClass = 'badge-red';
            else if (status === 'in_progress') badgeClass = 'badge-yellow';

            return `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="py-3 px-3 font-medium text-gray-800 capitalize">${escapeHtml(log.sync_type || log.type || '--')}</td>
                    <td class="py-3 px-3"><span class="badge ${badgeClass}">${escapeHtml(log.status || '--')}</span></td>
                    <td class="py-3 px-3 text-gray-600 hidden sm:table-cell">${log.records_synced != null ? log.records_synced : (log.records || '--')}</td>
                    <td class="py-3 px-3 text-gray-600 hidden md:table-cell">${escapeHtml(log.triggered_by || '--')}</td>
                    <td class="py-3 px-3 text-gray-500 text-xs hidden lg:table-cell">${formatDateTime(log.started_at || log.created_at)}</td>
                    <td class="py-3 px-3 text-gray-500 text-xs hidden lg:table-cell">${formatDateTime(log.completed_at)}</td>
                </tr>
            `;
        }).join('');

        // Auto-refresh if there are active syncs
        if (hasActiveSync) {
            startAutoRefresh();
        } else {
            clearAutoRefresh();
        }
    }

    function startAutoRefresh() {
        if (syncLogRefreshInterval) return;
        syncLogRefreshInterval = setInterval(() => {
            loadSyncLog();
        }, 10000);
    }

    function clearAutoRefresh() {
        if (syncLogRefreshInterval) {
            clearInterval(syncLogRefreshInterval);
            syncLogRefreshInterval = null;
        }
    }

    // ========================
    // Utility Functions
    // ========================
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '--';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '--';
            return d.toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            });
        } catch {
            return '--';
        }
    }

    // ========================
    // Initialize
    // ========================
    document.addEventListener('DOMContentLoaded', function() {
        loadConnectionStatus();
        loadSyncConfig();
        loadWhatsAppConfig();
        loadUnmappedCustomers();
        loadSyncLog();
    });

    // Cleanup on page leave
    window.addEventListener('beforeunload', function() {
        clearAutoRefresh();
    });

    // ========================
    // Static handler wiring (converted from inline on*= attributes in the HTML)
    // ========================
    // "Disconnect" (was onclick="disconnectZoho()")
    var btnDisconnect = document.getElementById('btnDisconnectZoho');
    if (btnDisconnect) btnDisconnect.addEventListener('click', disconnectZoho);
    // "Connect to Zoho Books" (was onclick="connectZoho()")
    var btnConnect = document.getElementById('btnConnectZoho');
    if (btnConnect) btnConnect.addEventListener('click', connectZoho);
    // "Exchange Code" (was onclick="exchangeManualCode()")
    var btnExchangeCode = document.getElementById('btnExchangeCode');
    if (btnExchangeCode) btnExchangeCode.addEventListener('click', exchangeManualCode);
    // "Save Sync Settings" (was onclick="saveSyncSettings()")
    var btnSaveSyncSettings = document.getElementById('btnSaveSyncSettings');
    if (btnSaveSyncSettings) btnSaveSyncSettings.addEventListener('click', saveSyncSettings);
    // Manual sync buttons (were onclick="triggerSync('full'|'customers'|'invoices'|'payments')")
    ['full', 'customers', 'invoices', 'payments'].forEach(function (type) {
        var btn = document.getElementById('btn-sync-' + type);
        if (btn) btn.addEventListener('click', function () { triggerSync(type); });
    });
    // "Save WhatsApp Settings" (was onclick="saveWhatsAppSettings()")
    var btnSaveWhatsApp = document.getElementById('btnSaveWhatsApp');
    if (btnSaveWhatsApp) btnSaveWhatsApp.addEventListener('click', saveWhatsAppSettings);
    // "Refresh" unmapped customers (was onclick="loadUnmappedCustomers()")
    var btnRefresh = document.getElementById('btnRefreshUnmapped');
    if (btnRefresh) btnRefresh.addEventListener('click', loadUnmappedCustomers);

    // ========================
    // Delegated listeners for runtime-injected data-action elements
    // (replaces former inline on*= handlers inside innerHTML template strings)
    // ========================
    // Click: openMappingDropdown / mapCustomer
    document.addEventListener('click', function (ev) {
        var t = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
        if (!t) return;
        var action = t.getAttribute('data-action');
        if (action === 'open-mapping-dropdown') {
            // Original handler received the clicked button element as `this`.
            openMappingDropdown(t, t.getAttribute('data-id'));
        } else if (action === 'map-customer') {
            mapCustomer(t.getAttribute('data-zoho-id'), t.getAttribute('data-local-id'));
        }
    });
    // Input: filterLocalCustomers
    document.addEventListener('input', function (ev) {
        var t = ev.target instanceof Element ? ev.target.closest('[data-action="filter-local-customers"]') : null;
        if (!t) return;
        filterLocalCustomers(t, t.getAttribute('data-id'));
    });
})();
