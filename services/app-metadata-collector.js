/**
 * App Metadata Collector — scans database schema, routes, errors, health, business stats
 * Used by AI App Analyzer to provide context for code-generation prompts
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let pool = null;
let _scanCache = null;
let _scanCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function setPool(p) { pool = p; }

// ═══════════════════════════════════════════════════════════════
// 1. DATABASE SCHEMA SCANNER
// ═══════════════════════════════════════════════════════════════
async function collectDatabaseSchema() {
    const [tablesRaw] = await pool.query('SHOW TABLES');
    const dbKey = Object.keys(tablesRaw[0])[0];
    const tableNames = tablesRaw.map(r => r[dbKey]);

    const tables = [];
    for (const name of tableNames) {
        try {
            const [columns] = await pool.query(`DESCRIBE \`${name}\``);
            const [indexes] = await pool.query(`SHOW INDEX FROM \`${name}\``);
            const [countRow] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${name}\``);
            const rowCount = countRow[0].cnt;

            // Auto-detect issues
            const issues = [];
            const indexedCols = new Set(indexes.map(i => i.Column_name));

            for (const col of columns) {
                // Check for _id columns missing indexes
                if (col.Field.endsWith('_id') && !indexedCols.has(col.Field)) {
                    issues.push({ type: 'missing_index', column: col.Field, severity: 'warning', message: `Column '${col.Field}' looks like a FK but has no index` });
                }
            }

            // Check for missing updated_at
            const hasUpdatedAt = columns.some(c => c.Field === 'updated_at');
            const hasCreatedAt = columns.some(c => c.Field === 'created_at');
            if (hasCreatedAt && !hasUpdatedAt && rowCount > 0) {
                issues.push({ type: 'missing_updated_at', severity: 'info', message: 'Has created_at but no updated_at column' });
            }

            // Empty tables
            if (rowCount === 0) {
                issues.push({ type: 'empty_table', severity: 'info', message: 'Table is empty' });
            }

            // Large tables
            if (rowCount > 100000) {
                issues.push({ type: 'large_table', severity: 'warning', message: `Table has ${rowCount.toLocaleString()} rows — consider partitioning or archiving` });
            }

            tables.push({
                name,
                columns: columns.map(c => ({ field: c.Field, type: c.Type, nullable: c.Null === 'YES', key: c.Key, default: c.Default })),
                indexes: indexes.map(i => ({ name: i.Key_name, column: i.Column_name, unique: !i.Non_unique })),
                rowCount,
                issues
            });
        } catch (e) {
            tables.push({ name, error: e.message, columns: [], indexes: [], rowCount: 0, issues: [] });
        }
    }

    return { tables, totalTables: tables.length, totalIssues: tables.reduce((sum, t) => sum + t.issues.length, 0) };
}

// ═══════════════════════════════════════════════════════════════
// 2. ROUTE MAP SCANNER
// ═══════════════════════════════════════════════════════════════
function collectRouteMap() {
    const rootDir = path.join(__dirname, '..');
    const routes = [];

    // Parse server.js for app.use mount points
    const serverPath = path.join(rootDir, 'server.js');
    const serverCode = fs.readFileSync(serverPath, 'utf-8');

    // Extract app.use('/api/...', xxxRoutes.router) mounts
    const mountRegex = /app\.use\(['"]([^'"]+)['"]\s*,\s*(\w+)\.router\)/g;
    const mounts = {};
    let match;
    while ((match = mountRegex.exec(serverCode)) !== null) {
        mounts[match[2]] = match[1];
    }

    // Also extract inline routes from server.js: app.get/post/put/delete(...)
    const inlineRegex = /app\.(get|post|put|delete)\(['"]([^'"]+)['"]/g;
    while ((match = inlineRegex.exec(serverCode)) !== null) {
        routes.push({ method: match[1].toUpperCase(), path: match[2], file: 'server.js' });
    }

    // Scan route files
    const routesDir = path.join(rootDir, 'routes');
    if (fs.existsSync(routesDir)) {
        const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            try {
                const code = fs.readFileSync(path.join(routesDir, file), 'utf-8');
                const routeRegex = /router\.(get|post|put|delete)\(['"]([^'"]+)['"]/g;
                const varName = Object.keys(mounts).find(k => {
                    // Match variable name to file (e.g., aiRoutes → ai.js, paintersRoutes → painters.js)
                    const normalized = k.replace(/Routes?$/i, '').toLowerCase();
                    const fileBase = file.replace('.js', '').replace(/-/g, '');
                    return normalized === fileBase || k.toLowerCase().includes(fileBase);
                });
                const prefix = varName ? mounts[varName] : '';

                while ((match = routeRegex.exec(code)) !== null) {
                    routes.push({ method: match[1].toUpperCase(), path: prefix + match[2], file: 'routes/' + file });
                }
            } catch (e) { /* skip unreadable files */ }
        }
    }

    const byMethod = {};
    routes.forEach(r => { byMethod[r.method] = (byMethod[r.method] || 0) + 1; });

    return { routes, totalCount: routes.length, byMethod };
}

