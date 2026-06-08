/**
 * Characterization tests for the guide HTML sanitizer (PAGE-103).
 * Locks the allowlist: strips script / on* handlers / javascript: URLs while preserving
 * legitimate formatting. These rules are applied on write AND in the backfill, so a change
 * here is a deliberate, visible diff.
 */
const { sanitizeRichText, sanitizeGuideContent } = require('../../services/html-sanitizer');

describe('html-sanitizer — security (rich_text)', () => {
    test('strips on* event handlers but keeps the element', () => {
        const out = sanitizeRichText('<img src="https://x.com/a.png" onerror="alert(1)" alt="a">');
        expect(out).not.toMatch(/onerror/i);
        expect(out).toMatch(/<img/);
        expect(out).toMatch(/alt="a"/);
    });

    test('removes <script> and its text', () => {
        const out = sanitizeRichText('<p>hi</p><script>alert(1)</script>');
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toMatch(/alert\(1\)/);
        expect(out).toMatch(/<p>hi<\/p>/);
    });

    test('drops javascript: href scheme', () => {
        const out = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
        expect(out).not.toMatch(/javascript:/i);
    });

    test('drops data: image scheme', () => {
        const out = sanitizeRichText('<img src="data:text/html,<script>alert(1)</script>">');
        expect(out).not.toMatch(/data:/i);
    });

    test('strips <iframe>', () => {
        const out = sanitizeRichText('<iframe src="https://evil.com"></iframe><p>ok</p>');
        expect(out).not.toMatch(/<iframe/i);
        expect(out).toMatch(/<p>ok<\/p>/);
    });

    test('drops dangerous CSS function values but keeps safe colours', () => {
        expect(sanitizeRichText('<p style="background-color:url(javascript:alert(1))">x</p>')).not.toMatch(/url\(/i);
        expect(sanitizeRichText('<p style="width:expression(alert(1))">x</p>')).not.toMatch(/expression/i);
        const safe = sanitizeRichText('<p style="color:rgb(255,0,0)">x</p>');
        expect(safe).toMatch(/color:rgb\(255, ?0, ?0\)/);
    });
});

describe('html-sanitizer — preserves legitimate content', () => {
    test('keeps headings, bold, links, images, tables', () => {
        const html = '<h2>Title</h2><p><strong>bold</strong> <a href="https://x.com">link</a></p>' +
            '<img src="https://x.com/a.png" alt="a"><table><tbody><tr><td>c</td></tr></tbody></table>';
        const out = sanitizeRichText(html);
        expect(out).toMatch(/<h2>Title<\/h2>/);
        expect(out).toMatch(/<strong>bold<\/strong>/);
        expect(out).toMatch(/href="https:\/\/x\.com"/);
        expect(out).toMatch(/src="https:\/\/x\.com\/a\.png"/);
        expect(out).toMatch(/<td>c<\/td>/);
    });

    test('adds rel=noopener on target=_blank links', () => {
        const out = sanitizeRichText('<a href="https://x.com" target="_blank">x</a>');
        expect(out).toMatch(/rel="noopener noreferrer"/);
    });
});

describe('html-sanitizer — content_type routing', () => {
    test('sanitizes rich_text but leaves full_html intact (iframe-isolated)', () => {
        const withScript = '<p>ok</p><script>bad()</script>';
        expect(sanitizeGuideContent(withScript, 'rich_text')).not.toMatch(/<script/i);
        expect(sanitizeGuideContent(withScript, undefined)).not.toMatch(/<script/i);
        // full_html renders ONLY in a sandboxed iframe (no allow-scripts) -> returned unchanged,
        // so its <!doctype>/<meta charset> (e.g. for Tamil) survive.
        expect(sanitizeGuideContent(withScript, 'full_html')).toBe(withScript);
        const doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>தமிழ்</body></html>';
        expect(sanitizeGuideContent(doc, 'full_html')).toBe(doc);
    });

    test('passes through null / undefined unchanged', () => {
        expect(sanitizeRichText(null)).toBeNull();
        expect(sanitizeRichText(undefined)).toBeUndefined();
        expect(sanitizeGuideContent(null, 'rich_text')).toBeNull();
    });
});
