/**
 * WA ACK TRACKER (CM2)
 *
 * Turns a WhatsApp delivery/read receipt (message_ack) into marketing
 * Delivered/Read state + campaign counters.
 *
 * Design: conditional UPDATEs gated on affectedRows — NO SELECT-then-UPDATE
 * race, NO double counting, downgrade-proof by construction.
 *
 *   ack meaning: 2 = delivered, >=3 = read.
 *
 *   delivered upgrade:  wa_campaign_leads sent -> delivered  (bump delivered_count)
 *   read upgrade:       run the delivered upgrade FIRST (so a direct sent->read
 *                       skip still counts one delivery), then delivered -> read
 *                       (bump read_count).
 *
 * A repeat ack, a late lower ack (delivered after read), or an unknown id all
 * transition zero rows → zero counter bumps. wa_instant_messages is mirrored
 * for status/timestamps only (instant sends have no campaign counters).
 */

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} msgId   whatsapp_msg_id (_serialized)
 * @param {number} ack     2 = delivered, >=3 = read
 */
async function applyMarketingAck(pool, msgId, ack) {
    if (!pool || !msgId || !(ack >= 2)) return;

    // ── wa_campaign_leads (with campaign counters) ──────────────────────────
    // delivered upgrade: only a row currently 'sent' transitions → counted once.
    const [d] = await pool.query(
        `UPDATE wa_campaign_leads SET status = 'delivered', delivered_at = NOW()
          WHERE whatsapp_msg_id = ? AND status = 'sent'`,
        [msgId]
    );
    if (d && d.affectedRows > 0) {
        await pool.query(
            `UPDATE wa_campaigns c
               JOIN wa_campaign_leads wcl ON wcl.campaign_id = c.id
                SET c.delivered_count = c.delivered_count + 1
              WHERE wcl.whatsapp_msg_id = ?`,
            [msgId]
        );
    }

    if (ack >= 3) {
        const [r] = await pool.query(
            `UPDATE wa_campaign_leads SET status = 'read', read_at = NOW()
              WHERE whatsapp_msg_id = ? AND status = 'delivered'`,
            [msgId]
        );
        if (r && r.affectedRows > 0) {
            await pool.query(
                `UPDATE wa_campaigns c
                   JOIN wa_campaign_leads wcl ON wcl.campaign_id = c.id
                    SET c.read_count = c.read_count + 1
                  WHERE wcl.whatsapp_msg_id = ?`,
                [msgId]
            );
        }
    }

    // ── wa_instant_messages (statuses/timestamps only — no counters) ────────
    await pool.query(
        `UPDATE wa_instant_messages SET status = 'delivered', delivered_at = NOW()
          WHERE whatsapp_msg_id = ? AND status = 'sent'`,
        [msgId]
    );
    if (ack >= 3) {
        await pool.query(
            `UPDATE wa_instant_messages SET status = 'read', read_at = NOW()
              WHERE whatsapp_msg_id = ? AND status = 'delivered'`,
            [msgId]
        );
    }
}

module.exports = { applyMarketingAck };
