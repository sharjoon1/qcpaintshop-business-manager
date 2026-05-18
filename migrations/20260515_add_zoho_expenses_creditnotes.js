module.exports = {
  up: async (pool) => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS zoho_expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        expense_id VARCHAR(100) NOT NULL UNIQUE,
        account_name VARCHAR(200),
        paid_through_account_name VARCHAR(200),
        vendor_name VARCHAR(200),
        date DATE,
        total DECIMAL(12,2) DEFAULT 0,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        description TEXT,
        status VARCHAR(50),
        currency_code VARCHAR(10) DEFAULT 'INR',
        reference_number VARCHAR(100),
        synced_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (date),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS zoho_credit_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        creditnote_id VARCHAR(100) NOT NULL UNIQUE,
        creditnote_number VARCHAR(100),
        customer_name VARCHAR(200),
        customer_id VARCHAR(100),
        date DATE,
        total DECIMAL(12,2) DEFAULT 0,
        balance DECIMAL(12,2) DEFAULT 0,
        status VARCHAR(50),
        currency_code VARCHAR(10) DEFAULT 'INR',
        synced_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (date),
        INDEX idx_customer (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
};
