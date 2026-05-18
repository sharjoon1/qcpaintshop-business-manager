module.exports = {
    up: async (pool) => {
        // Rename razorpay_order_id → zoho_payment_link_id
        const [col1] = await pool.query(`SHOW COLUMNS FROM payment_links LIKE 'razorpay_order_id'`);
        if (col1.length) {
            await pool.query(`ALTER TABLE payment_links
                CHANGE COLUMN razorpay_order_id zoho_payment_link_id VARCHAR(255) DEFAULT NULL,
                CHANGE COLUMN razorpay_payment_id zoho_payment_id VARCHAR(255) DEFAULT NULL`);
        }
        // Add link URL column
        const [col2] = await pool.query(`SHOW COLUMNS FROM payment_links LIKE 'zoho_payment_link_url'`);
        if (!col2.length) {
            await pool.query(`ALTER TABLE payment_links ADD COLUMN zoho_payment_link_url VARCHAR(1024) DEFAULT NULL`);
        }
        // Replace index
        const [idx] = await pool.query(`SHOW INDEX FROM payment_links WHERE Key_name = 'idx_razorpay_order'`);
        if (idx.length) {
            await pool.query(`ALTER TABLE payment_links DROP INDEX idx_razorpay_order`);
        }
        const [idx2] = await pool.query(`SHOW INDEX FROM payment_links WHERE Key_name = 'idx_zoho_link'`);
        if (!idx2.length) {
            await pool.query(`ALTER TABLE payment_links ADD INDEX idx_zoho_link (zoho_payment_link_id)`);
        }
    }
};
