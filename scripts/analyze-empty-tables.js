#!/usr/bin/env node
/**
 * PHASE 2 CLEANUP - Empty Table Analysis
 * Analyzes all tables with 0 rows, checks references in code, classifies risk
 *
 * Usage: node scripts/analyze-empty-tables.js
 */

const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 2
    });

    const dbName = process.env.DB_NAME;
    console.log(`\n=== EMPTY TABLE ANALYSIS for ${dbName} ===\n`);

    // Step 1: Get all tables with row counts
    const [allTables] = await pool.query(`
        SELECT table_name, table_rows,
               ROUND(data_length/1024, 1) as data_kb,
               ROUND(index_length/1024, 1) as index_kb,
               create_time, update_time
        FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
        ORDER BY table_rows ASC, table_name
    `, [dbName]);

    console.log(`Total tables: ${allTables.length}`);

    // Step 2: Get actual row counts (information_schema.table_rows is approximate)
    const emptyTables = [];
    const nonEmptyTables = [];

    for (const t of allTables) {
        const tableName = t.table_name || t.TABLE_NAME;
        try {
            const [countResult] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
            const actualCount = countResult[0].cnt;
            if (actualCount === 0) {
                emptyTables.push({ ...t, table_name: tableName, actual_rows: 0 });
            } else {
                nonEmptyTables.push({ table_name: tableName, actual_rows: actualCount });
            }
        } catch (err) {
            console.error(`  Error counting ${tableName}: ${err.message}`);
        }
    }

    console.log(`Empty tables: ${emptyTables.length}`);
    console.log(`Non-empty tables: ${nonEmptyTables.length}\n`);

    // Step 3: Get foreign key references for empty tables
    const [fkRefs] = await pool.query(`
        SELECT
            TABLE_NAME as from_table,
            COLUMN_NAME as from_column,
            REFERENCED_TABLE_NAME as to_table,
            REFERENCED_COLUMN_NAME as to_column
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
    `, [dbName]);

    // Step 4: Check code references for each empty table
    const projectRoot = path.join(__dirname, '..');
    const routesDir = path.join(projectRoot, 'routes');
    const servicesDir = path.join(projectRoot, 'services');
    const publicDir = path.join(projectRoot, 'public');
    const serverJs = path.join(projectRoot, 'server.js');

    function searchInCode(tableName) {
        const refs = { routes: [], services: [], html: [], serverJs: false };
        try {
            // Search in routes/
            const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
            for (const file of routeFiles) {
                const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
                if (content.includes(tableName)) {
                    refs.routes.push(file);
                }
            }
            // Search in services/
            if (fs.existsSync(servicesDir)) {
                const serviceFiles = fs.readdirSync(servicesDir).filter(f => f.endsWith('.js'));
                for (const file of serviceFiles) {
                    const content = fs.readFileSync(path.join(servicesDir, file), 'utf8');
                    if (content.includes(tableName)) {
                        refs.services.push(file);
                    }
                }
            }
            // Search in server.js
            const serverContent = fs.readFileSync(serverJs, 'utf8');
            if (serverContent.includes(tableName)) {
                refs.serverJs = true;
            }
            // Search in HTML files (top-level public only to keep fast)
            const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
            for (const file of htmlFiles) {
                const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
                if (content.includes(tableName)) {
                    refs.html.push(file);
                }
            }
        } catch (err) {
            // ignore search errors
        }
        return refs;
    }

    // Step 5: Build analysis report
    const analysis = [];
    for (const t of emptyTables) {
        const tableName = t.table_name;

        // Find FK relationships
        const fksFrom = fkRefs.filter(fk => fk.from_table === tableName);
        const fksTo = fkRefs.filter(fk => fk.to_table === tableName);

        // Search code
        const codeRefs = searchInCode(tableName);
        const totalRefs = codeRefs.routes.length + codeRefs.services.length + codeRefs.html.length + (codeRefs.serverJs ? 1 : 0);

        // Classify risk
        let risk = 'SAFE_TO_DROP';
        let reason = '';
        if (fksTo.length > 0) {
            risk = 'NEEDS_REVIEW';
            reason = `Referenced by ${fksTo.map(fk => fk.from_table).join(', ')} via FK`;
        }
        if (totalRefs > 3) {
            risk = 'NEEDS_REVIEW';
            reason = `Referenced in ${totalRefs} code files`;
        }
        if (totalRefs > 6) {
            risk = 'KEEP';
            reason = `Heavily referenced in ${totalRefs} code files - likely active feature`;
        }

        analysis.push({
            table_name: tableName,
            actual_rows: 0,
            data_kb: parseFloat(t.data_kb) || 0,
            index_kb: parseFloat(t.index_kb) || 0,
            created: t.create_time,
            fks_from: fksFrom.map(fk => `${fk.from_column} -> ${fk.to_table}.${fk.to_column}`),
            fks_to: fksTo.map(fk => `${fk.from_table}.${fk.from_column} -> ${tableName}.${fk.to_column}`),
            code_refs: codeRefs,
            total_code_refs: totalRefs,
            risk_level: risk,
            reason: reason
        });
    }

    // Sort by risk: SAFE first, then NEEDS_REVIEW, then KEEP
    const riskOrder = { 'SAFE_TO_DROP': 0, 'NEEDS_REVIEW': 1, 'KEEP': 2 };
    analysis.sort((a, b) => riskOrder[a.risk_level] - riskOrder[b.risk_level] || a.table_name.localeCompare(b.table_name));

    // Print report
    console.log('=' .repeat(100));
    console.log('EMPTY TABLE ANALYSIS REPORT');
    console.log('=' .repeat(100));

    const groups = {
        'SAFE_TO_DROP': analysis.filter(a => a.risk_level === 'SAFE_TO_DROP'),
        'NEEDS_REVIEW': analysis.filter(a => a.risk_level === 'NEEDS_REVIEW'),
        'KEEP': analysis.filter(a => a.risk_level === 'KEEP')
    };

    for (const [level, tables] of Object.entries(groups)) {
        console.log(`\n--- ${level} (${tables.length} tables) ---\n`);
        for (const t of tables) {
            console.log(`  ${t.table_name}`);
            console.log(`    Size: ${t.data_kb}KB data, ${t.index_kb}KB index`);
            if (t.fks_from.length) console.log(`    FK out: ${t.fks_from.join('; ')}`);
            if (t.fks_to.length) console.log(`    FK in: ${t.fks_to.join('; ')}`);
            console.log(`    Code refs: routes=[${t.code_refs.routes.join(',')}] services=[${t.code_refs.services.join(',')}] html=[${t.code_refs.html.join(',')}] server.js=${t.code_refs.serverJs}`);
            if (t.reason) console.log(`    Reason: ${t.reason}`);
            console.log();
        }
    }

    // Summary
    console.log('=' .repeat(100));
    console.log('SUMMARY');
    console.log(`  Total empty tables: ${analysis.length}`);
    console.log(`  SAFE_TO_DROP: ${groups.SAFE_TO_DROP.length}`);
    console.log(`  NEEDS_REVIEW: ${groups.NEEDS_REVIEW.length}`);
    console.log(`  KEEP: ${groups.KEEP.length}`);
    console.log(`  Total space: ${analysis.reduce((sum, t) => sum + t.data_kb + t.index_kb, 0).toFixed(1)}KB`);
    console.log('=' .repeat(100));

    // Also list non-empty tables for reference
    console.log('\n\nNON-EMPTY TABLES (for reference):');
    nonEmptyTables.sort((a, b) => b.actual_rows - a.actual_rows);
    for (const t of nonEmptyTables) {
        console.log(`  ${t.table_name}: ${t.actual_rows} rows`);
    }

    // Save JSON report
    const report = {
        analysis_date: new Date().toISOString(),
        database: dbName,
        total_tables: allTables.length,
        empty_tables: analysis,
        non_empty_tables: nonEmptyTables,
        summary: {
            total_empty: analysis.length,
            safe_to_drop: groups.SAFE_TO_DROP.length,
            needs_review: groups.NEEDS_REVIEW.length,
            keep: groups.KEEP.length
        }
    };

    const reportPath = path.join(__dirname, 'empty-tables-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nJSON report saved to: ${reportPath}`);

    await pool.end();
}

main().catch(err => {
    console.error('Analysis failed:', err);
    process.exit(1);
});
