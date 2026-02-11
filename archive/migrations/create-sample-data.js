const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

async function createSampleData() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        // ========================================
        // 1. CREATE BRANDS (REQUIRED FOR PRODUCTS)
        // ========================================
        console.log('\n🏢 Creating brands...');

        const brands = [
            { id: 1, name: 'Asian Paints' },
            { id: 2, name: 'Berger Paints' },
            { id: 3, name: 'Dulux' }
        ];

        for (const brand of brands) {
            await connection.query(
                'INSERT IGNORE INTO brands (id, name, status) VALUES (?, ?, ?)',
                [brand.id, brand.name, 'active']
            );
        }
        console.log(`  ✓ Ensured ${brands.length} brands exist (Asian Paints, Berger Paints, Dulux)`);

        // ========================================
        // 2. CREATE CATEGORIES (REQUIRED FOR PRODUCTS)
        // ========================================
        console.log('\n📂 Creating categories...');

        const categories = [
            { id: 1, name: 'Interior Paints', description: 'Wall paints for interior spaces' },
            { id: 2, name: 'Exterior Paints', description: 'Weather-resistant exterior paints' }
        ];

        for (const category of categories) {
            await connection.query(
                'INSERT IGNORE INTO categories (id, name, description, status) VALUES (?, ?, ?, ?)',
                [category.id, category.name, category.description, 'active']
            );
        }
        console.log(`  ✓ Ensured ${categories.length} categories exist (Interior Paints, Exterior Paints)`);

        // ========================================
        // 3. CREATE SAMPLE PRODUCTS
        // ========================================
        console.log('\n📦 Creating sample products...');

        const products = [
            {
                brand_id: 1, // Asian Paints
                category_id: 1, // Interior Paints
                name: 'Royale Luxury Emulsion - White',
                description: 'Premium interior emulsion with silk finish',
                product_type: 'area_wise',
                area_coverage: 140.00,
                available_sizes: '[1,4,10,20]',
                base_price: 850.00,
                gst_percentage: 18.00
            },
            {
                brand_id: 2, // Berger Paints
                category_id: 1, // Interior Paints
                name: 'Easy Clean Fresh - Premium Emulsion',
                description: 'Washable interior paint with anti-bacterial properties',
                product_type: 'area_wise',
                area_coverage: 130.00,
                available_sizes: '[1,4,10,20]',
                base_price: 780.00,
                gst_percentage: 18.00
            },
            {
                brand_id: 3, // Dulux
                category_id: 2, // Exterior Paints
                name: 'WeatherShield Exterior Emulsion',
                description: 'Weather-resistant exterior paint with 7-year warranty',
                product_type: 'area_wise',
                area_coverage: 120.00,
                available_sizes: '[4,10,20]',
                base_price: 920.00,
                gst_percentage: 18.00
            },
            {
                brand_id: 1, // Asian Paints
                category_id: 1, // Interior Paints
                name: 'Apcolite Premium Emulsion',
                description: 'Budget-friendly interior emulsion paint',
                product_type: 'area_wise',
                area_coverage: 150.00,
                available_sizes: '[4,10,20]',
                base_price: 620.00,
                gst_percentage: 18.00
            },
            {
                brand_id: 2, // Berger Paints
                category_id: 2, // Exterior Paints
                name: 'WeatherCoat Long Life',
                description: 'Premium exterior paint with dirt-repellent technology',
                product_type: 'area_wise',
                area_coverage: 125.00,
                available_sizes: '[4,10,20]',
                base_price: 880.00,
                gst_percentage: 18.00
            }
        ];

        for (const product of products) {
            const [existing] = await connection.query(
                'SELECT id FROM products WHERE name = ? AND brand_id = ?',
                [product.name, product.brand_id]
            );

            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO products (brand_id, category_id, name, description, product_type,
                    area_coverage, available_sizes, base_price, gst_percentage, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                    [product.brand_id, product.category_id, product.name, product.description,
                     product.product_type, product.area_coverage, product.available_sizes,
                     product.base_price, product.gst_percentage]
                );
                console.log(`  ✓ Added: ${product.name}`);
            } else {
                console.log(`  ⊘ Skipped: ${product.name} (already exists)`);
            }
        }

        // ========================================
        // 4. CREATE SAMPLE CUSTOMERS
        // ========================================
        console.log('\n👥 Creating sample customers...');

        const customers = [
            {
                name: 'Rajesh Kumar',
                phone: '9876543210',
                email: 'rajesh.kumar@email.com',
                address: '123, MG Road, Richmond Town',
                city: 'Bangalore',
                gst_number: '29ABCDE1234F1Z5',
                status: 'approved'
            },
            {
                name: 'Priya Sharma',
                phone: '9876543211',
                email: 'priya.sharma@email.com',
                address: '456, Brigade Road, Shantinagar',
                city: 'Bangalore',
                gst_number: '29FGHIJ5678K2Y6',
                status: 'approved'
            },
            {
                name: 'Amit Patel',
                phone: '9876543212',
                email: 'amit.patel@email.com',
                address: '789, Residency Road, Ashok Nagar',
                city: 'Bangalore',
                gst_number: null,
                status: 'approved'
            },
            {
                name: 'Sunita Reddy',
                phone: '9876543213',
                email: 'sunita.reddy@email.com',
                address: '321, Indiranagar, 1st Stage',
                city: 'Bangalore',
                gst_number: '29KLMNO9012P3X7',
                status: 'approved'
            },
            {
                name: 'Vikram Singh',
                phone: '9876543214',
                email: 'vikram.singh@email.com',
                address: '654, Koramangala, 4th Block',
                city: 'Bangalore',
                gst_number: null,
                status: 'pending'
            }
        ];

        for (const customer of customers) {
            const [existing] = await connection.query(
                'SELECT id FROM customers WHERE phone = ?',
                [customer.phone]
            );

            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO customers (name, phone, email, address, city, gst_number, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [customer.name, customer.phone, customer.email, customer.address,
                     customer.city, customer.gst_number, customer.status]
                );
                console.log(`  ✓ Added: ${customer.name}`);
            } else {
                console.log(`  ⊘ Skipped: ${customer.name} (phone already exists)`);
            }
        }

        // Get customer and product IDs for estimates
        const [customerRows] = await connection.query('SELECT id, name, phone, address FROM customers LIMIT 3');
        const [productRows] = await connection.query('SELECT id, name, base_price, product_type FROM products WHERE status = "active" LIMIT 5');

        if (customerRows.length === 0 || productRows.length === 0) {
            console.log('\n⚠️  Not enough customers or products to create estimates');
            return;
        }

        // ========================================
        // 5. CREATE SAMPLE ESTIMATES
        // ========================================
        console.log('\n📋 Creating sample estimates...');

        const today = new Date();
        const datePrefix = today.toISOString().split('T')[0].replace(/-/g, '');

        const estimates = [
            {
                customer: customerRows[0],
                estimate_date: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 5 days ago
                status: 'approved',
                notes: 'Living room and bedroom painting - Premium finish required',
                items: [
                    { product_id: productRows[0].id, quantity: 200, area: 200, unit_price: 850.00 },
                    { product_id: productRows[3].id, quantity: 200, area: 200, unit_price: 380.00 }
                ]
            },
            {
                customer: customerRows[1],
                estimate_date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 2 days ago
                status: 'sent',
                notes: 'Exterior painting for entire house',
                items: [
                    { product_id: productRows[2].id, quantity: 300, area: 300, unit_price: 920.00 },
                    { product_id: productRows[3].id, quantity: 300, area: 300, unit_price: 380.00 }
                ]
            },
            {
                customer: customerRows[2],
                estimate_date: today.toISOString().split('T')[0], // Today
                status: 'draft',
                notes: 'Wood work varnishing for doors and windows',
                items: [
                    { product_id: productRows[4].id, quantity: 3, area: null, unit_price: 1250.00 }
                ]
            }
        ];

        for (let i = 0; i < estimates.length; i++) {
            const estimate = estimates[i];

            // Generate estimate number
            const [lastEstimate] = await connection.query(
                'SELECT estimate_number FROM estimates WHERE estimate_number LIKE ? ORDER BY id DESC LIMIT 1',
                [`EST${datePrefix}%`]
            );

            let estimateNumber;
            if (lastEstimate.length > 0) {
                const lastNum = parseInt(lastEstimate[0].estimate_number.slice(-4));
                estimateNumber = `EST${datePrefix}${String(lastNum + 1).padStart(4, '0')}`;
            } else {
                estimateNumber = `EST${datePrefix}${String(i + 1).padStart(4, '0')}`;
            }

            // Check if estimate already exists
            const [existing] = await connection.query(
                'SELECT id FROM estimates WHERE estimate_number = ?',
                [estimateNumber]
            );

            if (existing.length > 0) {
                console.log(`  ⊘ Skipped: ${estimateNumber} (already exists)`);
                continue;
            }

            // Calculate totals
            let subtotal = 0;
            estimate.items.forEach(item => {
                const lineTotal = item.quantity * item.unit_price;
                item.line_total = lineTotal;
                subtotal += lineTotal;
            });

            const gstAmount = subtotal * 0.18; // 18% GST
            const grandTotal = subtotal + gstAmount;

            // Insert estimate
            const [result] = await connection.query(
                `INSERT INTO estimates (estimate_number, customer_name, customer_phone, customer_address,
                estimate_date, subtotal, gst_amount, grand_total, show_gst_breakdown, notes, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [estimateNumber, estimate.customer.name, estimate.customer.phone, estimate.customer.address,
                 estimate.estimate_date, subtotal, gstAmount, grandTotal, 1, estimate.notes, estimate.status, 1]
            );

            const estimateId = result.insertId;

            // Insert estimate items
            for (let j = 0; j < estimate.items.length; j++) {
                const item = estimate.items[j];
                const [product] = await connection.query('SELECT name FROM products WHERE id = ?', [item.product_id]);

                await connection.query(
                    `INSERT INTO estimate_items (estimate_id, product_id, item_description, quantity,
                    area, unit_price, line_total, display_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [estimateId, item.product_id, product[0].name, item.quantity, item.area,
                     item.unit_price, item.line_total, j]
                );
            }

            console.log(`  ✓ Added: ${estimateNumber} - ${estimate.customer.name} (${estimate.status}) - ₹${grandTotal.toFixed(2)}`);
        }

        // ========================================
        // SUMMARY
        // ========================================
        console.log('\n📊 Sample Data Summary:');
        const [productCount] = await connection.query('SELECT COUNT(*) as count FROM products WHERE status = "active"');
        const [customerCount] = await connection.query('SELECT COUNT(*) as count FROM customers');
        const [estimateCount] = await connection.query('SELECT COUNT(*) as count FROM estimates');
        const [estimateTotal] = await connection.query('SELECT SUM(grand_total) as total FROM estimates');

        console.log(`  Products: ${productCount[0].count}`);
        console.log(`  Customers: ${customerCount[0].count}`);
        console.log(`  Estimates: ${estimateCount[0].count}`);
        console.log(`  Total Revenue: ₹${(estimateTotal[0].total || 0).toFixed(2)}`);

        console.log('\n✅ Sample data created successfully!');
        console.log('🌐 Visit http://localhost:3000/dashboard.html to see the data');

    } catch (error) {
        console.error('❌ Error creating sample data:', error.message);
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
createSampleData();
