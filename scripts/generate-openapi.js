#!/usr/bin/env node
/**
 * A12 — generate an OpenAPI 3.0 spec from the live route table.
 *
 * Statically scans server.js (inline app.METHOD routes + app.use mounts) and
 * every mounted routes/*.js module (router.METHOD routes), producing
 * docs/openapi.json. Auth requirements are inferred from the middleware names
 * on each route line (requireAuth / requirePermission('m','a') /
 * requirePainterAuth / requireCustomerAuth / ...) and recorded as x-auth /
 * x-permission extensions.
 *
 * Best-effort by design: routes registered with non-literal paths are counted
 * in `unparsed` rather than guessed. Regenerate after route changes:
 *   node scripts/generate-openapi.js          (writes docs/openapi.json)
 *   node scripts/generate-openapi.js --check  (exit 1 if file is stale)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const OUT = path.join(ROOT, 'docs', 'openapi.json');

const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

const AUTH_MIDDLEWARES = [
    'requireAuth', 'requireRole', 'requirePermission', 'requireAnyPermission',
    'requirePainterAuth', 'requirePainterSession',
    'requireCustomerAuth',
    'requireEngineerAuth', 'requireEngineerSession',
    'getUserPermissions',
];

function detectAuth(line) {
    const found = AUTH_MIDDLEWARES.filter(m => new RegExp(`\\b${m}\\b`).test(line));
    const perm = line.match(/requirePermission\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
    const role = line.match(/requireRole\(\s*([^)]*)\)/);
    return {
        auth: found.length ? found : ['public'],
        permission: perm ? `${perm[1]}.${perm[2]}` : undefined,
        roles: role ? role[1].replace(/['"\s]/g, '') : undefined,
    };
}

// Scan a JS source for <object>.METHOD('<literal path>', ...) registrations.
function scanRoutes(src, objectNames) {
    const routes = [];
    let unparsed = 0;
    const objAlt = objectNames.join('|');
    // [ \t]* (not \s*): \s would let ^ anchor on a BLANK line above and swallow
    // the newline, making the auth-detection line slice empty.
    const re = new RegExp(`^[ \\t]*(?:${objAlt})\\.(${METHODS.join('|')})\\(\\s*(['"\`])(.*?)\\2\\s*,`, 'gm');
    let m;
    while ((m = re.exec(src)) !== null) {
        const [, method, quote, routePath] = m;
        if (quote === '`' && routePath.includes('${')) { unparsed++; continue; }
        const lineEnd = src.indexOf('\n', m.index);
        const line = src.slice(m.index, lineEnd === -1 ? undefined : lineEnd);
        routes.push({ method: method.toUpperCase(), path: routePath, ...detectAuth(line) });
    }
    return { routes, unparsed };
}

// Parse server.js for `const X = require('./routes/y')` and ordered
// `app.use('<prefix>', [extraMw,] X.router|X)` mounts.
function parseMounts(serverSrc) {
    const requires = {};
    const reqRe = /^const\s+(?:\{[^}]*\}|(\w+))\s*=\s*require\('\.\/(routes\/[\w-]+)'\)/gm;
    let m;
    while ((m = reqRe.exec(serverSrc)) !== null) {
        if (m[1]) requires[m[1]] = m[2] + '.js';
    }
    const mounts = [];
    const useRe = /^app\.use\('([^']+)'\s*,\s*(?:(\w+)\s*,\s*)?(\w+)(\.router)?\s*\)/gm;
    while ((m = useRe.exec(serverSrc)) !== null) {
        const [, prefix, extraMw, varName] = m;
        const file = requires[varName];
        if (!file) continue; // not a route module (limiters, static, etc.)
        mounts.push({ prefix, file, extraAuth: extraMw && AUTH_MIDDLEWARES.includes(extraMw) ? extraMw : null });
    }
    return mounts;
}

function toOpenApiPath(p) {
    return p.replace(/:([A-Za-z_][\w]*)/g, '{$1}');
}

function pathParams(p) {
    const params = [];
    const re = /:([A-Za-z_][\w]*)/g;
    let m;
    while ((m = re.exec(p)) !== null) {
        params.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
    }
    return params;
}

function generate() {
    const serverSrc = fs.readFileSync(SERVER, 'utf8');

    const operations = []; // { method, path, tag, auth, permission, roles, source }
    let unparsedTotal = 0;

    // 1. server.js inline routes
    const inline = scanRoutes(serverSrc, ['app']);
    unparsedTotal += inline.unparsed;
    for (const r of inline.routes) {
        operations.push({ ...r, tag: 'server-inline', source: 'server.js' });
    }

    // 2. mounted route modules (in mount order — Express precedence)
    const mounts = parseMounts(serverSrc);
    for (const mount of mounts) {
        const filePath = path.join(ROOT, mount.file);
        if (!fs.existsSync(filePath)) continue;
        const src = fs.readFileSync(filePath, 'utf8');
        const { routes, unparsed } = scanRoutes(src, ['router']);
        unparsedTotal += unparsed;
        const tag = path.basename(mount.file, '.js');
        for (const r of routes) {
            const fullPath = (mount.prefix === '/' ? '' : mount.prefix) + (r.path === '/' ? '' : r.path) || '/';
            const auth = mount.extraAuth && r.auth.includes('public') ? [mount.extraAuth] : r.auth;
            operations.push({ ...r, path: fullPath, auth, tag, source: mount.file });
        }
    }

    // 3. assemble OpenAPI doc; first registration wins on collisions (Express order)
    const paths = {};
    let shadowed = 0;
    for (const op of operations) {
        const oaPath = toOpenApiPath(op.path);
        const method = op.method.toLowerCase();
        paths[oaPath] = paths[oaPath] || {};
        if (paths[oaPath][method]) { shadowed++; continue; }
        paths[oaPath][method] = {
            tags: [op.tag],
            summary: `${op.method} ${op.path}`,
            'x-source': op.source,
            'x-auth': op.auth,
            ...(op.permission ? { 'x-permission': op.permission } : {}),
            ...(op.roles ? { 'x-roles': op.roles } : {}),
            ...(pathParams(op.path).length ? { parameters: pathParams(op.path) } : {}),
            responses: { 200: { description: 'OK' } },
        };
    }

    const doc = {
        openapi: '3.0.3',
        info: {
            title: 'QC Business Manager API',
            description: 'Generated from the route table by scripts/generate-openapi.js (A12). '
                + 'x-auth lists the middleware gate(s); "public" = no auth middleware detected on the route line. '
                + 'Regenerate after route changes — do not edit by hand.',
            version: new Date().toISOString().slice(0, 10),
        },
        servers: [{ url: 'https://act.qcpaintshop.com' }],
        paths,
        'x-stats': {
            operations: operations.length - shadowed,
            shadowedDuplicates: shadowed,
            unparsedDynamicPaths: unparsedTotal,
            modules: mounts.length,
        },
    };
    return doc;
}

function stableStringify(doc) {
    return JSON.stringify(doc, null, 2) + '\n';
}

if (require.main === module) {
    const doc = generate();
    const json = stableStringify(doc);
    if (process.argv.includes('--check')) {
        const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
        // ignore the date-stamped version field when checking staleness
        const norm = s => s.replace(/"version": "[^"]*"/, '"version": "X"');
        if (norm(existing) !== norm(json)) {
            console.error('docs/openapi.json is stale — run: node scripts/generate-openapi.js');
            process.exit(1);
        }
        console.log('docs/openapi.json is up to date.');
        process.exit(0);
    }
    fs.writeFileSync(OUT, json);
    const s = doc['x-stats'];
    console.log(`docs/openapi.json written: ${s.operations} operations across ${Object.keys(doc.paths).length} paths`
        + ` (${s.modules} mounted modules, ${s.shadowedDuplicates} shadowed duplicates, ${s.unparsedDynamicPaths} unparsed dynamic paths)`);
}

module.exports = { generate, scanRoutes, parseMounts, toOpenApiPath };
