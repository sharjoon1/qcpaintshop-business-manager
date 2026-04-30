/* Reusable skeleton-loader + empty-state helpers.
 *
 * Pair with public/css/skeletons.css.
 *
 * Usage:
 *   container.innerHTML = qcSkeletonRows(3);                 // list rows
 *   container.innerHTML = qcSkeletonCards(4);                // card blocks
 *   container.innerHTML = qcSkeletonStats(4);                // stat tiles
 *   container.innerHTML = qcEmptyState({
 *       icon: 'inbox', title: 'No leads yet',
 *       message: 'Add your first lead to start tracking.',
 *       ctaText: 'Add Lead', ctaHref: '/admin-leads.html?new=1'
 *   });
 */
(function (global) {
    function qcSkeletonRows(count) {
        const n = Math.max(1, Math.min(count || 3, 12));
        const row = `
            <div class="qc-skel-row" aria-busy="true">
                <span class="qc-skel qc-skel-avatar"></span>
                <div class="qc-skel-lines">
                    <span class="qc-skel qc-skel-line qc-skel-line-md"></span>
                    <span class="qc-skel qc-skel-line qc-skel-line-sm"></span>
                </div>
            </div>`;
        return row.repeat(n);
    }

    function qcSkeletonCards(count) {
        const n = Math.max(1, Math.min(count || 3, 12));
        return `<span class="qc-skel qc-skel-card" aria-busy="true"></span>`.repeat(n);
    }

    function qcSkeletonStats(count) {
        const n = Math.max(1, Math.min(count || 4, 8));
        return `<span class="qc-skel qc-skel-stat" aria-busy="true"></span>`.repeat(n);
    }

    const ICONS = {
        inbox: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" class="qc-empty-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z"/></svg>',
        users: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" class="qc-empty-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>',
        document: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" class="qc-empty-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12L12 18m0 0l-3-3m3 3v-9m-9 7.5h2.25c1.243 0 2.25-1.007 2.25-2.25V5.25c0-1.243-1.007-2.25-2.25-2.25H4.5c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h7.5c.621 0 1.125-.504 1.125-1.125V19.5"/></svg>',
        search: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" class="qc-empty-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>'
    };

    function escapeHTML(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function qcEmptyState(opts) {
        opts = opts || {};
        const icon = ICONS[opts.icon] || ICONS.inbox;
        const title = escapeHTML(opts.title || 'Nothing here yet');
        const message = escapeHTML(opts.message || '');
        const variant = opts.variant === 'admin' ? 'qc-empty-cta-admin' : '';
        let cta = '';
        if (opts.ctaText && opts.ctaHref) {
            cta = `<a href="${escapeHTML(opts.ctaHref)}" class="qc-empty-cta ${variant}">${escapeHTML(opts.ctaText)}</a>`;
        } else if (opts.ctaText && opts.onClick) {
            const fn = String(opts.onClick).replace(/"/g, '&quot;');
            cta = `<button type="button" class="qc-empty-cta ${variant}" onclick="${fn}">${escapeHTML(opts.ctaText)}</button>`;
        }
        return `
            <div class="qc-empty" role="status">
                ${icon}
                <h3 class="qc-empty-title">${title}</h3>
                ${message ? `<p class="qc-empty-message">${message}</p>` : ''}
                ${cta}
            </div>
        `;
    }

    global.qcSkeletonRows = qcSkeletonRows;
    global.qcSkeletonCards = qcSkeletonCards;
    global.qcSkeletonStats = qcSkeletonStats;
    global.qcEmptyState = qcEmptyState;
})(typeof window !== 'undefined' ? window : globalThis);
