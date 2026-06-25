// Page logic for My Salary. Externalized from the staff/salary.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener.
// No logic changes, no renames, escaping helpers (escHtml) untouched.

let currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
}

function formatMonth(monthStr) {
    const [y, m] = monthStr.split('-');
    return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function changeMonth(delta) {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta);
    currentMonth = d.toISOString().slice(0, 7);
    document.getElementById('monthLabel').textContent = formatMonth(currentMonth);
    loadMonthly();
    loadLeaveBalance();
}

function statusBadge(status) {
    const map = {
        calculated: 'badge-info',
        approved: 'badge-success',
        paid: 'badge-success',
        unpaid: 'badge-warning',
        partial: 'badge-warning'
    };
    return `<span class="badge ${map[status] || 'badge-info'}">${escHtml(status)}</span>`;
}

async function loadLeaveBalance() {
    try {
        const res = await fetch(`/api/attendance/leave-balance?month=${currentMonth}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success) {
            const card = document.getElementById('leaveBalanceCard');
            card.style.display = 'block';
            const lb = data.data;

            const sunEl = document.getElementById('salSundayLeave');
            sunEl.textContent = `${lb.sunday.used}/${lb.sunday.free} used`;
            sunEl.style.color = lb.sunday.remaining > 0 ? '#10b981' : '#ef4444';

            const wkEl = document.getElementById('salWeekdayLeave');
            wkEl.textContent = `${lb.weekday.used}/${lb.weekday.free} used`;
            wkEl.style.color = lb.weekday.remaining > 0 ? '#10b981' : '#ef4444';

            if (lb.will_be_deducted) {
                document.getElementById('salLeaveWarning').style.display = 'block';
                document.getElementById('salLeaveWarningText').textContent =
                    `⚠️ ${lb.total_excess} excess leave(s) will be deducted from salary`;
            } else {
                document.getElementById('salLeaveWarning').style.display = 'none';
            }
        }
    } catch (e) {
        console.error('Error loading leave balance:', e);
    }
}

async function loadAll() {
    document.getElementById('monthLabel').textContent = formatMonth(currentMonth);

    // Visibility gate — admin may have disabled salary display for this staff.
    try {
        const vres = await fetch('/api/salary/my-visibility', { headers: getAuthHeaders() });
        const vjson = await vres.json();
        if (vjson.success && !vjson.visible) {
            document.getElementById('loadingState').style.display = 'none';
            const main = document.querySelector('main') || document.body;
            const banner = document.createElement('div');
            banner.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:16px;border-radius:10px;margin:20px 0;font-size:14px;';
            banner.innerHTML = '<b>Salary details are not available.</b><br>' +
                'Please contact admin if you need your payslip. Admin can share it with you via WhatsApp on request.';
            // Hide every salary info card on the page
            ['configCard','monthlyCard','historyCard','paymentsCard'].forEach(function(id) {
                var el = document.getElementById(id); if (el) el.style.display = 'none';
            });
            // Insert banner at top of main content
            const firstCard = document.querySelector('.card, .info-card, [id$="Card"]');
            if (firstCard) firstCard.parentNode.insertBefore(banner, firstCard);
            else main.insertBefore(banner, main.firstChild);
            return;
        }
    } catch (e) { /* fall through to normal load on failure */ }

    await Promise.all([loadConfig(), loadMonthly(), loadHistory(), loadPayments(), loadLeaveBalance()]);
    document.getElementById('loadingState').style.display = 'none';
}

async function loadConfig() {
    try {
        const res = await fetch('/api/salary/my-config', { headers: getAuthHeaders() });
        const data = await res.json();
        const card = document.getElementById('configCard');
        card.style.display = 'block';

        if (data.success && data.data) {
            const c = data.data;
            document.getElementById('configContent').innerHTML = `
                <div class="info-row"><span style="color:#6b7280;">Base Salary</span><span class="amount">${formatCurrency(c.monthly_salary)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Branch</span><span style="font-weight:600;">${escHtml(c.branch_name)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Daily Hours</span><span style="font-weight:600;">${escHtml(c.standard_daily_hours)}h</span></div>
                <div class="info-row"><span style="color:#6b7280;">Sunday Hours</span><span style="font-weight:600;">${escHtml(c.sunday_hours)}h</span></div>
                <div class="info-row"><span style="color:#6b7280;">OT Multiplier</span><span style="font-weight:600;">${escHtml(c.overtime_multiplier)}x</span></div>
                <div class="info-row"><span style="color:#6b7280;">Transport</span><span style="font-weight:600;">${formatCurrency(c.transport_allowance)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Food</span><span style="font-weight:600;">${formatCurrency(c.food_allowance)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Effective From</span><span style="font-weight:600;">${new Date(c.effective_from).toLocaleDateString()}</span></div>
            `;
        } else {
            document.getElementById('noConfig').style.display = 'block';
        }
    } catch (e) {
        console.error('Load config error:', e);
    }
}

async function loadMonthly() {
    try {
        const res = await fetch(`/api/salary/my-monthly?month=${currentMonth}`, { headers: getAuthHeaders() });
        const data = await res.json();
        const card = document.getElementById('monthlyCard');
        card.style.display = 'block';

        if (data.success && data.data && data.data.length > 0) {
            const s = data.data[0];
            const netSalary = parseFloat(s.net_salary || 0) || (
                parseFloat(s.standard_hours_pay || 0) + parseFloat(s.sunday_hours_pay || 0) +
                parseFloat(s.overtime_pay || 0) + parseFloat(s.total_allowances || 0) -
                parseFloat(s.total_deductions || 0)
            );
            document.getElementById('monthlyContent').innerHTML = `
                <div style="text-align:center;margin-bottom:20px;">
                    <div class="amount" style="font-size:32px;">${formatCurrency(netSalary)}</div>
                    <div style="color:#6b7280;font-size:13px;margin-top:4px;">Net Salary ${statusBadge(s.payment_status || s.status)}</div>
                </div>
                <div class="info-row"><span style="color:#6b7280;">Working Days</span><span style="font-weight:600;">${escHtml(s.total_present_days || 0)} / ${escHtml(s.total_working_days || 0)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Standard Hours</span><span style="font-weight:600;">${parseFloat(s.total_standard_hours || 0).toFixed(1)}h</span></div>
                <div class="info-row"><span style="color:#6b7280;">Sunday Hours</span><span style="font-weight:600;">${parseFloat(s.total_sunday_hours || 0).toFixed(1)}h</span></div>
                <div class="info-row"><span style="color:#6b7280;">Overtime Hours</span><span style="font-weight:600;">${parseFloat(s.total_overtime_hours || 0).toFixed(1)}h</span></div>
                ${s.approved_overtime_hours != null ? `
                <div class="info-row"><span style="color:#6b7280;padding-left:12px;">↳ Approved OT (paid)</span><span style="font-weight:600;">${parseFloat(s.approved_overtime_hours).toFixed(1)}h</span></div>
                ${parseFloat(s.unapproved_overtime_hours || 0) > 0 ? `<div class="info-row"><span style="color:#6b7280;padding-left:12px;">↳ Unapproved OT (not paid)</span><span style="font-weight:600;color:#ef4444;">${parseFloat(s.unapproved_overtime_hours).toFixed(1)}h</span></div>` : ''}` : ''}
                <div class="info-row"><span style="color:#6b7280;">Standard Pay</span><span style="font-weight:600;">${formatCurrency(s.standard_hours_pay)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Sunday Pay</span><span style="font-weight:600;">${formatCurrency(s.sunday_hours_pay)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Overtime Pay</span><span style="font-weight:600;">${formatCurrency(s.overtime_pay)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Allowances</span><span style="font-weight:600;color:#10b981;">+${formatCurrency(s.total_allowances)}</span></div>
                ${parseFloat(s.leave_deduction || 0) > 0 ? `<div class="info-row"><span style="color:#6b7280;">Leave Deduction (${escHtml(s.excess_leaves || 0)} days)</span><span style="font-weight:600;color:#ef4444;">-${formatCurrency(s.leave_deduction)}</span></div>` : ''}
                <div class="info-row"><span style="color:#6b7280;">Total Deductions</span><span style="font-weight:600;color:#ef4444;">-${formatCurrency(s.total_deductions)}</span></div>
                <div class="info-row"><span style="color:#6b7280;">Paid Amount</span><span style="font-weight:600;">${formatCurrency(s.paid_amount)}</span></div>
            `;
            document.getElementById('noMonthly').style.display = 'none';
        } else {
            document.getElementById('monthlyContent').innerHTML = '';
            document.getElementById('noMonthly').style.display = 'block';
        }
    } catch (e) {
        console.error('Load monthly error:', e);
    }
}

async function loadHistory() {
    try {
        const res = await fetch('/api/salary/my-monthly', { headers: getAuthHeaders() });
        const data = await res.json();
        const card = document.getElementById('historyCard');

        if (data.success && data.data && data.data.length > 0) {
            card.style.display = 'block';
            document.getElementById('historyContent').innerHTML = data.data.map(s => {
                const net = parseFloat(s.net_salary || 0) || (
                    parseFloat(s.standard_hours_pay || 0) + parseFloat(s.sunday_hours_pay || 0) +
                    parseFloat(s.overtime_pay || 0) + parseFloat(s.total_allowances || 0) -
                    parseFloat(s.total_deductions || 0)
                );
                return `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f3f4f6;">
                        <div>
                            <div style="font-weight:600;color:#1f2937;">${formatMonth(s.salary_month)}</div>
                            <div style="font-size:12px;color:#6b7280;">${escHtml(s.total_present_days || 0)} days worked</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-weight:700;color:#1f2937;">${formatCurrency(net)}</div>
                            ${statusBadge(s.payment_status || s.status)}
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.error('Load history error:', e);
    }
}

async function loadPayments() {
    try {
        const res = await fetch('/api/salary/my-payments', { headers: getAuthHeaders() });
        const data = await res.json();
        const card = document.getElementById('paymentsCard');

        if (data.success && data.data && data.data.length > 0) {
            card.style.display = 'block';
            document.getElementById('paymentsContent').innerHTML = data.data.map(p => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f3f4f6;">
                    <div>
                        <div style="font-weight:600;color:#1f2937;">${formatCurrency(p.amount_paid)}</div>
                        <div style="font-size:12px;color:#6b7280;">${escHtml(p.salary_month)} - ${escHtml(p.payment_method || 'N/A')}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:13px;color:#6b7280;">${new Date(p.payment_date).toLocaleDateString()}</div>
                        ${p.paid_by_name ? `<div style="font-size:11px;color:#9ca3af;">by ${escHtml(p.paid_by_name)}</div>` : ''}
                    </div>
                </div>
            `).join('');
        } else {
            card.style.display = 'block';
            document.getElementById('noPayments').style.display = 'block';
        }
    } catch (e) {
        console.error('Load payments error:', e);
    }
}

// --- S9+F5 CSP: inline on*= handlers wired via addEventListener ---
function initSalaryHandlers() {
    const prevBtn = document.getElementById('monthPrevBtn');
    if (prevBtn) prevBtn.addEventListener('click', function() { changeMonth(-1); });
    const nextBtn = document.getElementById('monthNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function() { changeMonth(1); });
}

initSalaryHandlers();
loadAll();
