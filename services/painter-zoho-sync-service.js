'use strict';

let _pool, _zohoApi;

function init({ pool, zohoApi }) {
    _pool = pool;
    _zohoApi = zohoApi;
}

function _computeNextRetry(attempts) {
    const schedule = [60 * 60 * 1000, 4 * 60 * 60 * 1000, 12 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
    return schedule[Math.min(attempts, schedule.length) - 1] || 24 * 60 * 60 * 1000;
}

async function _queueFailure(pool, painterId, syncType, err) {
    const nextMs = _computeNextRetry(1);
    await pool.query(
        `INSERT INTO painter_zoho_sync_queue
            (painter_id, sync_type, status, attempts, last_error, next_retry_at)
         VALUES (?, ?, 'pending', 1, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [painterId, syncType, String(err.message || err).slice(0, 1000), Math.floor(nextMs / 1000)]
    );
}

async function syncPainterToZoho(painterId, ctx = {}) {
    const pool = ctx.pool || _pool;
    const zohoApi = ctx.zohoApi || _zohoApi;
    if (!pool || !zohoApi) throw new Error('syncPainterToZoho: pool/zohoApi not initialized');

    const [pRows] = await pool.query(`SELECT * FROM painters WHERE id = ? LIMIT 1`, [painterId]);
    if (!pRows.length) throw new Error(`Painter ${painterId} not found`);
    const painter = pRows[0];
    if (painter.zoho_customer_id && painter.zoho_salesperson_id) {
        return { skipped: true, reason: 'already_synced' };
    }

    let branch = null;
    if (painter.branch_id) {
        const [bRows] = await pool.query(
            `SELECT id, code, name, zoho_location_id FROM branches WHERE id = ? LIMIT 1`,
            [painter.branch_id]
        );
        branch = bRows[0] || null;
    }
    const branchCode = branch ? branch.code : 'GEN';
    const result = { painter_id: painterId };

    if (!painter.zoho_customer_id) {
        const [existing] = await pool.query(
            `SELECT zoho_contact_id FROM zoho_customers_map
             WHERE REPLACE(REPLACE(REPLACE(zoho_phone, ' ', ''), '-', ''), '+', '') LIKE ?
               AND zoho_contact_name LIKE '%PNTR%' LIMIT 1`,
            [`%${painter.phone}`]
        );
        if (existing.length) {
            await pool.query(`UPDATE painters SET zoho_customer_id = ? WHERE id = ?`, [existing[0].zoho_contact_id, painterId]);
            result.linked_existing_customer = existing[0].zoho_contact_id;
        } else {
            try {
                const zohoName = `PNTR ${branchCode} ${painter.full_name}`;
                const resp = await zohoApi.createContact({
                    contact_name: zohoName,
                    mobile: painter.phone,
                    email: painter.email || undefined,
                    custom_fields: [{ api_name: 'cf_painter_id', value: painter.id }]
                });
                const cid = resp && resp.contact && resp.contact.contact_id;
                if (!cid) throw new Error('Zoho createContact: no contact_id in response');
                await pool.query(`UPDATE painters SET zoho_customer_id = ? WHERE id = ?`, [cid, painterId]);
                await pool.query(
                    `INSERT INTO zoho_customers_map (zoho_contact_id, zoho_contact_name, zoho_phone, branch_id, last_synced_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE last_synced_at = NOW()`,
                    [cid, zohoName, painter.phone, painter.branch_id || null]
                );
                result.created_customer = cid;
            } catch (err) {
                await _queueFailure(pool, painterId, 'customer', err);
                return { queued: ['customer'], error: err.message };
            }
        }
    }

    if (!painter.zoho_salesperson_id) {
        const [existingSP] = await pool.query(
            `SELECT zoho_salesperson_id FROM painter_zoho_salesperson_map
             WHERE zoho_salesperson_phone = ? OR zoho_salesperson_name = ?
             LIMIT 1`,
            [painter.phone, `${painter.full_name} ${painter.phone}`]
        );
        if (existingSP.length) {
            await pool.query(
                `UPDATE painter_zoho_salesperson_map SET painter_id = ?, match_confidence='exact_phone'
                 WHERE zoho_salesperson_id = ?`,
                [painterId, existingSP[0].zoho_salesperson_id]
            );
            await pool.query(`UPDATE painters SET zoho_salesperson_id = ? WHERE id = ?`, [existingSP[0].zoho_salesperson_id, painterId]);
            result.linked_existing_salesperson = existingSP[0].zoho_salesperson_id;
        } else {
            try {
                const spName = `${painter.full_name} ${painter.phone}`;
                const resp = await zohoApi.createSalesperson({
                    salesperson_name: spName,
                    salesperson_email: painter.email || null
                });
                const spid = resp && resp.salesperson && resp.salesperson.salesperson_id;
                if (!spid) throw new Error('Zoho createSalesperson: no salesperson_id in response');
                await pool.query(`UPDATE painters SET zoho_salesperson_id = ? WHERE id = ?`, [spid, painterId]);
                await pool.query(
                    `INSERT INTO painter_zoho_salesperson_map
                        (zoho_salesperson_id, zoho_salesperson_name, zoho_salesperson_phone, painter_id, match_confidence)
                     VALUES (?, ?, ?, ?, 'exact_phone')
                     ON DUPLICATE KEY UPDATE painter_id = VALUES(painter_id)`,
                    [spid, spName, painter.phone, painterId]
                );
                result.created_salesperson = spid;
            } catch (err) {
                await _queueFailure(pool, painterId, 'salesperson', err);
                return { ...result, queued: ['salesperson'], error: err.message };
            }
        }
    }

    return result;
}

async function retryQueue(ctx = {}) {
    const pool = ctx.pool || _pool;
    const zohoApi = ctx.zohoApi || _zohoApi;
    if (!pool) throw new Error('retryQueue: pool missing');
    const [rows] = await pool.query(
        `SELECT id, painter_id, sync_type, attempts FROM painter_zoho_sync_queue
         WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY id ASC LIMIT 50`
    );
    const results = { processed: 0, completed: 0, failed: 0 };
    for (const row of rows) {
        results.processed++;
        await pool.query(`UPDATE painter_zoho_sync_queue SET status='processing' WHERE id=?`, [row.id]);
        try {
            await syncPainterToZoho(row.painter_id, { pool, zohoApi });
            await pool.query(
                `UPDATE painter_zoho_sync_queue SET status='completed', completed_at=NOW() WHERE id=?`,
                [row.id]
            );
            results.completed++;
        } catch (err) {
            const nextAttempts = row.attempts + 1;
            if (nextAttempts >= 5) {
                await pool.query(
                    `UPDATE painter_zoho_sync_queue SET status='failed', attempts=?, last_error=? WHERE id=?`,
                    [nextAttempts, String(err.message).slice(0, 1000), row.id]
                );
            } else {
                const backoffSec = Math.floor(_computeNextRetry(nextAttempts) / 1000);
                await pool.query(
                    `UPDATE painter_zoho_sync_queue SET status='pending', attempts=?, last_error=?,
                        next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=?`,
                    [nextAttempts, String(err.message).slice(0, 1000), backoffSec, row.id]
                );
            }
            results.failed++;
        }
    }
    return results;
}

module.exports = {
    init,
    syncPainterToZoho,
    retryQueue,
    _computeNextRetry
};
