/**
 * Shared HTML sanitizer for guide content (PAGE-103).
 *
 * Used by the write path (routes/guides.js POST/PUT) AND the backfill
 * (scripts/sanitize-guides.js) so they apply identical rules. Goal: stored guide HTML
 * can never carry <script>, on* event handlers, or javascript:/data: URLs. The staff
 * viewer additionally runs DOMPurify as a second layer.
 *
 * sanitize-html always strips on* attributes (never in an allowlist) and removes the
 * text of <script>/<style>/<textarea>/<option> (its default nonTextTags).
 */
const sanitizeHtml = require('sanitize-html');

// Reject CSS values that smuggle a dangerous function/scheme (url(...), expression(...),
// javascript:) while still allowing rgb()/hsl()/calc(), hex, named colours, sizes, etc.
const CSS_SAFE_VALUE = /^(?!.*(?:url|expression|javascript)\s*[(:]).*$/i;

// Safe inline-style subset (any property not listed is dropped from style="...").
const ALLOWED_STYLES = {
    '*': {
        'color': [CSS_SAFE_VALUE],
        'background-color': [CSS_SAFE_VALUE],
        'text-align': [/^(left|right|center|justify)$/],
        'font-size': [CSS_SAFE_VALUE],
        'font-weight': [CSS_SAFE_VALUE],
        'font-style': [CSS_SAFE_VALUE],
        'text-decoration': [CSS_SAFE_VALUE],
        'width': [CSS_SAFE_VALUE],
        'height': [CSS_SAFE_VALUE],
        'margin': [CSS_SAFE_VALUE],
        'padding': [CSS_SAFE_VALUE],
    },
};

const RICH_TEXT_TAGS = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'br', 'hr',
    'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
    'a', 'img', 'figure', 'figcaption', 'blockquote', 'code', 'pre',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
];

// Force rel=noopener on links that open a new tab.
function hardenAnchor(tagName, attribs) {
    if (attribs.target === '_blank') attribs.rel = 'noopener noreferrer';
    return { tagName, attribs };
}

// Rich-text fragment allowlist (the default content_type, rendered via innerHTML).
const RICH_TEXT = {
    allowedTags: RICH_TEXT_TAGS,
    allowedAttributes: {
        a: ['href', 'title', 'target', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan', 'scope'],
        col: ['span'],
        '*': ['class', 'style'],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: { a: hardenAnchor },
};

// Full-document mode: keep structural tags + inline style="" so docs still render, but strip
// <script>, <style> blocks, and every on* handler / javascript: URL. (Viewer also iframe-isolates
// this path, but we sanitize anyway as a second layer; inline styles via the style attribute remain.)
const FULL_HTML = {
    allowedTags: RICH_TEXT_TAGS.concat([
        'html', 'head', 'body', 'title',
        'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
    ]),
    allowedAttributes: {
        a: ['href', 'title', 'target', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan', 'scope'],
        col: ['span'],
        '*': ['class', 'style', 'id'],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: { a: hardenAnchor },
};

function sanitizeRichText(html) {
    if (html == null) return html;
    return sanitizeHtml(String(html), RICH_TEXT);
}

function sanitizeFullHtml(html) {
    if (html == null) return html;
    return sanitizeHtml(String(html), FULL_HTML);
}

/** Pick the sanitizer that matches a guide's content_type. */
function sanitizeGuideContent(html, contentType) {
    if (html == null) return html;
    return contentType === 'full_html' ? sanitizeFullHtml(html) : sanitizeRichText(html);
}

module.exports = { sanitizeRichText, sanitizeFullHtml, sanitizeGuideContent };
