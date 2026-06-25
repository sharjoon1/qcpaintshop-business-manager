const token = window.location.pathname.split('/').pop();

async function loadSharedDesignRequest() {
    try {
        const r = await fetch(`/api/share/public/${token}`);
        if (!r.ok) throw new Error('Invalid link');
        const result = await r.json();
        if (!result.success) throw new Error(result.message);

        const { resource, branding } = result.data;

        document.getElementById('topBizName').textContent = branding.business_name || 'Quality Colours';
        document.getElementById('drCustName').textContent = resource.customer_name || '';
        document.getElementById('drCustPhone').textContent = resource.customer_phone || '';
        document.getElementById('drLocation').textContent = resource.location || resource.customer_address || '';
        document.getElementById('drDetails').textContent = resource.request_details || resource.notes || '';

        const statusMap = { 'new': 'New', 'contacted': 'Under Review', 'quote_sent': 'Quote Sent', 'accepted': 'Accepted', 'rejected': 'Rejected', 'completed': 'Completed' };
        const statusColors = { 'new': 'bg-blue-100 text-blue-800', 'contacted': 'bg-yellow-100 text-yellow-800', 'quote_sent': 'bg-purple-100 text-purple-800', 'accepted': 'bg-green-100 text-green-800', 'completed': 'bg-green-100 text-green-800' };
        const status = resource.status || 'new';
        document.getElementById('drStatus').innerHTML = `<span class="px-3 py-1 rounded-full text-xs font-semibold ${statusColors[status] || 'bg-gray-100 text-gray-800'}">${escHtml(statusMap[status] || status)}</span>`;

        // Photos
        const photos = resource.photos || resource.photo_urls;
        if (photos) {
            let photoArr = [];
            try { photoArr = typeof photos === 'string' ? JSON.parse(photos) : photos; } catch {}
            if (photoArr.length > 0) {
                document.getElementById('photosGrid').innerHTML = photoArr.map(url => {
                    const srcAttr = escAttr(url);
                    const dataUrl = escAttr(url);
                    return `<img src="${srcAttr}" class="w-full h-40 object-cover rounded-lg shadow" data-action="open-photo" data-url="${dataUrl}" style="cursor: pointer;">`;
                }).join('');
                document.getElementById('photosSection').style.display = 'block';
            }
        }

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
        document.title = `Design Request - ${branding.business_name || 'Quality Colours'}`;
    } catch (err) {
        console.error('Load error:', err);
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.remove('hidden');
    }
}

// Delegated click listener for runtime-injected photo elements (replaces the
// former inline handler that opened the photo URL in a new tab). Reads the URL
// from el.dataset.url, which is auto-unescaped by the browser.
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'open-photo') {
        window.open(el.dataset.url, '_blank');
    }
});

loadSharedDesignRequest();
