/**
 * share-pdf.js
 * Share a PDF (estimate / PO) via the phone's own WhatsApp using the Web Share API.
 * Falls back to downloading the PDF + opening a wa.me text link when file-share
 * is unsupported (desktop browsers, old WebViews).
 *
 *   qcSharePdf({
 *     pdfUrl,          // string  — URL to fetch the PDF from
 *     headers,         // object  — request headers (e.g. Authorization); optional
 *     filename,        // string  — download/share filename
 *     shareTitle,      // string  — share-sheet title
 *     shareText,       // string  — message body
 *     getFallbackUrl   // async fn -> string (optional; called ONLY on fallback)
 *   })
 */
(function () {
    function clickAnchor(href, opts) {
        const a = document.createElement('a');
        a.href = href;
        if (opts && opts.download) a.download = opts.download;
        if (opts && opts.newTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        clickAnchor(url, { download: filename });
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function notifyError(msg) {
        if (window.qcToast) { try { window.qcToast(msg, { variant: 'error' }); return; } catch (e) { /* fall through to alert */ } }
        alert(msg);
    }

    window.qcSharePdf = async function (opts) {
        opts = opts || {};
        if (!opts.pdfUrl) { notifyError('No PDF URL provided.'); return; }
        const filename = opts.filename || 'document.pdf';
        const shareTitle = opts.shareTitle || 'Quality Colours';
        const shareText = opts.shareText || '';

        let blob;
        try {
            const resp = await fetch(opts.pdfUrl, { headers: opts.headers || {} });
            if (!resp.ok) throw new Error('PDF fetch failed: ' + resp.status);
            blob = await resp.blob();
        } catch (e) {
            console.error('qcSharePdf fetch error:', e);
            notifyError('Could not load the PDF. Please try again.');
            return;
        }

        // Native file share where supported (mobile browsers / PWA).
        try {
            if (typeof File !== 'undefined' && navigator.canShare && navigator.share) {
                const file = new File([blob], filename, { type: 'application/pdf' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: shareTitle, text: shareText });
                    return;
                }
            }
        } catch (e) {
            if (e && e.name === 'AbortError') return; // user cancelled — do nothing
            console.warn('navigator.share failed, falling back:', e);
        }

        // Fallback (desktop / old WebView): download the PDF + open a wa.me link.
        // Use an anchor click (not window.open) so it survives the async gap without
        // tripping the popup blocker, and isolates the opener.
        downloadBlob(blob, filename);
        let waUrl = null;
        if (typeof opts.getFallbackUrl === 'function') {
            try { waUrl = await opts.getFallbackUrl(); } catch (e) { /* ignore */ }
        }
        if (waUrl && !/^https?:\/\//i.test(waUrl)) waUrl = null; // reject non-http(s) (e.g. javascript:)
        if (!waUrl) waUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText);
        clickAnchor(waUrl, { newTab: true });
    };
})();
