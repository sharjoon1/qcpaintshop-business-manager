/**
 * One-off backfill: re-sanitize existing guide content (PAGE-103).
 *
 *   node scripts/sanitize-guides.js            # DRY-RUN (default) — reports what would change, no writes
 *   node scripts/sanitize-guides.js --apply    # writes sanitized content (run only after reviewing dry-run)
 *
 * Re-applies services/html-sanitizer to guides.content_en/content_ta and
 * guide_versions.content_en/content_ta (versions use their parent guide's content_type), so the
 * same rules used on write also clean pre-existing rows. Parameterized writes inside a transaction.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { sanitizeGuideContent } = require('../services/html-sanitizer');

const APPLY = process.argv.includes('--apply');
const COLS = ['content_en', 'content_ta'];

function diffRows(rows) {
    const changes = [];
    for (const r of rows) {
        const ctype = r.content_type || 'rich_text';
        for (const col of COLS) {
            const before = r[col];
            if (before == null) continue;
            const after = sanitizeGuideContent(before, ctype);
            if (after !== before) changes.push({ id: r.id, col, before, after });
        }
    }
    return changes;
}

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'qc_business_manager',
        port: process.env.DB_PORT || 3306,
    });
    try {
        const [guides] = await pool.query('SELECT id, content_type, content_en, content_ta FROM guides');
        const [versions] = await pool.query(
            `SELECT gv.id, g.content_type, gv.content_en, gv.content_ta
               FROM guide_versions gv JOIN guides g ON gv.guide_id = g.id`
        );

        const guideChanges = diffRows(guides);
        const versionChanges = diffRows(versions);

        console.log(`[sanitize-guides] guides: ${guides.length} rows, ${guideChanges.length} field(s) would change`);
        console.log(`[sanitize-guides] guide_versions: ${versions.length} rows, ${versionChanges.length} field(s) would change`);

        for (const c of guideChanges.concat(versionChanges).slice(0, 5)) {
            console.log(`\n  id=${c.id} ${c.col}`);
            console.log(`    before: ${String(c.before).replace(/\s+/g, ' ').slice(0, 160)}`);
            console.log(`    after : ${String(c.after).replace(/\s+/g, ' ').slice(0, 160)}`);
        }

        if (!APPLY) {
            console.log('\n[sanitize-guides] DRY-RUN — nothing written. Re-run with --apply to persist.');
            return;
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const c of guideChanges) {
                await conn.query(`UPDATE guides SET ${c.col} = ? WHERE id = ?`, [c.after, c.id]);
            }
            for (const c of versionChanges) {
                await conn.query(`UPDATE guide_versions SET ${c.col} = ? WHERE id = ?`, [c.after, c.id]);
            }
            await conn.commit();
            console.log(`\n[sanitize-guides] APPLIED — ${guideChanges.length} guide field(s) + ${versionChanges.length} version field(s) updated.`);
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    } finally {
        await pool.end();
    }
}

main().catch(e => { console.error('[sanitize-guides] error:', e); process.exit(1); });
