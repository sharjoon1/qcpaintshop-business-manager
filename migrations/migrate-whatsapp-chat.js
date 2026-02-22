/**
 * Migration: WhatsApp Chat History
 * Creates whatsapp_messages + whatsapp_contacts tables for unified chat storage.
 * Backfills existing outbound messages from wa_instant_messages, wa_campaign_leads, whatsapp_followups.
 *
 * Run: node migrations/migrate-whatsapp-chat.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('[WhatsApp Chat Migration] Connected to database');

    // 1. whatsapp_messages table
    console.log('[1/4] Creating whatsapp_messages table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_messages (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            branch_id INT NOT NULL,
            phone_number VARCHAR(20) NOT NULL,
            direction ENUM('in','out') NOT NULL,
            message_type ENUM('text','image','document','audio','video','sticker','location','contact','unknown') DEFAULT 'text',
            body TEXT,
            media_url VARCHAR(500),
            media_mime_type VARCHAR(100),
            media_filename VARCHAR(255),
            caption TEXT,
            whatsapp_msg_id VARCHAR(100),
            status ENUM('pending','sent','delivered','read','failed') DEFAULT 'sent',
            sender_name VARCHAR(255),
            is_group TINYINT(1) DEFAULT 0,
            quoted_msg_id VARCHAR(100),
            timestamp DATETIME NOT NULL,
            is_read TINYINT(1) DEFAULT 0,
            sent_by INT,
            source ENUM('incoming','admin_reply','campaign','instant','followup','system') DEFAULT 'incoming',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_wm_branch_phone (branch_id, phone_number),
            KEY idx_wm_timestamp (timestamp),
            KEY idx_wm_wa_id (whatsapp_msg_id),
            KEY idx_wm_unread (branch_id, direction, is_read),
            FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
            FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ whatsapp_messages created');

    // 2. whatsapp_contacts table
    console.log('[2/4] Creating whatsapp_contacts table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_contacts (
            id INT PRIMARY KEY AUTO_INCREMENT,
            branch_id INT NOT NULL,
            phone_number VARCHAR(20) NOT NULL,
            pushname VARCHAR(255),
            saved_name VARCHAR(255),
            profile_pic_url VARCHAR(500),
            last_message_at DATETIME,
            unread_count INT DEFAULT 0,
            is_pinned TINYINT(1) DEFAULT 0,
            is_muted TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_wc_branch_phone (branch_id, phone_number),
            KEY idx_wc_last_msg (last_message_at),
            FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ whatsapp_contacts created');

    // 3. Permission
    console.log('[3/4] Adding zoho.whatsapp_chat permission...');
    try {
        // Check if permission exists
        const [existing] = await pool.query(
            `SELECT id FROM permissions WHERE module = 'zoho' AND action = 'whatsapp_chat'`
        );
        if (existing.length === 0) {
            const [result] = await pool.query(
                `INSERT INTO permissions (module, action, description) VALUES ('zoho', 'whatsapp_chat', 'View and reply to WhatsApp chat history')`
            );
            const permId = result.insertId;
            // Auto-assign to admin role
            const [adminRole] = await pool.query(`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`);
            if (adminRole.length > 0) {
                await pool.query(
                    `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
                    [adminRole[0].id, permId]
                );
            }
            console.log('   ✓ Permission added and assigned to admin');
        } else {
            console.log('   ✓ Permission already exists');
        }
    } catch (err) {
        console.log('   ⚠ Permission setup skipped:', err.message);
    }

    // 4. Backfill outbound messages (non-fatal, idempotent)
    console.log('[4/4] Backfilling outbound messages...');

    let backfilled = 0;

    // 4a. Backfill from wa_instant_messages
    try {
        const [hasTable] = await pool.query(`SHOW TABLES LIKE 'wa_instant_messages'`);
        if (hasTable.length > 0) {
            const [rows] = await pool.query(`
                SELECT wim.id, wim.phone, wim.message_content, wim.media_url, wim.media_type,
                       wim.media_caption, wim.branch_id, wim.status, wim.sent_at, wim.created_by, wim.created_at
                FROM wa_instant_messages wim
                WHERE wim.status IN ('sent','delivered','read')
                  AND wim.branch_id IS NOT NULL
            `);
            for (const row of rows) {
                const phone = normalizePhone(row.phone);
                if (!phone) continue;
                const ts = row.sent_at || row.created_at;

                // Check idempotency - skip if already backfilled
                const [dup] = await pool.query(
                    `SELECT id FROM whatsapp_messages WHERE source = 'instant' AND sent_by = ? AND phone_number = ? AND timestamp = ? LIMIT 1`,
                    [row.created_by, phone, ts]
                );
                if (dup.length > 0) continue;

                const msgType = row.media_type === 'image' ? 'image' : row.media_type === 'document' ? 'document' : 'text';
                await pool.query(`
                    INSERT INTO whatsapp_messages (branch_id, phone_number, direction, message_type, body, media_url, caption, status, timestamp, is_read, sent_by, source)
                    VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, 1, ?, 'instant')
                `, [row.branch_id, phone, msgType, row.message_content, row.media_url, row.media_caption, mapStatus(row.status), ts, row.created_by]);

                await upsertContact(pool, row.branch_id, phone, null, ts);
                backfilled++;
            }
            console.log(`   ✓ wa_instant_messages: ${backfilled} messages`);
        }
    } catch (err) {
        console.log('   ⚠ wa_instant_messages backfill skipped:', err.message);
    }

    // 4b. Backfill from wa_campaign_leads
    let campCount = 0;
    try {
        const [hasTable] = await pool.query(`SHOW TABLES LIKE 'wa_campaign_leads'`);
        if (hasTable.length > 0) {
            const [rows] = await pool.query(`
                SELECT wcl.phone, wcl.resolved_message, wcl.status, wcl.sent_at, wcl.created_at,
                       wc.branch_id, wc.created_by
                FROM wa_campaign_leads wcl
                JOIN wa_campaigns wc ON wcl.campaign_id = wc.id
                WHERE wcl.status IN ('sent','delivered','read')
                  AND wc.branch_id IS NOT NULL
            `);
            for (const row of rows) {
                const phone = normalizePhone(row.phone);
                if (!phone) continue;
                const ts = row.sent_at || row.created_at;

                const [dup] = await pool.query(
                    `SELECT id FROM whatsapp_messages WHERE source = 'campaign' AND phone_number = ? AND timestamp = ? AND branch_id = ? LIMIT 1`,
                    [phone, ts, row.branch_id]
                );
                if (dup.length > 0) continue;

                await pool.query(`
                    INSERT INTO whatsapp_messages (branch_id, phone_number, direction, message_type, body, status, timestamp, is_read, sent_by, source)
                    VALUES (?, ?, 'out', 'text', ?, ?, ?, 1, ?, 'campaign')
                `, [row.branch_id, phone, row.resolved_message, mapStatus(row.status), ts, row.created_by]);

                await upsertContact(pool, row.branch_id, phone, null, ts);
                campCount++;
            }
            console.log(`   ✓ wa_campaign_leads: ${campCount} messages`);
        }
    } catch (err) {
        console.log('   ⚠ wa_campaign_leads backfill skipped:', err.message);
    }

    // 4c. Backfill from whatsapp_followups
    let fuCount = 0;
    try {
        const [hasTable] = await pool.query(`SHOW TABLES LIKE 'whatsapp_followups'`);
        if (hasTable.length > 0) {
            // whatsapp_followups doesn't have branch_id — try to resolve from customer or default to first branch
            const [defaultBranch] = await pool.query(`SELECT id FROM branches ORDER BY id LIMIT 1`);
            const fallbackBranchId = defaultBranch.length > 0 ? defaultBranch[0].id : null;

            if (fallbackBranchId) {
                const [rows] = await pool.query(`
                    SELECT wf.phone, wf.message_body, wf.status, wf.sent_at, wf.created_at, wf.created_by, wf.customer_name
                    FROM whatsapp_followups wf
                    WHERE wf.status = 'sent'
                `);
                for (const row of rows) {
                    const phone = normalizePhone(row.phone);
                    if (!phone) continue;
                    const ts = row.sent_at || row.created_at;

                    const [dup] = await pool.query(
                        `SELECT id FROM whatsapp_messages WHERE source = 'followup' AND phone_number = ? AND timestamp = ? LIMIT 1`,
                        [phone, ts]
                    );
                    if (dup.length > 0) continue;

                    await pool.query(`
                        INSERT INTO whatsapp_messages (branch_id, phone_number, direction, message_type, body, status, timestamp, is_read, sent_by, source)
                        VALUES (?, ?, 'out', 'text', ?, 'sent', ?, 1, ?, 'followup')
                    `, [fallbackBranchId, phone, row.message_body, ts, row.created_by]);

                    await upsertContact(pool, fallbackBranchId, phone, row.customer_name, ts);
                    fuCount++;
                }
                console.log(`   ✓ whatsapp_followups: ${fuCount} messages`);
            }
        }
    } catch (err) {
        console.log('   ⚠ whatsapp_followups backfill skipped:', err.message);
    }

    console.log(`\n[WhatsApp Chat Migration] Complete! Backfilled ${backfilled + campCount + fuCount} messages total.`);
    await pool.end();
    process.exit(0);
}

function normalizePhone(phone) {
    if (!phone) return null;
    let normalized = phone.replace(/[^0-9]/g, '');
    if (normalized.length === 10) normalized = '91' + normalized;
    if (normalized.length < 10) return null;
    return normalized;
}

function mapStatus(status) {
    if (status === 'read') return 'read';
    if (status === 'delivered') return 'delivered';
    return 'sent';
}

async function upsertContact(pool, branchId, phone, name, lastMsgAt) {
    await pool.query(`
        INSERT INTO whatsapp_contacts (branch_id, phone_number, saved_name, last_message_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            last_message_at = GREATEST(COALESCE(last_message_at, '1970-01-01'), VALUES(last_message_at)),
            saved_name = COALESCE(saved_name, VALUES(saved_name))
    `, [branchId, phone, name, lastMsgAt]);
}

migrate().catch(err => {
    console.error('[WhatsApp Chat Migration] FAILED:', err.message);
    process.exit(1);
});
