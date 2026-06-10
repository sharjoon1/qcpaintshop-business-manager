/**
 * SYS-007 — CSS cache-busting transform.
 * Locks stampHtml: stamps a content-hash ?v= onto local /css/*.css link hrefs,
 * re-stamps existing versions without doubling, drops other queries, handles both
 * quote styles, and leaves CDN/unknown links untouched (idempotent).
 */
const { stampHtml, hashCssText } = require('../../scripts/stamp-css-version');

describe('hashCssText (line-ending independent — cross-env stable)', () => {
    test('CRLF and LF content hash identically', () => {
        expect(hashCssText('a {\r\n  color: red;\r\n}')).toBe(hashCssText('a {\n  color: red;\n}'));
    });
    test('returns 8 hex chars and differs for different content', () => {
        expect(hashCssText('body{}')).toMatch(/^[0-9a-f]{8}$/);
        expect(hashCssText('body{}')).not.toBe(hashCssText('body{color:red}'));
    });
});

const V = {
    '/css/tailwind.css': 'aaaa1111',
    '/css/design-system.css': 'bbbb2222',
    '/css/zoho-common.css': 'cccc3333',
};

describe('stampHtml (SYS-007)', () => {
    test('stamps an unversioned local css link', () => {
        expect(stampHtml('<link rel="stylesheet" href="/css/tailwind.css">', V))
            .toBe('<link rel="stylesheet" href="/css/tailwind.css?v=aaaa1111">');
    });

    test('re-stamps an already-versioned link without doubling', () => {
        expect(stampHtml('<link href="/css/tailwind.css?v=deadbeef">', V))
            .toBe('<link href="/css/tailwind.css?v=aaaa1111">');
    });

    test('drops any other query and stamps', () => {
        expect(stampHtml('<link href="/css/tailwind.css?foo=1&bar=2">', V))
            .toBe('<link href="/css/tailwind.css?v=aaaa1111">');
    });

    test('handles single quotes and multiple links (each its own hash)', () => {
        const inp = "<link href='/css/tailwind.css'><link href='/css/design-system.css'>";
        expect(stampHtml(inp, V))
            .toBe("<link href='/css/tailwind.css?v=aaaa1111'><link href='/css/design-system.css?v=bbbb2222'>");
    });

    test('leaves external CDN css (with /css/ mid-URL) untouched', () => {
        const inp = '<link href="https://cdnjs.cloudflare.com/ajax/libs/x/6.0.0/css/all.min.css">';
        expect(stampHtml(inp, V)).toBe(inp);
    });

    test('leaves a local css path with no known hash untouched', () => {
        expect(stampHtml('<link href="/css/unknown.css">', V)).toBe('<link href="/css/unknown.css">');
    });

    test('is idempotent for the same version map', () => {
        const once = stampHtml('<link href="/css/zoho-common.css">', V);
        expect(stampHtml(once, V)).toBe(once);
    });
});

// F2 — JS cache-busting: same content-hash scheme for local script src links.
const VJ = {
    ...V,
    '/js/auth-helper.js': 'dddd4444',
    '/js/qc-ui.js': 'eeee5555',
    '/universal-nav-loader.js': 'ffff6666',
};

describe('stampHtml — JS script src (F2)', () => {
    test('stamps an unversioned local /js/ script src', () => {
        expect(stampHtml('<script src="/js/auth-helper.js"></script>', VJ))
            .toBe('<script src="/js/auth-helper.js?v=dddd4444"></script>');
    });

    test('re-stamps an already-versioned script without doubling', () => {
        expect(stampHtml('<script src="/js/auth-helper.js?v=deadbeef"></script>', VJ))
            .toBe('<script src="/js/auth-helper.js?v=dddd4444"></script>');
    });

    test('stamps a known root-level script (universal-nav-loader)', () => {
        expect(stampHtml('<script src="/universal-nav-loader.js"></script>', VJ))
            .toBe('<script src="/universal-nav-loader.js?v=ffff6666"></script>');
    });

    test('leaves external CDN and unknown-path scripts untouched', () => {
        const cdn = '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.min.js"></script>';
        const sio = '<script src="/socket.io/socket.io.js"></script>';
        expect(stampHtml(cdn, VJ)).toBe(cdn);
        expect(stampHtml(sio, VJ)).toBe(sio);
    });

    test('stamps css href and js src together in one document', () => {
        const inp = '<link href="/css/tailwind.css"><script src="/js/qc-ui.js"></script>';
        expect(stampHtml(inp, VJ))
            .toBe('<link href="/css/tailwind.css?v=aaaa1111"><script src="/js/qc-ui.js?v=eeee5555"></script>');
    });

    test('a css-only map still leaves js src untouched (backward compatible)', () => {
        const inp = '<script src="/js/auth-helper.js"></script>';
        expect(stampHtml(inp, V)).toBe(inp);
    });
});
