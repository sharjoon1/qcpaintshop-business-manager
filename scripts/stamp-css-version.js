#!/usr/bin/env node
/**
 * SYS-007 — CSS cache-busting.
 *
 * Appends a content-hash query (?v=hash) to every local /css/ *.css link href
 * across the public HTML pages (recursively), so deploying changed CSS busts
 * browser / Android-WebView caches automatically (no manual hard-refresh). The
 * hash is derived from each CSS
 * file's content, so re-running with unchanged CSS produces NO diff (idempotent),
 * and only the links to a changed stylesheet get a new version.
 *
 * Wired into `npm run build:css` (runs after the Tailwind build). Also runnable
 * standalone: `node scripts/stamp-css-version.js`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');

function hash8(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

/** Build { '/css/<file>.css': '<hash8>' } for every CSS file in public/css. */
function buildVersionMap(cssDir = CSS_DIR) {
    const map = {};
    for (const f of fs.readdirSync(cssDir)) {
        if (f.endsWith('.css')) map['/css/' + f] = hash8(fs.readFileSync(path.join(cssDir, f)));
    }
    return map;
}

/**
 * Stamp ?v=<hash> onto every local /css/*.css link href in the HTML.
 * - Only root-relative /css/ links are touched (CDN/external left alone).
 * - Any existing query on the link is replaced (re-stamp, no doubling).
 * - A /css/ path with no known hash is left untouched.
 */
function stampHtml(html, versionMap) {
    return html.replace(
        /(href\s*=\s*)(["'])(\/css\/[^"'?]+\.css)(?:\?[^"']*)?\2/gi,
        (full, pre, q, cssPath) => {
            const h = versionMap[cssPath];
            return h ? `${pre}${q}${cssPath}?v=${h}${q}` : full;
        }
    );
}

function walkHtml(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) walkHtml(fp, out);
        else if (entry.isFile() && entry.name.endsWith('.html')) out.push(fp);
    }
    return out;
}

function main() {
    const versionMap = buildVersionMap();
    const files = walkHtml(PUBLIC_DIR);
    let changed = 0;
    for (const f of files) {
        const before = fs.readFileSync(f, 'utf8');
        const after = stampHtml(before, versionMap);
        if (after !== before) { fs.writeFileSync(f, after); changed++; }
    }
    console.log(`[stamp-css] ${changed}/${files.length} HTML files updated. Versions: ${JSON.stringify(versionMap)}`);
}

if (require.main === module) main();

module.exports = { stampHtml, buildVersionMap, hash8 };
