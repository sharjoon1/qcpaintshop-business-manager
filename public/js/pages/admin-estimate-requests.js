// Page logic externalized from admin-estimate-requests.html (S9+F5 Phase C, 2026-06-25).
// Verbatim move of the original inline <script> body, plus CSP-clean handler wiring:
//  - static on*= handlers (View Public Form, status filter cards, Apply Filters, modal close)
//    converted to addEventListener (select by id; cards use a delegated listener).
//  - runtime-injected on*= handlers inside template literals converted to data-action + data-*
//    attributes and dispatched by a single delegated document-level listener.
// No business-logic or escaping changes.

        function esc(s){ if(s===null||s===undefined) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }
        // PAGE-174: tolerate malformed/empty products_json so a bad row can't break the whole detail render.
        function safeItems(j){ try { const p = JSON.parse(j); return (p && Array.isArray(p.items)) ? p.items : []; } catch(e){ return []; } }

        const API_BASE = '/api';
        let currentRequest = null;

        function getAuthHeaders() {
            const token = localStorage.getItem('auth_token');
            if (!token) {
                window.location.href = '/login.html';
                return {};
            }
            return {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
        }

        // Load stats
        async function loadStats() {
            try {
                const response = await fetch(`${API_BASE}/estimate-requests/stats/summary`, { headers: getAuthHeaders() });
                const result = await response.json();
                if (result.success) {
                    const stats = result.data;
                    // Top stat cards
                    document.getElementById('statTotal').textContent = stats.total || 0;
                    document.getElementById('statNew').textContent = stats.new_requests || 0;
                    document.getElementById('statQuotes').textContent = stats.quotes_sent || 0;
                    document.getElementById('stat24h').textContent = stats.last_24h || 0;

                    // Status filter cards
                    document.getElementById('cardAll').textContent = stats.total || 0;
                    document.getElementById('cardNew').textContent = stats.by_status?.new || 0;
                    document.getElementById('cardContacted').textContent = stats.by_status?.contacted || 0;
                    document.getElementById('cardQuoteSent').textContent = stats.by_status?.quote_sent || 0;
                    document.getElementById('cardAccepted').textContent = stats.by_status?.accepted || 0;
                    document.getElementById('cardRejected').textContent = stats.by_status?.rejected || 0;
                    document.getElementById('cardCompleted').textContent = stats.by_status?.completed || 0;
                }
            } catch (error) {
                console.error('Load stats error:', error);
            }
        }

        // Filter by status via cards. cardEl is the clicked status-filter-card element
        // (passed by the delegated listener); preserves the original event.target.closest() behavior.
        function filterByStatus(status, cardEl) {
            // Update dropdown
            document.getElementById('filterStatus').value = status;

            // Update active card styling
            document.querySelectorAll('.status-filter-card').forEach(card => {
                card.classList.remove('active', 'border-purple-500', 'border-2');
                card.classList.add('border-transparent', 'border-2');
            });

            // Highlight selected card
            cardEl.classList.add('active', 'border-purple-500');
            cardEl.classList.remove('border-transparent');

            // Load filtered requests
            loadRequests();
        }

        // Load requests
        async function loadRequests() {
            const tbody = document.getElementById('requestsTableBody');
            tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-gray-400">Loading...</td></tr>';

            try {
                const status = document.getElementById('filterStatus').value;
                const priority = document.getElementById('filterPriority').value;
                const search = document.getElementById('searchInput').value;

                let url = `${API_BASE}/estimate-requests?`;
                if (status) url += `status=${status}&`;
                if (priority) url += `priority=${priority}&`;
                if (search) url += `search=${search}&`;

                const response = await fetch(url, { headers: getAuthHeaders() });
                const result = await response.json();

                if (!result.success || !result.data || result.data.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="7" class="px-6 py-12 text-center">
                                <div class="text-gray-400">
                                    <div class="text-5xl mb-3">📭</div>
                                    <p>No requests found</p>
                                </div>
                            </td>
                        </tr>
                    `;
                    return;
                }

                tbody.innerHTML = result.data.map(request => `
                    <tr class="hover:bg-gray-50 priority-${request.priority}">
                        <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm font-medium text-gray-900">${esc(request.request_number)}</div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="text-sm font-medium text-gray-900">${esc(request.customer_name)}</div>
                            <div class="text-sm text-gray-500">${esc(request.phone)}</div>
                        </td>
                        <td class="px-6 py-4">
                            <div class="text-sm text-gray-900">${formatProjectType(request.project_type)}</div>
                            <div class="text-sm text-gray-500">${formatPropertyType(request.property_type)}</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap hide-mobile">
                            <div class="text-sm text-gray-900">${esc(request.area_sqft)} sq.ft</div>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                            <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full status-${request.status}">
                                ${formatStatus(request.status)}
                            </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hide-mobile">
                            ${formatDate(request.created_at)}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm">
                            <button data-action="view-request" data-id="${request.id}" class="text-purple-600 hover:text-purple-900 font-medium">
                                View Details
                            </button>
                        </td>
                    </tr>
                `).join('');

            } catch (error) {
                console.error('Load requests error:', error);
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="px-6 py-12 text-center text-red-600">
                            Error loading requests. Please try again.
                        </td>
                    </tr>
                `;
            }
        }

        // View request details
        async function viewRequest(id) {
            try {
                const response = await fetch(`${API_BASE}/estimate-requests/${id}`, { headers: getAuthHeaders() });
                const result = await response.json();

                if (!result.success) {
                    alert('Failed to load request details');
                    return;
                }

                currentRequest = result.data;
                const req = result.data;

                document.getElementById('modalTitle').textContent = `Request: ${req.request_number}`;
                document.getElementById('modalContent').innerHTML = `
                    <div class="space-y-6">
                        <!-- Customer Info -->
                        <div>
                            <h4 class="text-lg font-semibold text-gray-800 mb-3">Customer Information</h4>
                            <div class="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
                                <div>
                                    <p class="text-sm text-gray-600">Name</p>
                                    <p class="font-medium">${esc(req.customer_name)}</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">Phone</p>
                                    <p class="font-medium">${esc(req.phone)}</p>
                                </div>
                                <div class="col-span-2">
                                    <p class="text-sm text-gray-600">Email</p>
                                    <p class="font-medium">${esc(req.email) || 'Not provided'}</p>
                                </div>
                            </div>
                        </div>

                        <!-- Project Details -->
                        <div>
                            <h4 class="text-lg font-semibold text-gray-800 mb-3">Project Details</h4>
                            <div class="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
                                <div>
                                    <p class="text-sm text-gray-600">Project Type</p>
                                    <p class="font-medium">${formatProjectType(req.project_type)}</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">Property Type</p>
                                    <p class="font-medium">${formatPropertyType(req.property_type)}</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">Area</p>
                                    <p class="font-medium">${esc(req.area_sqft)} sq.ft</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">Rooms</p>
                                    <p class="font-medium">${esc(req.rooms) || 'Not specified'}</p>
                                </div>
                                <div class="col-span-2">
                                    <p class="text-sm text-gray-600">Location</p>
                                    <p class="font-medium">${esc(req.location)}</p>
                                </div>
                            </div>
                        </div>

                        <!-- Preferences -->
                        <div>
                            <h4 class="text-lg font-semibold text-gray-800 mb-3">Preferences</h4>
                            <div class="grid grid-cols-3 gap-4 bg-gray-50 rounded-lg p-4">
                                <div>
                                    <p class="text-sm text-gray-600">Preferred Brand</p>
                                    <p class="font-medium">${esc(req.preferred_brand) || 'Any'}</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">Timeline</p>
                                    <p class="font-medium">${esc(req.timeline) || 'Flexible'}</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600">Budget Range</p>
                                    <p class="font-medium">${esc(req.budget_range) || 'Not specified'}</p>
                                </div>
                            </div>
                        </div>

                        ${req.additional_notes ? `
                        <div>
                            <h4 class="text-lg font-semibold text-gray-800 mb-3">Additional Notes</h4>
                            <div class="bg-gray-50 rounded-lg p-4">
                                <p class="text-gray-700">${esc(req.additional_notes)}</p>
                            </div>
                        </div>
                        ` : ''}

                        <!-- Selected Products (if product-based request) -->
                        ${safeItems(req.products_json).length ? `
                        <div>
                            <h4 class="text-lg font-semibold text-gray-800 mb-3">🎨 Selected Products</h4>
                            <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div class="flex items-center justify-between mb-3">
                                    <p class="text-sm font-semibold text-blue-900">
                                        Request Method: ${req.request_method === 'product_available' ? '✓ Currently Available Products' : req.request_method === 'product_custom' ? '⚙️ Custom/Should Produce' : 'Product-Based'}
                                    </p>
                                    <span class="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded">${safeItems(req.products_json).length} products</span>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-sm">
                                        <thead class="bg-blue-100">
                                            <tr>
                                                <th class="px-3 py-2 text-left text-xs font-semibold">#</th>
                                                <th class="px-3 py-2 text-left text-xs font-semibold">Product</th>
                                                <th class="px-3 py-2 text-left text-xs font-semibold">Brand</th>
                                                <th class="px-3 py-2 text-left text-xs font-semibold">Type</th>
                                                <th class="px-3 py-2 text-left text-xs font-semibold">Details</th>
                                            </tr>
                                        </thead>
                                        <tbody class="bg-white">
                                            ${safeItems(req.products_json).map((item, idx) => `
                                                <tr class="border-t border-blue-200">
                                                    <td class="px-3 py-2">${idx + 1}</td>
                                                    <td class="px-3 py-2 font-medium text-gray-900">${esc(item.product_name)}</td>
                                                    <td class="px-3 py-2 text-gray-700">${esc(item.brand_name)}</td>
                                                    <td class="px-3 py-2">
                                                        <span class="px-2 py-1 text-xs rounded ${item.type === 'unit' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}">
                                                            ${item.type === 'unit' ? 'Unit' : 'Area'}
                                                        </span>
                                                    </td>
                                                    <td class="px-3 py-2 text-gray-600 text-xs">${esc(item.details)}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                        ` : ''}

                        <!-- Status & Actions -->
                        <div>
                            <h4 class="text-lg font-semibold text-gray-800 mb-3">Status & Actions</h4>
                            <div class="bg-gray-50 rounded-lg p-4">
                                <div class="flex items-center justify-between mb-4">
                                    <div>
                                        <p class="text-sm text-gray-600 mb-2">Current Status</p>
                                        <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full status-${req.status}">
                                            ${formatStatus(req.status)}
                                        </span>
                                    </div>
                                    <div>
                                        <p class="text-sm text-gray-600 mb-2">Priority</p>
                                        <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-200">
                                            ${req.priority.toUpperCase()}
                                        </span>
                                    </div>
                                </div>
                                <div class="flex gap-2">
                                    <select id="newStatus" class="flex-1 px-3 py-2 border border-gray-300 rounded-lg">
                                        <option value="new" ${req.status === 'new' ? 'selected' : ''}>New</option>
                                        <option value="contacted" ${req.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                                        <option value="quote_sent" ${req.status === 'quote_sent' ? 'selected' : ''}>Quote Sent</option>
                                        <option value="accepted" ${req.status === 'accepted' ? 'selected' : ''}>Accepted</option>
                                        <option value="rejected" ${req.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                                        <option value="completed" ${req.status === 'completed' ? 'selected' : ''}>Completed</option>
                                    </select>
                                    <button data-action="update-status" class="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700">
                                        Update Status
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Quick Actions -->
                        <div class="flex gap-3">
                            <a href="tel:${esc(req.phone)}" class="flex-1 bg-green-600 text-white py-3 rounded-lg text-center hover:bg-green-700">
                                📞 Call Customer
                            </a>
                            <a href="estimate-create-new.html?from_request=${req.id}" class="flex-1 bg-purple-600 text-white py-3 rounded-lg text-center hover:bg-purple-700">
                                📝 Create Estimate
                            </a>
                        </div>
                    </div>
                `;

                document.getElementById('detailModal').classList.remove('hidden');

            } catch (error) {
                console.error('View request error:', error);
                alert('Failed to load request details');
            }
        }

        // Update status
        async function updateStatus() {
            const newStatus = document.getElementById('newStatus').value;

            try {
                const response = await fetch(`${API_BASE}/estimate-requests/${currentRequest.id}/status`, {
                    method: 'PATCH',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ status: newStatus })
                });

                const result = await response.json();

                if (result.success) {
                    alert('Status updated successfully!');
                    closeModal();
                    loadRequests();
                    loadStats();
                } else {
                    alert('Failed to update status');
                }

            } catch (error) {
                console.error('Update status error:', error);
                alert('Failed to update status');
            }
        }

        function closeModal() {
            document.getElementById('detailModal').classList.add('hidden');
            currentRequest = null;
        }

        // Format functions
        function formatStatus(status) {
            const map = {
                'new': 'New',
                'contacted': 'Contacted',
                'quote_sent': 'Quote Sent',
                'accepted': 'Accepted',
                'rejected': 'Rejected',
                'completed': 'Completed'
            };
            return map[status] || status;
        }

        function formatProjectType(type) {
            const map = {
                'interior': 'Interior',
                'exterior': 'Exterior',
                'both': 'Interior & Exterior',
                'commercial': 'Commercial',
                'renovation': 'Renovation',
                'new_construction': 'New Construction'
            };
            return map[type] || type;
        }

        function formatPropertyType(type) {
            const map = {
                'house': 'House',
                'apartment': 'Apartment',
                'villa': 'Villa',
                'office': 'Office',
                'shop': 'Shop/Showroom',
                'warehouse': 'Warehouse',
                'other': 'Other'
            };
            return map[type] || type;
        }

        function formatDate(dateStr) {
            const date = new Date(dateStr);
            const now = new Date();
            const diff = now - date;
            const hours = Math.floor(diff / 3600000);

            if (hours < 1) return 'Just now';
            if (hours < 24) return `${hours}h ago`;
            if (hours < 48) return 'Yesterday';
            return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        }

        // Close modal on outside click
        document.getElementById('detailModal').addEventListener('click', function(e) {
            if (e.target === this) closeModal();
        });

        // ─── CSP-clean handler wiring (S9+F5 Phase C) ───
        // Static handlers (converted from on*= attributes):
        //   View Public Form button -> id="viewPublicFormBtn"
        //   status filter cards -> delegated click on .status-filter-card (reads data-status)
        //   Apply Filters button -> id="applyFiltersBtn"
        //   modal close button -> id="closeModalBtn"
        document.getElementById('viewPublicFormBtn').addEventListener('click', () => {
            window.open('request-estimate.html', '_blank');
        });
        document.getElementById('applyFiltersBtn').addEventListener('click', loadRequests);
        document.getElementById('closeModalBtn').addEventListener('click', closeModal);
        // Delegated click for status filter cards (replaces the 7 inline onclick="filterByStatus(...)").
        document.addEventListener('click', (e) => {
            const card = e.target.closest('.status-filter-card');
            if (card && card.dataset.status !== undefined) {
                filterByStatus(card.dataset.status, card);
                return;
            }
            // Runtime-injected handlers (templates use data-action):
            const el = e.target.closest('[data-action]');
            if (!el) return;
            const action = el.dataset.action;
            switch (action) {
                case 'view-request': {
                    const id = Number(el.dataset.id);
                    viewRequest(id);
                    break;
                }
                case 'update-status':
                    updateStatus();
                    break;
            }
        });

        // Load data on page load
        loadStats();
        loadRequests();

        // Refresh every 30 seconds
        setInterval(() => {
            loadStats();
            loadRequests();
        }, 30000);
