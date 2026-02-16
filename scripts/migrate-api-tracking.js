/**
 * Migration: Add API usage tracking config keys and update sync intervals
 * Run: node scripts/migrate-api-tracking.js
 *
 * Changes:
 *   - Adds api_daily_count, api_daily_date, api_daily_callers config keys
 *   - Updates sync_interval_minutes default from 30 to 60
 *   - Adds stock_sync_interval_hours if missing
 *   - Adds last_quick_sync config key
 *
 * This migration supports the API usage tracking fix that ensures
 * 100% of Zoho API calls are tracked and persisted across restarts.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    try {
        console.log('Starting API tracking migration...\n');

        // 1. Add API tracking config keys
        console.log('1/3 Adding API tracking config keys...');
        const trackingConfigs = [
            ['api_daily_count', '0', 'Daily API call counter (persisted across restarts)'],
            ['api_daily_date', '', 'Date for the daily API counter (YYYY-MM-DD)'],
            ['api_daily_callers', '{}', 'JSON breakdown of API calls by caller'],
            ['last_quick_sync', '', 'Timestamp of last quick sync (customers+invoices+payments)']
        ];

        for (const [key, value, desc] of trackingConfigs) {
            await pool.query(`
                INSERT IGNORE INTO zoho_config (config_key, config_value, description)
                VALUES (?, ?, ?)
            `, [key, value, desc]);
        }
        console.log('   Done - API tracking config keys added');

        // 2. Update default sync interval if it's still at the old aggressive default
        console.log('2/3 Checking sync interval settings...');
        const [syncInterval] = await pool.query(
            `SELECT config_value FROM zoho_config WHERE config_key = 'sync_interval_minutes'`
        );
        if (syncInterval.length > 0 && syncInterval[0].config_value === '30') {
            await pool.query(
                `UPDATE zoho_config SET config_value = '60', description = 'Quick sync interval in minutes (customers+invoices+payments only)' WHERE config_key = 'sync_interval_minutes'`
            );
            console.log('   Updated sync_interval_minutes: 30 -> 60 (quick sync only, stock runs separately)');
        } else {
            console.log('   sync_interval_minutes already customized, skipping');
        }

        // 3. Add/update stock sync interval
        console.log('3/3 Checking stock sync settings...');
        const [stockInterval] = await pool.query(
            `SELECT config_value FROM zoho_config WHERE config_key = 'stock_sync_interval_hours'`
        );
        if (stockInterval.length === 0) {
            await pool.query(`
                INSERT INTO zoho_config (config_key, config_value, description)
                VALUES ('stock_sync_interval_hours', '4', 'Stock sync interval in hours (heavy operation, ~300 API calls)')
            `);
            console.log('   Added stock_sync_interval_hours = 4');
        } else if (stockInterval[0].config_value === '2') {
            await pool.query(
                `UPDATE zoho_config SET config_value = '4', description = 'Stock sync interval in hours (heavy operation, ~300 API calls)' WHERE config_key = 'stock_sync_interval_hours'`
            );
            console.log('   Updated stock_sync_interval_hours: 2 -> 4');
        } else {
            console.log('   stock_sync_interval_hours already customized, skipping');
        }

        console.log('\nAPI tracking migration completed successfully!');
        console.log('\nChanges summary:');
        console.log('  - API call counter now persists to DB (survives server restarts)');
        console.log('  - All API calls tracked centrally at HTTP layer');
        console.log('  - Quick sync (no stock) runs every 60 min instead of full sync every 30 min');
        console.log('  - Stock sync runs every 4 hours instead of 2 hours');
        console.log('  - Estimated daily API savings: ~8,000-12,000 calls');

    } catch (error) {
        console.error('Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
