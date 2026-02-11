const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager',
    multipleStatements: true
};

async function createSettingsTable() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        // Create settings table
        console.log('\n📊 Creating settings table...');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id INT PRIMARY KEY AUTO_INCREMENT,
                setting_key VARCHAR(100) NOT NULL UNIQUE,
                setting_value TEXT,
                category VARCHAR(50) DEFAULT 'general',
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_key (setting_key),
                INDEX idx_category (category)
            )
        `);

        console.log('  ✓ Settings table created');

        // Insert default settings
        console.log('\n⚙️ Inserting default settings...');

        const defaultSettings = [
            ['business_name', 'Quality Colours (குவாலிட்டி கலர்ஸ்)', 'business', 'Business name'],
            ['business_type', 'both', 'business', 'Business type: retail, wholesale, or both'],
            ['business_address', 'Ramanathapuram, Tamil Nadu, India', 'business', 'Business address'],
            ['business_phone', '+91 7418831122', 'business', 'Business phone number'],
            ['business_email', 'info@qcpaintshop.com', 'business', 'Business email'],
            ['business_logo', null, 'business', 'Business logo URL'],
            ['gst_number', null, 'tax', 'GST Number (GSTIN)'],
            ['pan_number', null, 'tax', 'PAN Number'],
            ['enable_gst', 'true', 'tax', 'Enable GST in estimates'],
            ['cgst_rate', '9', 'tax', 'CGST rate percentage'],
            ['sgst_rate', '9', 'tax', 'SGST rate percentage'],
            ['igst_rate', '18', 'tax', 'IGST rate percentage'],
            ['estimate_prefix', 'EST', 'estimate', 'Estimate number prefix'],
            ['estimate_validity', '30', 'estimate', 'Estimate validity in days'],
            ['estimate_terms', '1. All prices are subject to change without prior notice.\n2. This estimate is valid for 30 days from the date of issue.\n3. Payment terms: As per agreement.\n4. Delivery time: As per discussion.\n5. For any queries, please contact us.', 'estimate', 'Terms and conditions'],
            ['show_brand_logo', 'true', 'estimate', 'Show brand logos in estimates']
        ];

        for (const [key, value, category, description] of defaultSettings) {
            await connection.query(
                `INSERT INTO settings (setting_key, setting_value, category, description)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [key, value, category, description]
            );
        }

        console.log(`  ✓ Inserted ${defaultSettings.length} default settings`);

        // Verify
        const [rows] = await connection.query('SELECT COUNT(*) as count FROM settings');
        console.log(`\n✅ Settings table ready with ${rows[0].count} settings`);

        console.log('\n🎉 Migration completed successfully!');
        console.log('💾 Logo upload should now work correctly.');

    } catch (error) {
        console.error('❌ Error creating settings table:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

// Run the migration
createSettingsTable();
