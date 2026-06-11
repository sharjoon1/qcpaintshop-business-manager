#!/usr/bin/env node
/**
 * A8 — route-order shadow analysis for router splits.
 *
 * When a big route file is split into sub-routers, routes get REORDERED.
 * Express matches in registration order, so two routes whose patterns can
 * match the same URL (e.g. GET /me vs GET /:id) MUST keep their relative
 * order, or requests silently change handlers.
 *
 * This checker compares the ordered route list of a BEFORE source (git ref)
 * with the concatenated ordered list of the AFTER sources (sub-router files
 * in their mount order) and reports every (method-compatible, pattern-
 * overlapping) pair whose relative order flipped.
 *
 * Overlap rule (Express 5, segment-wise): same segment count, and each
 * segment pair is compatible (equal literals, or at least one is a :param).
 * Wildcard/regex paths are flagged for manual review instead of guessed.
 *
 * Usage:
 *   node scripts/check-route-shadowing.js \
 *     --before HEAD:routes/painters.js \
 *     --after routes/painters/public.js,routes/painters/painter.js,routes/painters/admin.js
 * Exits 1 on any violation.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { scanRoutes } = require('./generate-openapi');

const ROOT = path.join(__dirname, '..');

function readSource(spec) {
    if (spec.includes(':')) {
        // git ref form REF:path
        return execFileSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    }
    return fs.readFileSync(path.join(ROOT, spec), 'utf8');
}

function routeList(specs) {
    const out = [];
    for (const spec of specs) {
        const { routes } = scanRoutes(readSource(spec), ['router', 'app']);
        for (const r of routes) out.push({ method: r.method, path: r.path, source: spec });
    }
    return out;
}

function isWild(p) {
    return /[*()+?]/.test(p.replace(/:[A-Za-z_]\w*/g, 'P'));
}

function overlaps(a, b) {
    if (a.method !== b.method) return false;
    const sa = a.path.split('/').filter(Boolean);
    const sb = b.path.split('/').filter(Boolean);
    if (sa.length !== sb.length) return false;
    for (let i = 0; i < sa.length; i++) {
        const pa = sa[i].startsWith(':');
        const pb = sb[i].startsWith(':');
        if (!pa && !pb && sa[i] !== sb[i]) return false;
    }
    return true;
}

function findOrderViolations(before, after) {
    // index of each route occurrence by method+path, in order
    const keyOf = r => `${r.method} ${r.path}`;
    const afterIndex = new Map();
    after.forEach((r, i) => {
        const k = keyOf(r);
        if (!afterIndex.has(k)) afterIndex.set(k, []);
        afterIndex.get(k).push(i);
    });
    // consume occurrences in order so duplicate paths map positionally
    const taken = new Map();
    const posAfter = before.map(r => {
        const k = keyOf(r);
        const list = afterIndex.get(k) || [];
        const n = taken.get(k) || 0;
        taken.set(k, n + 1);
        return list[n] !== undefined ? list[n] : null;
    });

    const violations = [];
    const missing = before.filter((r, i) => posAfter[i] === null).map(keyOf);
    const extra = after.length - before.length + missing.length;

    for (let i = 0; i < before.length; i++) {
        if (posAfter[i] === null) continue;
        for (let j = i + 1; j < before.length; j++) {
            if (posAfter[j] === null) continue;
            if (!overlaps(before[i], before[j])) continue;
            if (posAfter[i] > posAfter[j]) {
                violations.push({
                    first: `${keyOf(before[i])} (${after[posAfter[i]].source})`,
                    second: `${keyOf(before[j])} (${after[posAfter[j]].source})`,
                    note: 'overlapping pair flipped: the second now matches first',
                });
            }
        }
    }
    const wild = [...before, ...after].filter(r => isWild(r.path)).map(keyOf);
    return { violations, missing, extraCount: extra, wildcards: [...new Set(wild)] };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const beforeSpec = args[args.indexOf('--before') + 1];
    const afterSpecs = args[args.indexOf('--after') + 1].split(',');
    const before = routeList([beforeSpec]);
    const after = routeList(afterSpecs);
    const { violations, missing, extraCount, wildcards } = findOrderViolations(before, after);

    console.log(`before: ${before.length} routes (${beforeSpec})`);
    console.log(`after:  ${after.length} routes (${afterSpecs.length} files)`);
    if (missing.length) console.error(`MISSING in after: ${missing.join(' | ')}`);
    if (extraCount > 0) console.error(`EXTRA routes in after: ${extraCount}`);
    if (wildcards.length) console.warn(`wildcard/regex paths (review manually): ${wildcards.join(' | ')}`);
    if (violations.length) {
        console.error(`\n${violations.length} ORDER VIOLATION(S):`);
        for (const v of violations) console.error(`  - ${v.first}  must stay before  ${v.second}`);
    }
    if (violations.length || missing.length || extraCount > 0) process.exit(1);
    console.log('OK: no overlapping route pair changed relative order; route sets identical.');
}

module.exports = { findOrderViolations, overlaps, routeList };
