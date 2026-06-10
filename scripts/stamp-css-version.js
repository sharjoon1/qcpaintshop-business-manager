#!/usr/bin/env node
/**
 * SYS-007 + F2 — CSS & JS cache-busting.
 *
 * Appends a content-hash query (?v=hash) to every local /css/*.css link href
 * and local /js/*.js (+ known root-level *.js) script src across the public
 * HTML pages (recursively), so deploying changed assets busts browser /
 * Android-WebView caches automatically (no manual hard-refresh). The hash is
 * derived from each file's content, so re-running with unchanged assets
 * produces NO diff (idempotent), and only links to a changed file get a new
 * version. sw.js is deliberately excluded (service-worker URL identity).
 *
 * Wired into `npm run build:css` (runs after the Tailwind build). Also runnable
 * standalone: `node scripts/stamp-css-version.js`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');
const JS_DIR = path.join(PUBLIC_DIR, 'js');

function hash8(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

/**
 * Hash CSS text line-ending-independently (CRLF normalized to LF) so the version
 * is identical regardless of the checkout's autocrlf setting — otherwise a Windows
 * dev (CRLF) and a Linux prod (LF) compute different hashes for the same committed
 * file, and prod's build re-stamps every page (dirty tree / pull conflicts).
 */
function hashCssText(text) {
    return hash8(Buffer.from(String(text).replace(/\r\n/g, '\n'), 'utf8'));
}

/**
 * Build { '/css/<file>.css': hash, '/js/<file>.js': hash, '/<root>.js': hash }
 * for every CSS file in public/css, every JS file in public/js, and the
 * root-level public/*.js page scripts (except sw.js — a service worker's URL
 * must stay stable for registration/update semantics).
 */
function buildVersionMap(cssDir = CSS_DIR, jsDir = JS_DIR, publicDir = PUBLIC_DIR) {
    const map = {};
    for (const f of fs.readdirSync(cssDir)) {
        if (f.endsWith('.css')) map['/css/' + f] = hashCssText(fs.readFileSync(path.join(cssDir, f), 'utf8'));
    }
    if (fs.existsSync(jsDir)) {
        for (const f of fs.readdirSync(jsDir)) {
            if (f.endsWith('.js')) map['/js/' + f] = hashCssText(fs.readFileSync(path.join(jsDir, f), 'utf8'));
        }
    }
    for (const f of fs.readdirSync(publicDir)) {
        if (f.endsWith('.js') && f !== 'sw.js') {
            map['/' + f] = hashCssText(fs.readFileSync(path.join(publicDir, f), 'utf8'));
        }
    }
    return map;
}

/**
 * Stamp ?v=<hash> onto every local /css/*.css link href and every local *.js
 * script src in the HTML.
 * - Only root-relative paths are touched (CDN/external left alone).
 * - Any existing query on the link is replaced (re-stamp, no doubling).
 * - A path with no known hash is left untouched (e.g. /socket.io/socket.io.js).
 */
function stampHtml(html, versionMap) {
    const sub = (full, pre, q, assetPath) => {
        const h = versionMap[assetPath];
        return h ? `${pre}${q}${assetPath}?v=${h}${q}` : full;
    };
    return html
        .replace(/(href\s*=\s*)(["'])(\/css\/[^"'?]+\.css)(?:\?[^"']*)?\2/gi, sub)
        .replace(/(src\s*=\s*)(["'])(\/[^"'?]+\.js)(?:\?[^"']*)?\2/gi, sub);
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
    console.log(`[stamp-assets] ${changed}/${files.length} HTML files updated (${Object.keys(versionMap).length} css/js assets versioned).`);
}

if (require.main === module) main();

module.exports = { stampHtml, buildVersionMap, hashCssText, hash8 };
