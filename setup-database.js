/**
 * Database Setup Script
 * Creates the qc_business_manager database and imports the complete schema.
 *
 * Usage:  node setup-database.js
 *
 * Prerequisites:
 *   - MySQL server running
 *   - .env file with DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
 *   - node_modules installed (npm install)
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ── Configuration ────────────────────────────────────────────
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'qc_business_manager';

const SCHEMA_FILE = path.join(__dirname, 'database-complete-schema.sql');

// ── Helpers ──────────────────────────────────────────────────

/**
 * Split a SQL file into individual statements, respecting semicolons
 * inside strings and skipping blank / comment-only lines.
 */
function splitStatements(sql) {
    // Remove the USE statement – we already select the DB via connection config
    sql = sql.replace(/^USE\s+[^;]+;\s*/im, '');

    const statements = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        const next = sql[i + 1] || '';

        // ── Track comment state ──
        if (!inSingleQuote && !inDoubleQuote) {
            if (!inBlockComment && ch === '-' && next === '-') {
                inLineComment = true;
            }
            if (inLineComment && ch === '\n') {
                inLineComment = false;
                current += ch;
                continue;
            }
            if (!inLineComment && ch === '/' && next === '*') {
                inBlockComment = true;
                current += ch;
                continue;
            }
            if (inBlockComment && ch === '*' && next === '/') {
                inBlockComment = false;
                current += ch + next;
                i++;
                continue;
            }
        }

        if (inLineComment || inBlockComment) {
            current += ch;
            continue;
        }

        // ── Track quote state ──
        if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
        if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;

        // ── Statement delimiter ──
        if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
            const trimmed = current.trim();
            if (trimmed.length > 0) {
                statements.push(trimmed);
            }
            current = '';
            continue;
        }

        current += ch;
    }

    // Catch any trailing statement without a semicolon
    const trimmed = current.trim();
    if (trimmed.length > 0) {
        statements.push(trimmed);
    }

    return statements;
}

/**
 * Return a short label for a SQL statement (first meaningful line, truncated).
 */
function statementLabel(sql) {
    const line = sql
        .split('\n')
        .map(l => l.trim())
        .find(l => l.length > 0 && !l.startsWith('--'));
    if (!line) return '(comment)';
    return line.length > 90 ? line.substring(0, 90) + '…' : line;
}

