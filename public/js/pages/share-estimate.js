const token = window.location.pathname.split('/').pop();

async function loadSharedEstimate() {
    try {
        const r = await fetch(`/api/share/public/${token}`);
        if (!r.ok) throw new Error('Invalid or expired link');
        const result = await r.json();
        if (!result.success) throw new Error(result.message);

        const { resource, branding } = result.data;

        // Branding
        const bizName = branding.business_name || 'Quality Colours';
        document.getElementById('topBizName').textContent = bizName;
        document.getElementById('companyName').textContent = bizName;
        const details = [];
        if (branding.business_address) details.push(branding.business_address);
        if (branding.business_phone) details.push('Phone: ' + branding.business_phone);
        if (branding.business_email) details.push('Email: ' + branding.business_email);
        document.getElementById('companyDetails').innerHTML = details.join('<br>');
        if (branding.business_logo) {
            document.getElementById('headerLogo').src = branding.business_logo;
        }

        // Estimate info
        document.getElementById('estDate').textContent = resource.estimate_date ? new Date(resource.estimate_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        document.getElementById('estNumber').textContent = resource.estimate_number || '';
        document.getElementById('custName').textContent = resource.customer_name || '';
        document.getElementById('custPhone').textContent = resource.customer_phone || '';
        document.getElementById('custAddr').textContent = resource.customer_address || '';

        // Column visibility
        let colVis = {};
        if (resource.column_visibility) {
            try { colVis = JSON.parse(resource.column_visibility); } catch {}
        }
        if (colVis.show_qty === false) document.querySelectorAll('.col-qty').forEach(el => el.style.display = 'none');
        if (colVis.show_mix === false) document.querySelectorAll('.col-mix').forEach(el => el.style.display = 'none');
        if (colVis.show_price === false) document.querySelectorAll('.col-price').forEach(el => el.style.display = 'none');
        if (colVis.show_breakdown === false) document.querySelectorAll('.col-breakdown').forEach(el => el.style.display = 'none');
        if (colVis.show_color === false) document.querySelectorAll('.col-color').forEach(el => el.style.display = 'none');
        if (colVis.show_total === false) document.querySelectorAll('.col-total').forEach(el => el.style.display = 'none');

        // Items
        const items = resource.items || [];
        const tbody = document.getElementById('itemsBody');
        tbody.innerHTML = items.map((item, i) => `
            <tr class="${i % 2 === 0 ? 'bg-gray-50' : ''}">
                <td class="px-3 py-2 text-center">${i + 1}</td>
                <td class="px-3 py-2 font-semibold">${esc(item.item_description || item.product_name || '')}</td>
                <td class="px-3 py-2 col-qty">${item.quantity}${item.area ? ` (${item.area} sqft)` : ''}</td>
                <td class="px-3 py-2 col-mix">${esc(item.mix_info || '-')}</td>
                <td class="px-3 py-2 text-right col-price">₹${fmtNum(item.unit_price)}</td>
                <td class="px-3 py-2 col-breakdown">${esc(item.breakdown_cost || '-')}</td>
                <td class="px-3 py-2 text-right col-color">₹${fmtNum(item.color_cost || 0)}</td>
                <td class="px-3 py-2 text-right font-bold col-total">₹${fmtNum(item.line_total)}</td>
            </tr>
        `).join('');

        // Summary
        if (resource.show_gst_breakdown) {
            document.getElementById('subtotalAmt').textContent = '₹' + fmtNum(resource.subtotal);
            document.getElementById('gstAmt').textContent = '₹' + fmtNum(resource.gst_amount);
            document.getElementById('gstBreakdown').style.display = 'flex';
            document.getElementById('gstRow').style.display = 'flex';
        }
        document.getElementById('grandTotal').textContent = fmtNum(resource.grand_total);
        document.getElementById('amountWords').textContent = 'Amount in Words: Rupees ' + Math.floor(parseFloat(resource.grand_total) || 0).toLocaleString('en-IN') + ' Only';

        // Notes
        if (resource.notes && resource.notes.trim()) {
            document.getElementById('notesContent').textContent = resource.notes;
            document.getElementById('notesSection').style.display = 'block';
        }

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
        document.title = `Estimate ${resource.estimate_number} - ${bizName}`;

    } catch (err) {
        console.error('Load shared estimate error:', err);
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.remove('hidden');
    }
}

function downloadSharePDF() {
    window.open(`/api/share/public/${token}/pdf`, '_blank');
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtNum(num) {
    return (parseFloat(num) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

loadSharedEstimate();

// --- Wiring for former inline handlers (strict CSP: script-src-attr 'none') ---
(function wireStaticHandlers() {
    function bind() {
        const dlBtn = document.getElementById('downloadPdfBtn');
        if (dlBtn) dlBtn.addEventListener('click', downloadSharePDF);

        const printBtn = document.getElementById('printBtn');
        if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

        const headerLogo = document.getElementById('headerLogo');
        if (headerLogo) headerLogo.addEventListener('error', function () { this.style.display = 'none'; });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
