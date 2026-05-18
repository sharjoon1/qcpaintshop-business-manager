module.exports = {
    up: async (pool) => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_links (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_id VARCHAR(100) NOT NULL,
                zoho_invoice_number VARCHAR(100),
                customer_name VARCHAR(200),
                customer_phone VARCHAR(20),
                amount DECIMAL(12,2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'INR',
                razorpay_order_id VARCHAR(100),
                razorpay_payment_id VARCHAR(100),
                status ENUM('created','paid','failed','expired') DEFAULT 'created',
                expires_at DATETIME,
                paid_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_invoice (invoice_id),
                INDEX idx_status (status),
                INDEX idx_razorpay_order (razorpay_order_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
