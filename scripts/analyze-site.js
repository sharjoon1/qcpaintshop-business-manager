#!/usr/bin/env node
/**
 * QC Paint Shop Site Analyzer
 * Connects to the act.qcpaintshop.com database and produces a full health report.
 * Usage: node analyze-site.js [section]
 * Sections: all, db, routes, errors, business, health
 */

const mysql = require('mysql2/promise');
const https = require('https');
const path = require('path');
const fs = require('fs');

// Load env from the app
require('dotenv').config({ path: '/www/wwwroot/act.qcpaintshop.com/.env' });

const section = process.argv[2] || 'all';

async function main() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        port: process.env.DB_PORT || 3306
    });

    try {
        if (['all', 'db'].includes(section)) {
            console.log('=== DATABASE ANALYSIS ===\n');

            const [tables] = await pool.query(`
                SELECT TABLE_NAME, TABLE_ROWS,
                       ROUND(DATA_LENGTH/1024/1024, 2) as data_mb,
                       ROUND(INDEX_LENGTH/1024/1024, 2) as index_mb
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_ROWS DESC
            `);
            console.log('Table Sizes (top 20):');
            tables.slice(0, 20).forEach(t => {
                console.log('  ' + t.TABLE_NAME + ': ' + t.TABLE_ROWS + ' rows (' + t.data_mb + 'MB data, ' + t.index_mb + 'MB index)');
            });

            const empty = tables.filter(t => t.TABLE_ROWS === 0);
            console.log('\nEmpty Tables (' + empty.length + '):');
            empty.forEach(t => console.log('  - ' + t.TABLE_NAME));

            const [fkNoIndex] = await pool.query(`
                SELECT c.TABLE_NAME, c.COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = DATABASE()
                AND (c.COLUMN_NAME LIKE '%_id' OR c.COLUMN_NAME LIKE '%_by')
                AND c.COLUMN_NAME NOT IN ('id')
                AND NOT EXISTS (
                    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS s
                    WHERE s.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND s.TABLE_NAME = c.TABLE_NAME
                    AND s.COLUMN_NAME = c.COLUMN_NAME
                )
                ORDER BY c.TABLE_NAME
            `);
            console.log('\nFK-like columns without indexes (' + fkNoIndex.length + '):');
            fkNoIndex.forEach(r => console.log('  - ' + r.TABLE_NAME + '.' + r.COLUMN_NAME));
        }

        if (['all', 'errors'].includes(section)) {
            console.log('\n=== ERROR ANALYSIS ===\n');

            const [recentErrors] = await pool.query(`
                SELECT error_type, COUNT(*) as count,
                       MAX(created_at) as last_seen,
                       SUBSTRING(error_message, 1, 100) as msg
                FROM error_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                GROUP BY error_type, SUBSTRING(error_message, 1, 100)
                ORDER BY count DESC LIMIT 20
            `);
            console.log('Errors in last 24h:');
            if (recentErrors.length === 0) console.log('  None');
            recentErrors.forEach(e => console.log('  [' + e.error_type + '] x' + e.count + ': ' + e.msg));

            const [errorTrends] = await pool.query(`
                SELECT DATE(created_at) as day, COUNT(*) as count
                FROM error_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(created_at) ORDER BY day
            `);
            console.log('\nError trend (7 days):');
            errorTrends.forEach(d => console.log('  ' + d.day + ': ' + d.count + ' errors'));

            const [topErrors] = await pool.query(`
                SELECT error_type, severity, COUNT(*) as count
                FROM error_logs GROUP BY error_type, severity
                ORDER BY count DESC LIMIT 10
            `);
            console.log('\nTop error types (all time):');
            topErrors.forEach(e => console.log('  [' + e.severity + '] ' + e.error_type + ': ' + e.count));
        }

        if (['all', 'business'].includes(section)) {
            console.log('\n=== BUSINESS METRICS ===\n');

            const [revenue] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN DATE(invoice_date) = CURDATE() THEN total ELSE 0 END), 0) as today,
                    COALESCE(SUM(CASE WHEN DATE(invoice_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) THEN total ELSE 0 END), 0) as yesterday,
                    COALESCE(SUM(CASE WHEN MONTH(invoice_date) = MONTH(CURDATE()) AND YEAR(invoice_date) = YEAR(CURDATE()) THEN total ELSE 0 END), 0) as this_month,
                    COUNT(CASE WHEN DATE(invoice_date) = CURDATE() THEN 1 END) as today_invoices
                FROM zoho_invoices
            `);
            var r = revenue[0];
            console.log('Revenue: Today Rs.' + Number(r.today).toLocaleString('en-IN') + ' (' + r.today_invoices + ' inv) | Yesterday Rs.' + Number(r.yesterday).toLocaleString('en-IN') + ' | Month Rs.' + Number(r.this_month).toLocaleString('en-IN'));

            const [collections] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN DATE(payment_date) = CURDATE() THEN amount ELSE 0 END), 0) as today,
                    COALESCE(SUM(CASE WHEN MONTH(payment_date) = MONTH(CURDATE()) THEN amount ELSE 0 END), 0) as this_month
                FROM zoho_payments
            `);
            var c = collections[0];
            console.log('Collections: Today Rs.' + Number(c.today).toLocaleString('en-IN') + ' | Month Rs.' + Number(c.this_month).toLocaleString('en-IN'));

            const [leads] = await pool.query(`
                SELECT status, COUNT(*) as count
                FROM leads WHERE status NOT IN ('closed')
                GROUP BY status ORDER BY count DESC
            `);
            console.log('\nLeads Pipeline:');
            leads.forEach(l => console.log('  ' + l.status + ': ' + l.count));

            const [attendance] = await pool.query(`
                SELECT COUNT(*) as clocked_in,
                    SUM(CASE WHEN clock_out_time IS NOT NULL THEN 1 ELSE 0 END) as completed
                FROM staff_attendance WHERE date = CURDATE()
            `);
            var a = attendance[0];
            console.log('\nStaff Today: ' + a.clocked_in + ' clocked in, ' + a.completed + ' completed');

            const [users] = await pool.query(`
                SELECT role, COUNT(*) as count FROM users WHERE status = 'active' GROUP BY role
            `);
            console.log('\nActive Users:');
            users.forEach(u => console.log('  ' + u.role + ': ' + u.count));
        }

        if (['all', 'health'].includes(section)) {
            console.log('\n=== SYSTEM HEALTH ===\n');

            try {
                var start = Date.now();
                await new Promise(function(resolve, reject) {
                    https.get('https://act.qcpaintshop.com/api/health', function(res) {
                        var data = '';
                        res.on('data', function(c) { data += c; });
                        res.on('end', function() { resolve({ status: res.statusCode, time: Date.now() - start }); });
                    }).on('error', reject);
                }).then(function(r) {
                    console.log('Site Response: ' + r.status + ' (' + r.time + 'ms)');
                });
            } catch (e) {
                console.log('Site Response: FAILED - ' + e.message);
            }

            const [dbSize] = await pool.query(`
                SELECT ROUND(SUM(DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2) as total_mb
                FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()
            `);
            console.log('Database Size: ' + dbSize[0].total_mb + 'MB');

            const [tableCount] = await pool.query(`
                SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()
            `);
            console.log('Total Tables: ' + tableCount[0].cnt);

            const [aiConfig] = await pool.query(`
                SELECT config_key, config_value FROM ai_config
                WHERE config_key IN ('primary_provider','fallback_provider','daily_snapshot_enabled')
            `);
            console.log('\nAI Config:');
            aiConfig.forEach(function(c) { console.log('  ' + c.config_key + ': ' + c.config_value); });

            const [lastAI] = await pool.query(`
                SELECT analysis_type, status, created_at
                FROM ai_analysis_runs ORDER BY created_at DESC LIMIT 5
            `);
            console.log('\nRecent AI Runs:');
            if (lastAI.length === 0) console.log('  None');
            lastAI.forEach(function(r) { console.log('  ' + r.analysis_type + ': ' + r.status + ' (' + r.created_at + ')'); });

            const [waSessions] = await pool.query(`
                SELECT session_name, status, phone_number FROM whatsapp_sessions
            `);
            console.log('\nWhatsApp Sessions:');
            if (waSessions.length === 0) console.log('  None configured');
            waSessions.forEach(function(s) { console.log('  ' + s.session_name + ': ' + s.status + ' (' + s.phone_number + ')'); });
        }

        if (['all', 'routes'].includes(section)) {
            console.log('\n=== API ROUTES ===\n');

            var routesDir = '/www/wwwroot/act.qcpaintshop.com/routes';
            var routeFiles = fs.readdirSync(routesDir).filter(function(f) { return f.endsWith('.js'); });
            console.log('Route Files (' + routeFiles.length + '):');

            routeFiles.forEach(function(file) {
                var content = fs.readFileSync(path.join(routesDir, file), 'utf8');
                var getCount = (content.match(/router\.get\(/g) || []).length;
                var postCount = (content.match(/router\.post\(/g) || []).length;
                var putCount = (content.match(/router\.put\(/g) || []).length;
                var deleteCount = (content.match(/router\.delete\(/g) || []).length;
                var total = getCount + postCount + putCount + deleteCount;
                console.log('  ' + file + ': ' + total + ' endpoints (' + getCount + 'G/' + postCount + 'P/' + putCount + 'U/' + deleteCount + 'D)');
            });

            var publicDir = '/www/wwwroot/act.qcpaintshop.com/public';
            var htmlFiles = fs.readdirSync(publicDir).filter(function(f) { return f.endsWith('.html'); });
            console.log('\nHTML Pages: ' + htmlFiles.length);
            htmlFiles.forEach(function(f) { console.log('  ' + f); });
        }

    } catch (err) {
        console.error('Analysis error:', err.message);
    } finally {
        await pool.end();
    }
}

main();
