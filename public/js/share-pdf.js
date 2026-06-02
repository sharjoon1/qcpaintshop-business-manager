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
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function notifyError(msg) {
        if (window.qcToast) { try { window.qcToast(msg, 'error'); return; } catch (e) {} }
        alert(msg);
    }

    window.qcSharePdf = async function (opts) {
        opts = opts || {};
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

        const file = new File([blob], filename, { type: 'application/pdf' });

        if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: shareTitle, text: shareText });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // user cancelled — do nothing
                console.warn('navigator.share failed, falling back:', e);
            }
        }

        // Fallback: download the PDF and open a wa.me text/link
        downloadBlob(blob, filename);
        let waUrl = null;
        if (typeof opts.getFallbackUrl === 'function') {
            try { waUrl = await opts.getFallbackUrl(); } catch (e) { /* ignore */ }
        }
        if (!waUrl) waUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText);
        window.open(waUrl, '_blank');
    };
})();
