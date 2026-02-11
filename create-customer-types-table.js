const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'qc_business_manager'
};

async function createCustomerTypesTable() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database\n');

        // Create customer_types table
        console.log('📋 Creating customer_types table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS customer_types (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                discount_percentage DECIMAL(5,2) DEFAULT 0.00,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ customer_types table created\n');

        // Add some default customer types
        console.log('📝 Adding default customer types...');

        const defaultTypes = [
            { name: 'Retail', description: 'Individual retail customers', discount_percentage: 0 },
            { name: 'Wholesale', description: 'Wholesale buyers', discount_percentage: 10 },
            { name: 'Contractor', description: 'Construction contractors', discount_percentage: 15 },
            { name: 'VIP', description: 'VIP customers with special rates', discount_percentage: 20 }
        ];

        for (const type of defaultTypes) {
            const [existing] = await connection.query(
                'SELECT id FROM customer_types WHERE name = ?',
                [type.name]
            );

            if (existing.length === 0) {
                await connection.query(
                    'INSERT INTO customer_types (name, description, discount_percentage) VALUES (?, ?, ?)',
                    [type.name, type.description, type.discount_percentage]
                );
                console.log(`  ✓ Added: ${type.name} (${type.discount_percentage}% discount)`);
            } else {
                console.log(`  ⊘ Exists: ${type.name}`);
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('✅ Customer Types Table Setup Complete!');
        console.log('='.repeat(50));

        // Show current customer types
        const [types] = await connection.query('SELECT * FROM customer_types');
        console.log('\n📊 Current Customer Types:');
        types.forEach(t => {
            console.log(`  • ${t.name} - ${t.discount_percentage}% discount`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

// Run the script
createCustomerTypesTable();
