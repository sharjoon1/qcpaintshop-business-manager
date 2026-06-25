        // ========================================
        // CONFIG
        // ========================================
        const urlParams = new URLSearchParams(window.location.search);
        const estimateId = urlParams.get('id');
        const mode = urlParams.get('mode');
        const tokenOverride = urlParams.get('token');

        if (!estimateId) {
            alert('No estimate ID provided');
            window.location.href = '/';
        }

        function getToken() {
            return tokenOverride || localStorage.getItem('auth_token');
        }

        function formatINR(amount) {
            return '\u20B9' + parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function formatDate(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            if (isNaN(d)) return dateStr;
            return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        function escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        // ========================================
        // INIT
        // ========================================
        if (mode === 'pdf') {
            document.body.style.background = 'white';
            document.querySelector('#receiptContent').style.margin = '0 auto';
            document.querySelector('#receiptContent').style.padding = '0';
        }

        loadReceipt();

        // ========================================
        // LOAD RECEIPT
        // ========================================
        async function loadReceipt() {
            try {
                const token = getToken();
                const res = await fetch(`/api/estimates/${estimateId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error('Failed to load estimate');
                const data = await res.json();

                // Header meta
                const receiptDate = data.payment_recorded_at || data.updated_at || new Date().toISOString();
                document.getElementById('receiptDate').textContent = formatDate(receiptDate);
                document.getElementById('estNumber').textContent = data.estimate_number || '';

                // Customer
                document.getElementById('custName').textContent = data.customer_name || '';
                document.getElementById('custPhone').textContent = data.customer_phone ? 'Phone: ' + data.customer_phone : '';
                document.getElementById('custAddress').textContent = data.customer_address || '';

                // Items
                const items = data.items || [];
                renderItems(items);

                // Summary calculations
                const grandTotal = parseFloat(data.grand_total) || 0;
                const paymentAmount = parseFloat(data.payment_amount) || 0;
                const balance = grandTotal - paymentAmount;

                document.getElementById('subtotalVal').textContent = formatINR(grandTotal);
                document.getElementById('grandTotalVal').textContent = formatINR(grandTotal);
                document.getElementById('amountPaidVal').textContent = formatINR(paymentAmount);

                // Paid badge
                if (balance <= 0) {
                    document.getElementById('paidBadge').classList.remove('hidden');
                    document.getElementById('balanceRow').style.display = 'none';
                } else {
                    document.getElementById('balanceBadge').textContent = formatINR(balance);
                }

                // Payment method
                if (data.payment_method) {
                    document.getElementById('paymentMethodVal').textContent = data.payment_method;
                } else {
                    document.getElementById('paymentMethodRow').style.display = 'none';
                }

                // Payment reference
                if (data.payment_reference) {
                    document.getElementById('paymentRefVal').textContent = data.payment_reference;
                } else {
                    document.getElementById('paymentRefRow').style.display = 'none';
                }

                // Load branding
                loadBranding(token);

                // QR removed — receipt should not show QR since payment is already made

                // Show content
                document.getElementById('loadingState').classList.add('hidden');
                document.getElementById('receiptContent').classList.remove('hidden');

            } catch (error) {
                console.error('Error loading receipt:', error);
                document.getElementById('loadingState').innerHTML = `
                    <div class="text-center">
                        <div class="text-red-500 text-lg font-bold">Failed to load receipt</div>
                        <div class="text-gray-500 text-sm mt-2">${escapeHtml(error.message)}</div>
                        <button data-action="go-back" class="mt-4 px-4 py-2 bg-gray-600 text-white rounded-lg text-sm">Go Back</button>
                    </div>`;
            }
        }

        // ========================================
        // RENDER ITEMS
        // ========================================
        function renderItems(items) {
            const tbody = document.getElementById('tableBody');

            if (!items || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">No items</td></tr>';
                return;
            }

            tbody.innerHTML = items.map((item, i) => {
                const name = escapeHtml(item.product_name || item.item_name || item.custom_description || 'Item');
                const packSize = item.pack_size ? ` <span class="text-gray-400 text-xs">(${escapeHtml(item.pack_size)})</span>` : '';
                const qty = parseInt(item.quantity) || 1;
                const price = parseFloat(item.final_price || item.unit_price || item.rate || 0);
                const total = parseFloat(item.line_total || item.total || (price * qty));

                return `<tr>
                    <td class="text-gray-400 text-xs">${i + 1}</td>
                    <td class="font-medium">${name}${packSize}</td>
                    <td style="text-align:right;">${qty}</td>
                    <td style="text-align:right;">${formatINR(price)}</td>
                    <td style="text-align:right; font-weight: 600;">${formatINR(total)}</td>
                </tr>`;
            }).join('');
        }

        // ========================================
        // BRANDING
        // ========================================
        async function loadBranding(token) {
            try {
                const res = await fetch('/api/settings/branding', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return;
                const settings = await res.json();
                const data = settings.data || settings;

                if (data.business_name) {
                    document.getElementById('companyName').textContent = data.business_name;
                }
                if (data.business_logo) {
                    document.getElementById('headerLogo').src = '/uploads/logos/' + data.business_logo;
                }
                let details = [];
                if (data.business_address) details.push(data.business_address);
                let line2 = [];
                if (data.business_phone) line2.push('Phone: ' + data.business_phone);
                if (data.business_email) line2.push('Email: ' + data.business_email);
                if (line2.length) details.push(line2.join(' | '));
                if (data.business_gst) details.push('GST: ' + data.business_gst);
                if (details.length) {
                    document.getElementById('companyDetails').innerHTML = details.join('<br>');
                }
            } catch {}
        }

        // ========================================
        // HANDLER WIRING (replaces former inline on*= attributes)
        // ========================================
        // STATIC: <img id="headerLogo" onerror="this.style.display='none'"> -> delegated error listener
        document.getElementById('headerLogo').addEventListener('error', function () {
            this.style.display = 'none';
        });

        // RUNTIME: error-state template button uses data-action="go-back"
        // (formerly onclick="history.back()") -> delegated document click listener
        document.addEventListener('click', function (e) {
            const el = e.target.closest('[data-action]');
            if (!el) return;
            const action = el.dataset.action;
            if (action === 'go-back') {
                history.back();
            }
        });
