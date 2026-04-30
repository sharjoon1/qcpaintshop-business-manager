/* QC UI primitives — toast, modal, sheet, chip.
 * Pair with public/css/qc-ui.css.
 *
 *   qcToast(message, { variant: 'success'|'error'|'warning'|'info', duration: 4000 })
 *   qcConfirm({ title, message, primaryText, secondaryText, danger: bool, admin: bool }) -> Promise<boolean>
 *   qcAlert({ title, message, admin: bool }) -> Promise<void>
 *   qcSheet({ title, html, onClose }) -> { close }
 *   qcChip({ label, variant: 'default'|'admin'|'staff'|'warning'|'danger', onRemove }) -> string (HTML)
 *
 * No external deps. Replaces window.alert / window.confirm / per-page toast roll-ups.
 */
(function (global) {
    function escapeHTML(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function ensureToastHost() {
        let host = document.getElementById('qc-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'qc-toast-host';
            host.className = 'qc-toast-host';
            document.body.appendChild(host);
        }
        return host;
    }

    function qcToast(message, opts) {
        opts = opts || {};
        const host = ensureToastHost();
        const el = document.createElement('div');
        el.className = 'qc-toast qc-toast-' + (opts.variant || 'info');
        el.setAttribute('role', opts.variant === 'error' ? 'alert' : 'status');
        el.innerHTML = `
            <span class="qc-toast-stripe"></span>
            <span class="qc-toast-body">${escapeHTML(message)}</span>
            <button type="button" class="qc-toast-close" aria-label="Dismiss">&times;</button>
        `;
        host.appendChild(el);
        requestAnimationFrame(() => el.classList.add('qc-toast-in'));

        const dismiss = () => {
            el.classList.remove('qc-toast-in');
            setTimeout(() => el.remove(), 250);
        };
        el.querySelector('.qc-toast-close').addEventListener('click', dismiss);
        if (opts.duration !== 0) {
            setTimeout(dismiss, opts.duration || 4000);
        }
        return { dismiss };
    }

    function buildModal({ title, message, primaryText, secondaryText, danger, admin, isAlert }) {
        const primary = primaryText || (isAlert ? 'OK' : 'Confirm');
        const primaryClass = danger ? 'qc-btn-danger' : (admin ? 'qc-btn-primary-admin' : 'qc-btn-primary');
        const wrap = document.createElement('div');
        wrap.className = 'qc-modal-backdrop';
        wrap.innerHTML = `
            <div class="qc-modal" role="dialog" aria-modal="true">
                ${title ? `<h3 class="qc-modal-title">${escapeHTML(title)}</h3>` : ''}
                ${message ? `<p class="qc-modal-body">${escapeHTML(message)}</p>` : ''}
                <div class="qc-modal-actions">
                    ${isAlert ? '' : `<button type="button" class="qc-btn qc-btn-secondary" data-act="cancel">${escapeHTML(secondaryText || 'Cancel')}</button>`}
                    <button type="button" class="qc-btn ${primaryClass}" data-act="confirm">${escapeHTML(primary)}</button>
                </div>
            </div>
        `;
        return wrap;
    }

    function showModal(node) {
        document.body.appendChild(node);
        requestAnimationFrame(() => node.classList.add('qc-modal-in'));
        return new Promise((resolve) => {
            const close = (result) => {
                node.classList.remove('qc-modal-in');
                setTimeout(() => node.remove(), 200);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') close(false);
                else if (e.key === 'Enter') close(true);
            };
            node.addEventListener('click', (e) => {
                if (e.target === node) close(false);
                if (e.target.dataset.act === 'cancel') close(false);
                if (e.target.dataset.act === 'confirm') close(true);
            });
            document.addEventListener('keydown', onKey);
            const focusTarget = node.querySelector('[data-act="confirm"]');
            if (focusTarget) focusTarget.focus();
        });
    }

    function qcConfirm(opts) {
        return showModal(buildModal({ ...(opts || {}), isAlert: false }));
    }

    function qcAlert(opts) {
        return showModal(buildModal({ ...(opts || {}), isAlert: true })).then(() => undefined);
    }

    function qcSheet(opts) {
        opts = opts || {};
        const backdrop = document.createElement('div');
        backdrop.className = 'qc-sheet-backdrop';
        const sheet = document.createElement('div');
        sheet.className = 'qc-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.innerHTML = `
            <span class="qc-sheet-handle" aria-hidden="true"></span>
            ${opts.title ? `<h3 class="qc-sheet-title">${escapeHTML(opts.title)}</h3>` : ''}
            <div class="qc-sheet-body"></div>
        `;
        const body = sheet.querySelector('.qc-sheet-body');
        if (opts.html instanceof Node) body.appendChild(opts.html);
        else body.innerHTML = opts.html || '';

        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);
        requestAnimationFrame(() => {
            backdrop.classList.add('qc-sheet-in');
            sheet.classList.add('qc-sheet-in');
        });

        const close = () => {
            backdrop.classList.remove('qc-sheet-in');
            sheet.classList.remove('qc-sheet-in');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => { backdrop.remove(); sheet.remove(); if (typeof opts.onClose === 'function') opts.onClose(); }, 280);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        backdrop.addEventListener('click', close);
        document.addEventListener('keydown', onKey);
        return { close, body };
    }

    function qcChip(opts) {
        opts = opts || {};
        const variant = ['admin', 'staff', 'warning', 'danger'].includes(opts.variant) ? `qc-chip-${opts.variant}` : '';
        const label = escapeHTML(opts.label || '');
        const removable = opts.onRemove ? `<button type="button" class="qc-chip-remove" aria-label="Remove">&times;</button>` : '';
        return `<span class="qc-chip ${variant}">${label}${removable}</span>`;
    }

    global.qcToast = qcToast;
    global.qcConfirm = qcConfirm;
    global.qcAlert = qcAlert;
    global.qcSheet = qcSheet;
    global.qcChip = qcChip;
})(typeof window !== 'undefined' ? window : globalThis);