// ── Main ─────────────────────────────────────────────────────
async function setup() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   Quality Colours — Database Setup              ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    // ── Validate env ──
    if (!DB_USER || !DB_PASSWORD) {
        console.error('❌  Missing DB_USER or DB_PASSWORD in .env file.');
        console.error('    Copy .env.example to .env and fill in your credentials.');
        process.exit(1);
    }

    // ── Validate schema file ──
    if (!fs.existsSync(SCHEMA_FILE)) {
        console.error(`❌  Schema file not found: ${SCHEMA_FILE}`);
        process.exit(1);
    }

    // ──────────────────────────────────────────────────────────
    // Step 1 — Connect WITHOUT a database to create it
    // ──────────────────────────────────────────────────────────
    console.log(`1️⃣  Connecting to MySQL at ${DB_HOST} as "${DB_USER}" ...`);

    let rootConn;
    try {
        rootConn = await mysql.createConnection({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASSWORD,
            multipleStatements: false
        });
        console.log('   ✅  Connected to MySQL server.\n');
    } catch (err) {
        console.error('❌  Cannot connect to MySQL:', err.message);
        console.error('\n   Checklist:');
        console.error('   • Is MySQL running?');
        console.error('   • Are DB_HOST / DB_USER / DB_PASSWORD correct in .env?');
        process.exit(1);
    }

    // ──────────────────────────────────────────────────────────
    // Step 2 — Create the database if it doesn't exist
    // ──────────────────────────────────────────────────────────
    console.log(`2️⃣  Creating database "${DB_NAME}" (if not exists) ...`);
    try {
        await rootConn.query(
            `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        console.log(`   ✅  Database "${DB_NAME}" is ready.\n`);
    } catch (err) {
        console.error('❌  Failed to create database:', err.message);
        await rootConn.end();
        process.exit(1);
    }
    await rootConn.end();

    // ──────────────────────────────────────────────────────────
    // Step 3 — Connect to the target database
    // ──────────────────────────────────────────────────────────
    console.log(`3️⃣  Connecting to database "${DB_NAME}" ...`);
    let connection;
    try {
        connection = await mysql.createConnection({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            multipleStatements: false
        });
        console.log('   ✅  Connected.\n');
    } catch (err) {
        console.error('❌  Cannot connect to database:', err.message);
        process.exit(1);
    }

    // ──────────────────────────────────────────────────────────
    // Step 4 — Check prerequisite tables
    // ──────────────────────────────────────────────────────────
    console.log('4️⃣  Checking prerequisite tables ...');

    // The schema references users, products, customers, estimates, brands
    // that were created by run-db-updates.js or earlier migrations.
    // Create them here if missing so the FK constraints don't fail.

    const prerequisiteTables = [
        {
            name: 'brands',
            sql: `CREATE TABLE IF NOT EXISTS brands (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                logo_url VARCHAR(500) NULL,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'categories',
            sql: `CREATE TABLE IF NOT EXISTS categories (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'users',
            sql: `CREATE TABLE IF NOT EXISTS users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) NOT NULL DEFAULT '',
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255),
                phone VARCHAR(20),
                role ENUM('admin','manager','staff','customer','guest') DEFAULT 'guest',
                branch_id INT NULL,
                status ENUM('active','inactive','pending_approval') DEFAULT 'pending_approval',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME NULL,
                profile_image_url VARCHAR(500) NULL,
                INDEX idx_role (role),
                INDEX idx_status (status),
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'products',
            sql: `CREATE TABLE IF NOT EXISTS products (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                brand_id INT NULL,
                category_id INT NULL,
                product_type ENUM('area_wise','piece','roll','set') DEFAULT 'area_wise',
                description TEXT,
                gst_percentage DECIMAL(5,2) DEFAULT 18.00,
                base_price DECIMAL(10,2) DEFAULT 0,
                area_coverage DECIMAL(10,2) DEFAULT 100,
                available_sizes JSON NULL,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
                INDEX idx_brand (brand_id),
                INDEX idx_category (category_id),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'customers',
            sql: `CREATE TABLE IF NOT EXISTS customers (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(20),
                email VARCHAR(255),
                address TEXT,
                city VARCHAR(100),
                gst_number VARCHAR(20),
                customer_type_id INT NULL,
                branch_id INT NULL,
                lead_id INT NULL,
                whatsapp_opt_in BOOLEAN DEFAULT 0,
                total_purchases DECIMAL(12,2) DEFAULT 0,
                notes TEXT NULL,
                status ENUM('approved','pending','inactive') DEFAULT 'approved',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_phone (phone),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'estimates',
            sql: `CREATE TABLE IF NOT EXISTS estimates (
                id INT PRIMARY KEY AUTO_INCREMENT,
                estimate_number VARCHAR(50) UNIQUE,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(20),
                customer_address TEXT,
                estimate_date DATE,
                subtotal DECIMAL(12,2) DEFAULT 0,
                gst_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                show_gst_breakdown BOOLEAN DEFAULT 0,
                status VARCHAR(50) DEFAULT 'draft',
                created_by INT NULL,
                approved_by_admin_id INT NULL,
                approved_at DATETIME NULL,
                valid_until DATE NULL,
                column_visibility JSON NULL,
                notes TEXT,
                last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_date (estimate_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'estimate_items',
            sql: `CREATE TABLE IF NOT EXISTS estimate_items (
                id INT PRIMARY KEY AUTO_INCREMENT,
                estimate_id INT NOT NULL,
                product_id INT NULL,
                item_description TEXT,
                quantity DECIMAL(10,2) DEFAULT 1,
                area DECIMAL(10,2) NULL,
                mix_info VARCHAR(255) NULL,
                unit_price DECIMAL(10,2) DEFAULT 0,
                breakdown_cost VARCHAR(500) NULL,
                color_cost DECIMAL(10,2) DEFAULT 0,
                line_total DECIMAL(12,2) DEFAULT 0,
                display_order INT DEFAULT 0,
                FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
                INDEX idx_estimate (estimate_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'user_sessions',
            sql: `CREATE TABLE IF NOT EXISTS user_sessions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                session_token VARCHAR(255) UNIQUE NOT NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_session_token (session_token),
                INDEX idx_expires_at (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        },
        {
            name: 'estimate_status_history',
            sql: `CREATE TABLE IF NOT EXISTS estimate_status_history (
                id INT PRIMARY KEY AUTO_INCREMENT,
                estimate_id INT NOT NULL,
                old_status VARCHAR(50) NULL,
                new_status VARCHAR(50) NOT NULL,
                changed_by_user_id INT NOT NULL,
                reason TEXT NULL,
                notes TEXT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
                FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
                INDEX idx_estimate_id (estimate_id),
                INDEX idx_timestamp (timestamp)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        }
    ];

    for (const table of prerequisiteTables) {
        try {
            await connection.query(table.sql);
            console.log(`   ✅  ${table.name}`);
        } catch (err) {
            console.log(`   ⚠️  ${table.name}: ${err.message}`);
        }
    }
    console.log('');

    // ──────────────────────────────────────────────────────────
    // Step 5 — Read and execute the full schema file
    // ──────────────────────────────────────────────────────────
    console.log('5️⃣  Importing schema from database-complete-schema.sql ...\n');

    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    const statements = splitStatements(schemaSql);

    let succeeded = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const label = statementLabel(stmt);

        // Skip pure comments or SELECT messages
        if (/^--/.test(stmt) || /^SELECT\s+'/i.test(stmt)) {
            skipped++;
            continue;
        }

        try {
            await connection.query(stmt);
            succeeded++;
            console.log(`   ✅  [${i + 1}/${statements.length}] ${label}`);
        } catch (err) {
            // Tolerable errors (table/column already exists, duplicate key, etc.)
            if (
                err.code === 'ER_TABLE_EXISTS_ERROR' ||
                err.code === 'ER_DUP_FIELDNAME' ||
                err.code === 'ER_DUP_ENTRY' ||
                err.code === 'ER_DUP_KEYNAME'
            ) {
                skipped++;
                console.log(`   ⏭️  [${i + 1}/${statements.length}] Already exists — ${label}`);
            } else {
                failed++;
                console.error(`   ❌  [${i + 1}/${statements.length}] FAILED — ${label}`);
                console.error(`       Error: ${err.message}\n`);
            }
        }
    }

    // ──────────────────────────────────────────────────────────
    // Step 6 — Summary
    // ──────────────────────────────────────────────────────────
    console.log('\n──────────────────────────────────────────');

    const [tables] = await connection.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);

    console.log(`\n📊  Database Summary:`);
    console.log(`    Database : ${DB_NAME}`);
    console.log(`    Tables   : ${tableNames.length}`);
    console.log(`    Executed : ${succeeded} statements`);
    console.log(`    Skipped  : ${skipped} (already exist / comments)`);
    if (failed > 0) {
        console.log(`    Failed   : ${failed} ⚠️`);
    }

    console.log(`\n📋  Tables:`);
    tableNames.forEach(name => console.log(`    • ${name}`));

    if (failed === 0) {
        console.log('\n✅  Database setup completed successfully!');
        console.log('\n📝  Next steps:');
        console.log('    1. Create admin user  :  node create-admin-user.js');
        console.log('    2. Start the server   :  node server.js');
    } else {
        console.log(`\n⚠️  Setup completed with ${failed} error(s). Review the messages above.`);
    }

    await connection.end();
}

// ── Run ──────────────────────────────────────────────────────
setup().catch(err => {
    console.error('\n💥  Unexpected error:', err.message);
    process.exit(1);
});
