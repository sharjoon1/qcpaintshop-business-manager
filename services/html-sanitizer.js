/**
 * HTML sanitizer for guide content (PAGE-103).
 *
 * Used by the write path (routes/guides.js POST/PUT) AND the backfill
 * (scripts/sanitize-guides.js) so they apply identical rules.
 *
 * Only `rich_text` guides are sanitized: they are injected into the parent page via
 * `content.innerHTML` (public/staff/guides.html), so inline on* handlers would execute.
 * `full_html` guides are rendered ONLY inside a sandboxed iframe WITHOUT `allow-scripts`,
 * where no <script>/handler/javascript: URL can run — so they are left intact (sanitizing them
 * server-side strips <!doctype>/<meta charset> and corrupts the document, e.g. Tamil charset).
 *
 * sanitize-html always strips on* attributes (never in an allowlist) and removes the text of
 * <script>/<style>/<textarea>/<option> (its default nonTextTags).
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

// Rich-text fragment allowlist (the default content_type, rendered via innerHTML).
const RICH_TEXT = {
    allowedTags: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'br', 'hr',
        'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
        'a', 'img', 'figure', 'figcaption', 'blockquote', 'code', 'pre',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
    ],
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
    transformTags: {
        // Force rel=noopener on links that open a new tab.
        a: (tagName, attribs) => {
            if (attribs.target === '_blank') attribs.rel = 'noopener noreferrer';
            return { tagName, attribs };
        },
    },
};

function sanitizeRichText(html) {
    if (html == null) return html;
    return sanitizeHtml(String(html), RICH_TEXT);
}

/**
 * Sanitize a guide's stored content. `rich_text` (innerHTML sink) is sanitized; `full_html`
 * (sandboxed-iframe, no allow-scripts) is left untouched to preserve its document structure.
 */
function sanitizeGuideContent(html, contentType) {
    if (html == null) return html;
    return contentType === 'full_html' ? html : sanitizeRichText(html);
}

module.exports = { sanitizeRichText, sanitizeGuideContent };