// ═══════════════════════════════════════════════════════════════
// 3. RECENT ERRORS SCANNER
// ═══════════════════════════════════════════════════════════════
function collectRecentErrors() {
    const errors = [];
    const errorCounts = {};

    // Read from in-memory error buffer
    const buffer = global._appErrorBuffer || [];
    for (const entry of buffer) {
        const key = entry.message || 'Unknown error';
        if (!errorCounts[key]) {
            errorCounts[key] = { message: key, count: 0, lastSeen: entry.timestamp, stack: entry.stack || '' };
        }
        errorCounts[key].count++;
        if (entry.timestamp > errorCounts[key].lastSeen) {
            errorCounts[key].lastSeen = entry.timestamp;
        }
    }

    // Try PM2 error log
    const pm2LogPaths = [
        path.join(os.homedir(), '.pm2', 'logs', 'business-manager-error.log'),
        '/root/.pm2/logs/business-manager-error.log'
    ];

    for (const logPath of pm2LogPaths) {
        try {
            if (fs.existsSync(logPath)) {
                const content = fs.readFileSync(logPath, 'utf-8');
                const lines = content.split('\n').slice(-200); // last 200 lines
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('at ')) continue;
                    const key = trimmed.substring(0, 200);
                    if (!errorCounts[key]) {
                        errorCounts[key] = { message: key, count: 0, lastSeen: new Date().toISOString(), stack: '' };
                    }
                    errorCounts[key].count++;
                }
                break; // only read first found log
            }
        } catch (e) { /* skip */ }
    }

    // Sort by count descending
    return {
        errors: Object.values(errorCounts).sort((a, b) => b.count - a.count).slice(0, 50),
        totalUniqueErrors: Object.keys(errorCounts).length,
        bufferSize: buffer.length
    };
}

// ═══════════════════════════════════════════════════════════════
// 4. HEALTH METRICS
// ═══════════════════════════════════════════════════════════════
async function collectHealthMetrics() {
    const mem = process.memoryUsage();
    let dbConnected = false;

    try {
        await pool.query('SELECT 1');
        dbConnected = true;
    } catch (e) { /* db down */ }

    return {
        memory: {
            rss: (mem.rss / 1024 / 1024).toFixed(1) + ' MB',
            heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(1) + ' MB',
            heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(1) + ' MB',
            external: (mem.external / 1024 / 1024).toFixed(1) + ' MB'
        },
        uptime: {
            seconds: Math.floor(process.uptime()),
            formatted: formatUptime(process.uptime())
        },
        os: {
            platform: os.platform(),
            loadAvg: os.loadavg().map(l => l.toFixed(2)),
            freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            totalMem: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            cpus: os.cpus().length
        },
        dbConnected,
        nodeVersion: process.version
    };
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    parts.push(m + 'm');
    return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════════
// 5. BUSINESS STATS
// ═══════════════════════════════════════════════════════════════
async function collectBusinessStats() {
    const counts = {};

    const countQueries = [
        ['users', 'SELECT COUNT(*) as cnt FROM users'],
        ['branches', 'SELECT COUNT(*) as cnt FROM branches'],
        ['leads', 'SELECT COUNT(*) as cnt FROM leads'],
        ['painters', 'SELECT COUNT(*) as cnt FROM painters'],
        ['painter_estimates', 'SELECT COUNT(*) as cnt FROM painter_estimates'],
        ['wa_sessions', 'SELECT COUNT(*) as cnt FROM whatsapp_sessions'],
        ['ai_conversations', 'SELECT COUNT(*) as cnt FROM ai_conversations'],
        ['ai_insights', 'SELECT COUNT(*) as cnt FROM ai_insights'],
    ];

    for (const [key, query] of countQueries) {
        try {
            const [rows] = await pool.query(query);
            counts[key] = rows[0].cnt;
        } catch (e) {
            counts[key] = -1; // table may not exist
        }
    }

    // Top 5 largest tables
    const [tablesRaw] = await pool.query('SHOW TABLES');
    const dbKey = Object.keys(tablesRaw[0])[0];
    const tableNames = tablesRaw.map(r => r[dbKey]);

    const tableSizes = [];
    for (const name of tableNames) {
        try {
            const [rows] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${name}\``);
            tableSizes.push({ name, rowCount: rows[0].cnt });
        } catch (e) { /* skip */ }
    }
    tableSizes.sort((a, b) => b.rowCount - a.rowCount);

    return {
        counts,
        largeTables: tableSizes.slice(0, 10)
    };
}

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
async function runFullScan() {
    // Return cached result if fresh
    if (_scanCache && (Date.now() - _scanCacheTime) < CACHE_TTL) {
        return { ..._scanCache, cached: true };
    }

    const start = Date.now();
    const results = await Promise.allSettled([
        collectDatabaseSchema(),
        Promise.resolve(collectRouteMap()),
        Promise.resolve(collectRecentErrors()),
        collectHealthMetrics(),
        collectBusinessStats()
    ]);

    const scanData = {
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - start,
        database: results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message },
        routes: results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message },
        errors: results[2].status === 'fulfilled' ? results[2].value : { error: results[2].reason?.message },
        health: results[3].status === 'fulfilled' ? results[3].value : { error: results[3].reason?.message },
        business: results[4].status === 'fulfilled' ? results[4].value : { error: results[4].reason?.message },
        cached: false
    };

    _scanCache = scanData;
    _scanCacheTime = Date.now();

    return scanData;
}

module.exports = { setPool, runFullScan, collectDatabaseSchema, collectRouteMap, collectRecentErrors, collectHealthMetrics, collectBusinessStats };
