/**
 * WhatsApp Quick Send Modal Component
 * Reusable modal for sending WhatsApp messages from any admin page.
 *
 * Usage:
 *   WaQuickSend.open({ to, toName, message, context, recipientType });
 *   WaQuickSend.fillTemplate('collections_customer_staff', { staffName: 'X', ... });
 */
(function() {
    'use strict';

    // ─── Constants ───────────────────────────────────────────

    var API_SEND   = '/api/whatsapp-chat/quick-send';
    var API_USERS  = '/api/users';

    var TEMPLATES = {
        collections_customer_staff:  'Hi {staffName}, Customer: {customerName} has \u20b9{outstanding} outstanding ({overdueCount} invoices overdue). Please follow up and collect.',
        collections_customer_direct: 'Dear {customerName}, this is a reminder that \u20b9{outstanding} is pending. Please arrange payment at the earliest. - Quality Colours',
        collections_invoice_staff:   'Hi {staffName}, Invoice {invoiceNo} for {customerName} - \u20b9{balance} pending since {date}. Please collect.',
        collections_invoice_direct:  'Dear {customerName}, your invoice {invoiceNo} of \u20b9{balance} is pending since {date}. Kindly arrange payment. - Quality Colours',
        leads_staff:                 'Hi {staffName}, Please check lead: {leadName}, Phone: {phone}, Source: {source}, Status: {status}. Follow up required.',
        leads_direct:                'Hi {leadName}, Thank you for your interest in Quality Colours. We\'d like to help you with your paint requirements. - Quality Colours'
    };

    // ─── State ───────────────────────────────────────────────

    var modalEl       = null;   // root overlay element
    var staffCache    = null;   // array, fetched once
    var currentOpts   = {};     // last open() options
    var staffFetching = false;

    // ─── Helpers ─────────────────────────────────────────────

    function authHeader() {
        return { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') };
    }

    function fillTemplate(key, data) {
        var tpl = TEMPLATES[key];
        if (!tpl) return '';
        return tpl.replace(/\{(\w+)\}/g, function(_, k) {
            return data[k] !== undefined ? data[k] : '{' + k + '}';
        });
    }

    function sanitizePhone(p) {
        return (p || '').replace(/[^0-9+]/g, '');
    }

    function isValidPhone(p) {
        return sanitizePhone(p).replace(/\+/g, '').length >= 10;
    }

    // ─── CSS (injected once) ─────────────────────────────────

    function injectStyles() {
        if (document.getElementById('wa-quick-send-style')) return;
        var style = document.createElement('style');
        style.id = 'wa-quick-send-style';
        style.textContent = [
            '.wqs-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s ease }',
            '.wqs-overlay.wqs-visible { opacity:1 }',
            '.wqs-box { background:#fff;width:92%;max-width:500px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;transform:translateY(20px);transition:transform .2s ease }',
            '.wqs-overlay.wqs-visible .wqs-box { transform:translateY(0) }',

            '.wqs-header { display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid #e2e8f0 }',
            '.wqs-header-icon { width:28px;height:28px;fill:#25D366;flex-shrink:0 }',
            '.wqs-header-title { font-size:16px;font-weight:600;color:#1e293b;flex:1 }',
            '.wqs-close { background:none;border:none;cursor:pointer;padding:4px;color:#94a3b8;font-size:22px;line-height:1 }',
            '.wqs-close:hover { color:#475569 }',

            '.wqs-body { padding:20px }',

            '.wqs-pills { display:flex;gap:8px;margin-bottom:16px }',
            '.wqs-pill { flex:1;padding:8px 0;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;text-align:center;transition:all .15s ease;background:#f1f5f9;color:#64748b }',
            '.wqs-pill.wqs-active { background:linear-gradient(135deg,#667eea,#764ba2);color:#fff }',

            '.wqs-label { display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px }',
            '.wqs-field-group { margin-bottom:14px;position:relative }',

            '.wqs-input { width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;color:#1e293b;outline:none;box-sizing:border-box;transition:border-color .15s }',
            '.wqs-input:focus { border-color:#667eea }',

            '.wqs-to-name { font-size:12px;color:#64748b;margin-top:2px }',

            '.wqs-dropdown { position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-height:200px;overflow-y:auto;z-index:10;display:none }',
            '.wqs-dropdown.wqs-open { display:block }',
            '.wqs-dd-item { padding:10px 12px;font-size:13px;color:#334155;cursor:pointer;border-bottom:1px solid #f1f5f9 }',
            '.wqs-dd-item:last-child { border-bottom:none }',
            '.wqs-dd-item:hover { background:#f1f5f9 }',
            '.wqs-dd-item small { color:#94a3b8 }',
            '.wqs-dd-empty { padding:10px 12px;font-size:13px;color:#94a3b8;text-align:center }',

            '.wqs-textarea { width:100%;min-height:100px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;color:#1e293b;outline:none;resize:vertical;box-sizing:border-box;font-family:inherit;transition:border-color .15s }',
            '.wqs-textarea:focus { border-color:#667eea }',
            '.wqs-charcount { text-align:right;font-size:11px;color:#94a3b8;margin-top:2px }',

            '.wqs-send-btn { width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px;transition:opacity .15s }',
            '.wqs-send-btn:disabled { opacity:0.6;cursor:not-allowed }',

            '.wqs-spinner { width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:wqs-spin .6s linear infinite;display:none }',
            '@keyframes wqs-spin { to { transform:rotate(360deg) } }',

            '.wqs-status { text-align:center;margin-top:12px;font-size:13px;font-weight:500;min-height:20px }',
            '.wqs-status-success { color:#22c55e }',
            '.wqs-status-error { color:#dc2626 }',

            '.wqs-staff-loading { padding:12px;text-align:center;font-size:13px;color:#94a3b8 }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ─── Build modal DOM (once) ──────────────────────────────

    function ensureModal() {
        if (modalEl) return;
        injectStyles();

        var overlay = document.createElement('div');
        overlay.className = 'wqs-overlay';
        overlay.innerHTML = [
            '<div class="wqs-box">',

            '  <div class="wqs-header">',
            '    <svg class="wqs-header-icon" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785h-.01a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.981.999-3.648-.235-.374a9.86 9.86 0 01-1.511-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
            '    <span class="wqs-header-title">Send WhatsApp Message</span>',
            '    <button class="wqs-close" id="wqs-close-btn">&times;</button>',
            '  </div>',

            '  <div class="wqs-body">',

            '    <div class="wqs-pills" id="wqs-pills">',
            '      <button class="wqs-pill" data-type="staff">Staff</button>',
            '      <button class="wqs-pill" data-type="customer">Customer</button>',
            '    </div>',

            '    <div class="wqs-field-group" id="wqs-to-group">',
            '      <label class="wqs-label">To</label>',
            '      <input class="wqs-input" id="wqs-to-input" placeholder="Search staff or enter phone..." autocomplete="off" />',
            '      <div class="wqs-to-name" id="wqs-to-name"></div>',
            '      <div class="wqs-dropdown" id="wqs-dropdown"></div>',
            '    </div>',

            '    <div class="wqs-field-group">',
            '      <label class="wqs-label">Message</label>',
            '      <textarea class="wqs-textarea" id="wqs-message" placeholder="Type your message..."></textarea>',
            '      <div class="wqs-charcount" id="wqs-charcount">0 chars</div>',
            '    </div>',

            '    <button class="wqs-send-btn" id="wqs-send-btn">',
            '      <span class="wqs-spinner" id="wqs-spinner"></span>',
            '      <span id="wqs-send-label">Send Message</span>',
            '    </button>',

            '    <div class="wqs-status" id="wqs-status"></div>',

            '  </div>',

            '</div>'
        ].join('\n');

        // close on overlay click
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeModal();
        });

        document.body.appendChild(overlay);
        modalEl = overlay;

        // wire events
        document.getElementById('wqs-close-btn').addEventListener('click', closeModal);

        // pills
        var pills = document.querySelectorAll('#wqs-pills .wqs-pill');
        for (var i = 0; i < pills.length; i++) {
            pills[i].addEventListener('click', function() { setRecipientType(this.getAttribute('data-type')); });
        }

        // to input
        var toInput = document.getElementById('wqs-to-input');
        toInput.addEventListener('input', onToInput);
        toInput.addEventListener('focus', onToFocus);
        document.addEventListener('click', function(e) {
            var dd = document.getElementById('wqs-dropdown');
            if (dd && !dd.contains(e.target) && e.target !== toInput) {
                dd.classList.remove('wqs-open');
            }
        });

        // message char count
        document.getElementById('wqs-message').addEventListener('input', updateCharCount);

        // send
        document.getElementById('wqs-send-btn').addEventListener('click', doSend);

        // esc key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && modalEl && modalEl.classList.contains('wqs-visible')) closeModal();
        });
    }

    // ─── Recipient type toggling ─────────────────────────────

    var activeType = 'customer';

    function setRecipientType(type) {
        activeType = type;
        var pills = document.querySelectorAll('#wqs-pills .wqs-pill');
        for (var i = 0; i < pills.length; i++) {
            pills[i].classList.toggle('wqs-active', pills[i].getAttribute('data-type') === type);
        }

        var toInput = document.getElementById('wqs-to-input');
        var dropdown = document.getElementById('wqs-dropdown');
        var toName = document.getElementById('wqs-to-name');
        dropdown.classList.remove('wqs-open');

        if (type === 'staff') {
            toInput.placeholder = 'Search staff by name...';
            toInput.value = '';
            toName.textContent = '';
            fetchStaffIfNeeded();
        } else {
            toInput.placeholder = 'Enter phone number...';
            toInput.value = currentOpts.to ? sanitizePhone(currentOpts.to) : '';
            toName.textContent = currentOpts.toName || '';
        }
    }

    // ─── Staff fetch & dropdown ──────────────────────────────

    function fetchStaffIfNeeded() {
        if (staffCache || staffFetching) return;
        staffFetching = true;
        var dd = document.getElementById('wqs-dropdown');
        dd.innerHTML = '<div class="wqs-staff-loading">Loading staff...</div>';
        dd.classList.add('wqs-open');

        fetch(API_USERS, { headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()) })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = Array.isArray(data) ? data : (data.users || data.data || []);
                staffCache = list.filter(function(u) { return u.phone; });
                staffFetching = false;
                renderStaffDropdown('');
            })
            .catch(function() {
                staffFetching = false;
                dd.innerHTML = '<div class="wqs-dd-empty">Failed to load staff</div>';
            });
    }

    function renderStaffDropdown(query) {
        var dd = document.getElementById('wqs-dropdown');
        if (!staffCache) return;

        var q = (query || '').toLowerCase().trim();
        var filtered = staffCache.filter(function(u) {
            if (!q) return true;
            return (u.full_name || '').toLowerCase().indexOf(q) !== -1 ||
                   (u.phone || '').indexOf(q) !== -1;
        });

        if (filtered.length === 0) {
            dd.innerHTML = '<div class="wqs-dd-empty">No matching staff</div>';
            dd.classList.add('wqs-open');
            return;
        }

        dd.innerHTML = filtered.map(function(u) {
            return '<div class="wqs-dd-item" data-phone="' + (u.phone || '') + '" data-name="' + (u.full_name || '') + '">'
                + (u.full_name || 'Unknown') + ' <small>' + (u.phone || '') + '</small></div>';
        }).join('');

        dd.classList.add('wqs-open');

        // attach click handlers
        var items = dd.querySelectorAll('.wqs-dd-item');
        for (var i = 0; i < items.length; i++) {
            items[i].addEventListener('click', function() {
                var phone = this.getAttribute('data-phone');
                var name  = this.getAttribute('data-name');
                document.getElementById('wqs-to-input').value = name;
                document.getElementById('wqs-to-name').textContent = phone;
                document.getElementById('wqs-to-input').setAttribute('data-selected-phone', phone);
                dd.classList.remove('wqs-open');
            });
        }
    }

    function onToInput() {
        if (activeType === 'staff') {
            document.getElementById('wqs-to-input').removeAttribute('data-selected-phone');
            document.getElementById('wqs-to-name').textContent = '';
            renderStaffDropdown(this.value);
        }
    }

    function onToFocus() {
        if (activeType === 'staff') {
            fetchStaffIfNeeded();
            if (staffCache) renderStaffDropdown(this.value);
        }
    }

    // ─── Char count ──────────────────────────────────────────

    function updateCharCount() {
        var len = (document.getElementById('wqs-message').value || '').length;
        document.getElementById('wqs-charcount').textContent = len + ' char' + (len !== 1 ? 's' : '');
    }

    // ─── Resolve phone number ────────────────────────────────

    function getPhone() {
        var toInput = document.getElementById('wqs-to-input');
        if (activeType === 'staff') {
            return sanitizePhone(toInput.getAttribute('data-selected-phone') || '');
        }
        return sanitizePhone(toInput.value);
    }

    // ─── Send ────────────────────────────────────────────────

    function doSend() {
        var phone   = getPhone();
        var message = (document.getElementById('wqs-message').value || '').trim();
        var status  = document.getElementById('wqs-status');
        var btn     = document.getElementById('wqs-send-btn');
        var spinner = document.getElementById('wqs-spinner');
        var label   = document.getElementById('wqs-send-label');

        status.textContent = '';
        status.className = 'wqs-status';

        if (!isValidPhone(phone)) {
            status.textContent = 'Please enter a valid phone number (at least 10 digits).';
            status.classList.add('wqs-status-error');
            return;
        }
        if (!message) {
            status.textContent = 'Please enter a message.';
            status.classList.add('wqs-status-error');
            return;
        }

        btn.disabled = true;
        spinner.style.display = 'inline-block';
        label.textContent = 'Sending...';

        fetch(API_SEND, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
            body: JSON.stringify({ phone: phone, message: message, context: currentOpts.context || '' })
        })
        .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || d.message || 'Send failed'); });
            return r.json();
        })
        .then(function() {
            spinner.style.display = 'none';
            label.textContent = 'Send Message';
            btn.disabled = false;

            status.innerHTML = '<span style="font-size:20px;vertical-align:middle">&#10003;</span> Message sent!';
            status.className = 'wqs-status wqs-status-success';

            setTimeout(function() { closeModal(); }, 2000);
        })
        .catch(function(err) {
            spinner.style.display = 'none';
            label.textContent = 'Send Message';
            btn.disabled = false;

            status.textContent = err.message || 'Failed to send message.';
            status.className = 'wqs-status wqs-status-error';
        });
    }

    // ─── Open / Close ────────────────────────────────────────

    function openModal(opts) {
        opts = opts || {};
        currentOpts = opts;

        ensureModal();

        // reset state
        var toInput = document.getElementById('wqs-to-input');
        toInput.value = '';
        toInput.removeAttribute('data-selected-phone');
        document.getElementById('wqs-to-name').textContent = '';
        document.getElementById('wqs-message').value = opts.message || '';
        document.getElementById('wqs-status').textContent = '';
        document.getElementById('wqs-status').className = 'wqs-status';
        document.getElementById('wqs-send-btn').disabled = false;
        document.getElementById('wqs-spinner').style.display = 'none';
        document.getElementById('wqs-send-label').textContent = 'Send Message';
        document.getElementById('wqs-dropdown').classList.remove('wqs-open');
        updateCharCount();

        // recipient type
        var type = opts.recipientType || null;
        if (type === 'staff' || type === 'customer') {
            setRecipientType(type);
        } else {
            // default to customer, user can toggle
            setRecipientType('customer');
        }

        // pre-fill phone for customer mode
        if (activeType === 'customer') {
            toInput.value = opts.to ? sanitizePhone(opts.to) : '';
            document.getElementById('wqs-to-name').textContent = opts.toName || '';
        }

        // show
        modalEl.style.display = 'flex';
        // force reflow for transition
        void modalEl.offsetWidth;
        modalEl.classList.add('wqs-visible');
        document.body.style.overflow = 'hidden';

        // focus message if phone pre-filled, else focus to
        if (opts.to && activeType === 'customer') {
            document.getElementById('wqs-message').focus();
        } else {
            toInput.focus();
        }
    }

    function closeModal() {
        if (!modalEl) return;
        modalEl.classList.remove('wqs-visible');
        document.body.style.overflow = '';
        setTimeout(function() {
            if (modalEl) modalEl.style.display = 'none';
        }, 200);
    }

    // ─── Public API ──────────────────────────────────────────

    window.WaQuickSend = {
        open: openModal,
        close: closeModal,
        TEMPLATES: TEMPLATES,
        fillTemplate: fillTemplate
    };

})();
