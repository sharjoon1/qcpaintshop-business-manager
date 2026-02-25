#!/usr/bin/env node

/**
 * Database Migration Runner
 *
 * Manages and tracks database migrations in the `_migrations` table.
 *
 * Usage:
 *   node migrate.js                 Run all pending migrations
 *   node migrate.js --status        Show applied vs pending migrations
 *   node migrate.js --mark-existing Mark all existing self-contained migrations as applied
 *
 * Migration files in migrations/ can follow two patterns:
 *   1. Export `async function up(pool)` - the runner calls this with a mysql2 pool
 *   2. Self-contained scripts (create own pool, call process.exit) - use --mark-existing
 *      to mark these as already applied without re-running them
 */

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Helpers ──────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function createPool() {
    return mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        waitForConnections: true,
        connectionLimit: 5
    });
}

async function ensureMigrationsTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function getAppliedMigrations(pool) {
    const [rows] = await pool.query('SELECT name, applied_at FROM _migrations ORDER BY name');
    return new Map(rows.map(r => [r.name, r.applied_at]));
}

function getMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        return [];
    }
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.js'))
        .sort();
}

function formatDate(d) {
    if (!d) return 'N/A';
    const dt = new Date(d);
    return dt.toISOString().replace('T', ' ').slice(0, 19);
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function showStatus(pool) {
    const applied = await getAppliedMigrations(pool);
    const files = getMigrationFiles();

    if (files.length === 0) {
        console.log('No migration files found in migrations/');
        return;
    }

    const pendingCount = files.filter(f => !applied.has(f)).length;
    const appliedCount = files.filter(f => applied.has(f)).length;

    console.log(`\nMigration Status: ${appliedCount} applied, ${pendingCount} pending, ${files.length} total\n`);
    console.log('  Status     Applied At           Name');
    console.log('  ' + '-'.repeat(72));

    for (const file of files) {
        if (applied.has(file)) {
            console.log(`  applied    ${formatDate(applied.get(file))}  ${file}`);
        } else {
            console.log(`  PENDING    -                    ${file}`);
        }
    }

    console.log('');
}

async function markExisting(pool) {
    const applied = await getAppliedMigrations(pool);
    const files = getMigrationFiles();
    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
        console.log('All migrations are already marked as applied.');
        return;
    }

    console.log(`Marking ${pending.length} existing migration(s) as applied...\n`);

    for (const file of pending) {
        await pool.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
        console.log(`  marked: ${file}`);
    }

    console.log(`\nDone. ${pending.length} migration(s) marked as applied.`);
}

async function runMigrations(pool) {
    const applied = await getAppliedMigrations(pool);
    const files = getMigrationFiles();
    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
        console.log('All migrations are up to date. Nothing to run.');
        return;
    }

    console.log(`Found ${pending.length} pending migration(s).\n`);

    let succeeded = 0;
    let failed = 0;

    for (const file of pending) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        console.log(`Running: ${file} ...`);

        try {
            // Require the migration module
            const migration = require(filePath);

            if (typeof migration.up === 'function') {
                // Pattern 1: exports async function up(pool)
                await migration.up(pool);
            } else if (typeof migration === 'function') {
                // Pattern 2: module.exports = async function(pool)
                await migration(pool);
            } else {
                // Self-contained script that was already required (side effects ran)
                // But these typically call process.exit(), so they won't reach here
                // For safety, we still mark them
                console.log(`  Warning: ${file} has no up() export. If it is a self-contained script,`);
                console.log(`  use --mark-existing to mark it as applied without re-running.`);
                console.log(`  Skipping.\n`);
                failed++;
                continue;
            }

            // Record successful migration
            await pool.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
            console.log(`  OK\n`);
            succeeded++;
        } catch (err) {
            console.error(`  FAILED: ${err.message}\n`);
            failed++;
            // Stop on first failure to avoid running migrations out of order
            console.error('Stopping migration runner due to failure.');
            break;
        }
    }

    console.log('─'.repeat(50));
    console.log(`Results: ${succeeded} succeeded, ${failed} failed, ${pending.length - succeeded - failed} skipped`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    let pool;
    try {
        pool = createPool();
        await ensureMigrationsTable(pool);

        if (command === '--status') {
            await showStatus(pool);
        } else if (command === '--mark-existing') {
            await markExisting(pool);
        } else if (!command) {
            await runMigrations(pool);
        } else {
            console.error(`Unknown flag: ${command}`);
            console.error('Usage: node migrate.js [--status | --mark-existing]');
            process.exit(1);
        }
    } catch (err) {
        console.error('Migration runner error:', err.message);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

main();
