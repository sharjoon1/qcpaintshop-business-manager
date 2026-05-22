/**
 * migrate-whatsapp-idempotency
 *
 * Add a `sending_claimed_at` column to whatsapp_followups so the queue
 * processor can atomically reserve a row before calling sendMessage().
 *
 * Without this, the loop did:
 *   1. SELECT pending rows
 *   2. sendMessage()
 *   3. UPDATE status='sent'
 * If the process crashed between (2) and (3) the next cycle re-fetched
 * the same row and sent the message again. With the claim column we
 * reserve (status stays 'pending' but claim is set), then send, then
 * mark 'sent'. A crash leaves the row in {pending, claimed_at=X}; the
 * sweep at the top of each cycle reverts claims older than 15 min back
 * to NULL so they can be retried — at-least-once with dedupe.
 */

exports.up = async function up(pool) {
    // Idempotent column add
    const [cols] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'whatsapp_followups'
           AND COLUMN_NAME = 'sending_claimed_at'`
    );
    if (cols.length === 0) {
        await pool.query(
            `ALTER TABLE whatsapp_followups
             ADD COLUMN sending_claimed_at TIMESTAMP NULL DEFAULT NULL,
             ADD INDEX idx_wf_claim (status, sending_claimed_at)`
        );
        console.log('[migrate-whatsapp-idempotency] added sending_claimed_at column + index');
    } else {
        console.log('[migrate-whatsapp-idempotency] sending_claimed_at already present, skipping');
    }
};
