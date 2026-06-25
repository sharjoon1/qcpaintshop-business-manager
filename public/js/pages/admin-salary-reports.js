// admin-salary-reports page logic — externalized from admin-salary-reports.html (S9+F5 strict CSP).
// Verbatim relocation of the original inline <script> body; inline on*= handlers
// rewired to addEventListener. No business/pricing logic changes.
        function esc(s){ if(s===null||s===undefined) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

        const API_BASE = '';
        let currentReportData = null;

        // Check authentication
        async function checkAuth() {
            const token = localStorage.getItem('auth_token');
            if (!token) {
                window.location.href = '/login.html';
                return false;
            }

            try {
                const response = await fetch(`${API_BASE}/api/auth/me`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Unauthorized');

                return true;
            } catch (error) {
                localStorage.removeItem('auth_token');
                window.location.href = '/login.html';
                return false;
            }
        }

        // Load branches
        async function loadBranches() {
            try {
                const token = localStorage.getItem('auth_token');
                const response = await fetch(`${API_BASE}/api/branches`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await response.json();
                const branches = Array.isArray(result) ? result : (result.data || []);

                const select = document.getElementById('filterBranch');
                select.innerHTML = '<option value="">All Branches</option>';
                branches.forEach(branch => {
                    select.innerHTML += `<option value="${branch.id}">${esc(branch.name)}</option>`;
                });
            } catch (error) {
                console.error('Error loading branches:', error);
            }
        }

        // Set default month
        function setDefaultMonth() {
            const now = new Date();
            const monthStr = now.toISOString().substring(0, 7);
            document.getElementById('filterMonth').value = monthStr;
        }

        // Load report
        async function loadReport() {
            const token = localStorage.getItem('auth_token');
            const month = document.getElementById('filterMonth').value;

            if (!month) {
                alert('Please select a month');
                return;
            }

            const branchId = document.getElementById('filterBranch').value;

            document.getElementById('loading').style.display = 'block';
            document.getElementById('reportContent').style.display = 'none';

            // Get summary
            let summaryUrl = `${API_BASE}/api/salary/reports/summary?month=${month}`;
            if (branchId) summaryUrl += `&branch_id=${branchId}`;

            const summaryResponse = await fetch(summaryUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const summaryResult = await summaryResponse.json();

            // Get staff details
            let staffUrl = `${API_BASE}/api/salary/monthly?month=${month}`;
            if (branchId) staffUrl += `&branch_id=${branchId}`;

            const staffResponse = await fetch(staffUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const staffResult = await staffResponse.json();

            document.getElementById('loading').style.display = 'none';

            if (summaryResult.success) {
                currentReportData = {
                    summary: summaryResult.data.summary,
                    branches: summaryResult.data.branch_breakdown,
                    staff: staffResult.data
                };

                renderReport(currentReportData);
                document.getElementById('reportContent').style.display = 'block';
            } else {
                alert('Error loading report: ' + summaryResult.message);
            }
        }

        // Render report
        function renderReport(data) {
            const s = data.summary;

            // Overall summary
            document.getElementById('totalStaff').textContent = s.total_staff || 0;
            document.getElementById('paidCount').textContent = `${s.paid_count || 0} paid`;
            document.getElementById('totalGross').textContent = '₹' + parseFloat(s.total_gross_salary || 0).toLocaleString('en-IN', {minimumFractionDigits: 2});
            document.getElementById('totalNet').textContent = '₹' + parseFloat(s.total_net_salary || 0).toLocaleString('en-IN', {minimumFractionDigits: 2});
            document.getElementById('totalPaid').textContent = '₹' + parseFloat(s.total_paid || 0).toLocaleString('en-IN', {minimumFractionDigits: 2});
            document.getElementById('pendingAmount').textContent = '₹' + parseFloat(s.total_pending || 0).toLocaleString('en-IN', {minimumFractionDigits: 2}) + ' pending';
            document.getElementById('totalOTHours').textContent = parseFloat(s.total_overtime_hours || 0).toFixed(1) + ' hrs';
            document.getElementById('totalOTPay').textContent = '₹' + parseFloat(s.total_overtime_pay || 0).toLocaleString('en-IN', {minimumFractionDigits: 2}) + ' OT pay';
            document.getElementById('totalDeductions').textContent = '₹' + parseFloat(s.total_deductions || 0).toLocaleString('en-IN', {minimumFractionDigits: 2});

            // Branch breakdown
            const branchTbody = document.getElementById('branchTableBody');
            branchTbody.innerHTML = data.branches.map(b => {
                const paymentPct = b.total_salary > 0 ? ((b.total_paid / b.total_salary) * 100).toFixed(1) : 0;
                return `
                    <tr>
                        <td><strong>${esc(b.branch_name)}</strong></td>
                        <td>${b.staff_count}</td>
                        <td class="money">₹${parseFloat(b.total_salary || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                        <td class="money">₹${parseFloat(b.total_paid || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                        <td class="money ${b.pending > 0 ? 'negative' : ''}">₹${parseFloat(b.pending || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                        <td>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="flex: 1; background: #eee; height: 20px; border-radius: 10px; overflow: hidden;">
                                    <div style="width: ${paymentPct}%; height: 100%; background: ${paymentPct >= 100 ? '#4CAF50' : '#FFA726'};"></div>
                                </div>
                                <span style="min-width: 50px;">${paymentPct}%</span>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Staff details
            const staffTbody = document.getElementById('staffTableBody');
            staffTbody.innerHTML = data.staff.map(s => `
                <tr>
                    <td>${esc(s.staff_name)}</td>
                    <td>${esc(s.branch_name)}</td>
                    <td>${s.total_present_days || 0}</td>
                    <td>${parseFloat(s.total_standard_hours || 0).toFixed(1)}</td>
                    <td>${parseFloat(s.total_overtime_hours || 0).toFixed(1)}</td>
                    <td class="money">₹${parseFloat(s.gross_salary || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td class="money negative">₹${parseFloat(s.total_deductions || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td class="money">₹${parseFloat(s.net_salary || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td class="money">₹${parseFloat(s.paid_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td>
                        <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; background: ${s.payment_status === 'paid' ? '#d4edda' : '#fff3cd'}; color: ${s.payment_status === 'paid' ? '#155724' : '#856404'};">
                            ${s.payment_status}
                        </span>
                    </td>
                </tr>
            `).join('');
        }

        // Export to CSV
        function exportToCSV(type) {
            if (!currentReportData) return;

            const month = document.getElementById('filterMonth').value;
            let csv = '';
            let filename = '';

            if (type === 'branch') {
                filename = `salary-report-branches-${month}.csv`;
                csv = 'Branch,Staff Count,Total Salary,Total Paid,Pending,Payment %\n';
                currentReportData.branches.forEach(b => {
                    const paymentPct = b.total_salary > 0 ? ((b.total_paid / b.total_salary) * 100).toFixed(1) : 0;
                    csv += `"${b.branch_name}",${b.staff_count},${b.total_salary},${b.total_paid},${b.pending},${paymentPct}%\n`;
                });
            } else if (type === 'staff') {
                filename = `salary-report-staff-${month}.csv`;
                csv = 'Staff Name,Branch,Days,Hours,OT Hours,Gross Salary,Deductions,Net Salary,Paid,Pending,Status\n';
                currentReportData.staff.forEach(s => {
                    const pending = parseFloat(s.net_salary) - parseFloat(s.paid_amount);
                    csv += `"${s.staff_name}","${s.branch_name}",${s.total_present_days},${s.total_standard_hours},${s.total_overtime_hours},${s.gross_salary},${s.total_deductions},${s.net_salary},${s.paid_amount},${pending},${s.payment_status}\n`;
                });
            }

            // Download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
        }

        // Rewired inline handlers (S9+F5 strict CSP) — no logic change.
        document.getElementById('printReportBtn').addEventListener('click', () => window.print());
        document.getElementById('filterMonth').addEventListener('change', () => loadReport());
        document.getElementById('filterBranch').addEventListener('change', () => loadReport());
        document.getElementById('generateReportBtn').addEventListener('click', () => loadReport());
        document.getElementById('exportBranchBtn').addEventListener('click', () => exportToCSV('branch'));
        document.getElementById('exportStaffBtn').addEventListener('click', () => exportToCSV('staff'));

        // Initialize
        (async () => {
            if (await checkAuth()) {
                loadBranches();
                setDefaultMonth();
                loadReport();
            }
        })();
