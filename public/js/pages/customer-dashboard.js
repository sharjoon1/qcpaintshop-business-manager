// FIX-8: Simplified auth check — token presence is the single source of truth
if (!localStorage.getItem('customer_token')) { window.location.href = '/customer-login.html'; }

        const API_BASE = '/api';
        let customerPhone = null;

        document.addEventListener('DOMContentLoaded', function() {
            loadCustomerInfo();
            loadStats();
            loadRecentRequests();
            loadRecentInvoices();

            // Profile dropdown
            document.getElementById('profileBtn').addEventListener('click', function() {
                document.getElementById('profileDropdown').classList.toggle('hidden');
            });

            // Auto-refresh every 2 minutes
            setInterval(() => {
                loadStats();
                loadRecentRequests();
                loadRecentInvoices();
            }, 120000);
        });

        function loadCustomerInfo() {
            // TODO: Get from session/localStorage after login
            // For now, use stored phone or prompt
            customerPhone = localStorage.getItem('customer_phone') || '7418831122';
            const customerName = localStorage.getItem('customer_name') || 'Customer';

            document.getElementById('customerName').textContent = customerName;
            document.getElementById('welcomeName').textContent = customerName;
            document.getElementById('profileInitial').textContent = customerName.charAt(0).toUpperCase();
        }

        function customerHeaders() {
            const token = localStorage.getItem('customer_token') || '';
            return { 'Authorization': 'Bearer ' + token };
        }

        function handleAuthFailure(response) {
            if (response.status === 401) {
                ['customer_token', 'customer_phone', 'customer_name', 'customer_id']
                    .forEach(k => localStorage.removeItem(k));
                window.location.href = '/customer-login.html';
                return true;
            }
            return false;
        }

        async function loadStats() {
            try {
                const response = await fetch(`${API_BASE}/customer/me/requests?limit=100`, { headers: customerHeaders() });
                if (handleAuthFailure(response)) return;
                const result = await response.json();
                if (result.success) {
                    const requests = result.data || [];
                    document.getElementById('statTotal').textContent = requests.length;
                    document.getElementById('statPending').textContent = requests.filter(r => r.status === 'new' || r.status === 'contacted').length;
                    document.getElementById('statQuotes').textContent = requests.filter(r => r.status === 'quote_sent').length;
                    document.getElementById('statAccepted').textContent = requests.filter(r => r.status === 'accepted').length;
                }
            } catch (error) {
                console.error('Load stats error:', error);
            }
        }

        async function loadRecentRequests() {
            // FIX-9: Use estimateList div for responsive card rendering
            const container = document.getElementById('estimateList');

            try {
                if (!customerPhone) {
                    container.innerHTML = `
                        <div class="text-center py-8">
                            <p class="text-gray-600 mb-4">Please login to view your requests</p>
                            <a href="login.html" class="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700">
                                Login
                            </a>
                        </div>
                    `;
                    return;
                }

                const response = await fetch(`${API_BASE}/customer/me/requests?limit=5`, { headers: customerHeaders() });
                if (handleAuthFailure(response)) return;
                const result = await response.json();

                if (!result.success || result.data.length === 0) {
                    container.innerHTML = `
                        <div class="text-center py-8 text-gray-400">
                            <div class="text-4xl mb-2">📭</div>
                            <p class="mb-4">No requests yet</p>
                            <a href="request-estimate.html" class="inline-block bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700">
                                Submit Your First Request
                            </a>
                        </div>
                    `;
                    return;
                }

                // FIX-9: Responsive card layout — no table, works on mobile
                container.innerHTML = result.data.map(request => `
                    <div class="bg-white rounded-xl p-4 border border-gray-100 flex justify-between items-center cursor-pointer hover:shadow-sm transition" data-action="view-request" data-request-number="${esc(request.request_number)}">
                        <div>
                            <p class="font-semibold text-gray-800">#${esc(request.request_number)}</p>
                            <p class="text-sm text-gray-500">${esc(formatTimeAgo(request.created_at))} · ${esc(formatProjectType(request.project_type))}</p>
                        </div>
                        <div class="text-right">
                            <span class="status-badge status-${esc(request.status)} px-2 py-0.5 rounded-full text-xs font-semibold">${esc(formatStatus(request.status))}</span>
                            <p class="font-bold text-gray-800 mt-1">${fmtINR(request.estimate_amount || request.total_amount || request.amount || 0)}</p>
                        </div>
                    </div>
                `).join('');

            } catch (error) {
                console.error('Load requests error:', error);
                container.innerHTML = `
                    <div class="text-center py-8 text-red-600">
                        <p>Failed to load requests</p>
                    </div>
                `;
            }
        }

        function viewRequest(requestNumber) {
            window.location = `customer-requests.html?request=${requestNumber}`;
        }

        function esc(s) {
            return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        }

        function fmtINR(n) {
            const x = Number(n || 0);
            return '₹' + x.toLocaleString('en-IN', { maximumFractionDigits: 0 });
        }

        function fmtInvoiceDate(d) {
            if (!d) return '';
            try {
                return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            } catch (_) { return d; }
        }

        function invoiceStatusBadge(status) {
            const map = {
                paid: ['bg-green-100', 'text-green-700', 'Paid'],
                sent: ['bg-blue-100', 'text-blue-700', 'Sent'],
                overdue: ['bg-red-100', 'text-red-700', 'Overdue'],
                partially_paid: ['bg-yellow-100', 'text-yellow-700', 'Partial'],
                draft: ['bg-gray-100', 'text-gray-700', 'Draft'],
                void: ['bg-gray-100', 'text-gray-500', 'Void'],
            };
            const [bg, fg, label] = map[status] || ['bg-gray-100', 'text-gray-700', status || '—'];
            return `<span class="${bg} ${fg} px-2.5 py-1 rounded-full text-xs font-semibold">${esc(label)}</span>`;
        }

        async function loadRecentInvoices() {
            const container = document.getElementById('recentInvoicesContainer');
            try {
                if (!customerPhone) {
                    container.innerHTML = `<div class="text-center py-6 text-gray-400">Login to view invoices</div>`;
                    return;
                }
                const response = await fetch(`${API_BASE}/customer/me/invoices?limit=10`, { headers: customerHeaders() });
                if (handleAuthFailure(response)) return;
                const result = await response.json();
                const list = result.data || [];

                if (!result.success || list.length === 0) {
                    container.innerHTML = `
                        <div class="text-center py-8 text-gray-400">
                            <div class="text-4xl mb-2">🧾</div>
                            <p>No invoices yet</p>
                            <p class="text-xs mt-1">Your past Zoho invoices will appear here once posted.</p>
                        </div>
                    `;
                    return;
                }

                container.innerHTML = list.map(inv => `
                    <div class="border-b last:border-b-0 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div class="min-w-0 flex-1">
                            <div class="font-semibold text-gray-800 truncate">${esc(inv.invoice_number || '—')}</div>
                            <div class="text-xs text-gray-500">${fmtInvoiceDate(inv.invoice_date)}</div>
                        </div>
                        <div class="text-right">
                            <div class="font-semibold text-gray-800">${fmtINR(inv.total)}</div>
                            <div class="text-xs ${Number(inv.balance) > 0 ? 'text-red-600' : 'text-gray-500'}">
                                ${Number(inv.balance) > 0 ? 'Balance ' + fmtINR(inv.balance) : 'Settled'}
                            </div>
                        </div>
                        <div class="basis-full sm:basis-auto text-right sm:text-left">${invoiceStatusBadge(inv.status)}</div>
                    </div>
                `).join('');
            } catch (error) {
                console.error('Load invoices error:', error);
                container.innerHTML = `<div class="text-center py-6 text-red-600 text-sm">Failed to load invoices</div>`;
            }
        }

        function formatStatus(status) {
            const map = {
                'new': 'New',
                'contacted': 'Under Review',
                'quote_sent': 'Quote Sent',
                'accepted': 'Accepted',
                'rejected': 'Declined',
                'completed': 'Completed'
            };
            return map[status] || status;
        }

        function formatProjectType(type) {
            const map = {
                'interior': 'Interior Painting',
                'exterior': 'Exterior Painting',
                'both': 'Interior & Exterior',
                'commercial': 'Commercial Project',
                'renovation': 'Renovation',
                'new_construction': 'New Construction'
            };
            return map[type] || type;
        }

        function formatTimeAgo(dateStr) {
            const date = new Date(dateStr);
            const now = new Date();
            const diff = now - date;
            const hours = Math.floor(diff / 3600000);

            if (hours < 1) return 'Just now';
            if (hours < 24) return `${hours} hours ago`;
            const days = Math.floor(hours / 24);
            if (days === 1) return 'Yesterday';
            if (days < 7) return `${days} days ago`;
            return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        }

    function customerLogout() {
        localStorage.removeItem('customer_phone');
        localStorage.removeItem('customer_name');
        localStorage.removeItem('customer_token');
        localStorage.removeItem('customer_id');
        window.location.href = '/customer-login.html';
    }

        // --- Wiring (replaces former inline on*= handlers) ---
        // Static: profile dropdown logout link (was onclick="customerLogout()")
        document.addEventListener('DOMContentLoaded', function() {
            var logoutLink = document.getElementById('customerLogoutLink');
            if (logoutLink) {
                logoutLink.addEventListener('click', function(e) {
                    e.preventDefault();
                    customerLogout();
                });
            }

            // Runtime: delegated click for estimate cards (was onclick="viewRequest('${...}')")
            // Args are read via el.dataset (auto-unescaped by the browser).
            document.addEventListener('click', function(e) {
                var el = e.target.closest('[data-action="view-request"]');
                if (!el) return;
                var requestNumber = el.dataset.requestNumber;
                if (typeof requestNumber === 'string') {
                    viewRequest(requestNumber);
                }
            });
        });
