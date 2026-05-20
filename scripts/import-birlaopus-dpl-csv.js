#!/usr/bin/env node
/**
 * Standalone Birla Opus DPL CSV importer.
 * Usage:
 *   node scripts/import-birlaopus-dpl-csv.js <path/to/csv>
 *   node scripts/import-birlaopus-dpl-csv.js <path/to/csv> --save
 */
'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const { parseBirlaOpusCsv } = require('../services/price-list-parser');

const csvPath  = process.argv[2];
const autoSave = process.argv.includes('--save');

if (!csvPath) {
    console.error('Usage: node scripts/import-birlaopus-dpl-csv.js <path/to/csv> [--save]');
    process.exit(1);
}

const absPath = path.resolve(csvPath);
if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
}

function extractDateFromFilename(filename) {
    const m = filename.match(/(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{4})/i);
    if (!m) return new Date().toISOString().slice(0, 10);
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                     jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const mm = months[m[2].toLowerCase()];
    const dd = String(m[1]).padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
}

const effectiveDate = extractDateFromFilename(path.basename(absPath));

console.log(`\nReading: ${absPath}`);
const buf   = fs.readFileSync(absPath);
const items = parseBirlaOpusCsv(buf, effectiveDate);

if (items.length === 0) {
    console.error('No items parsed — check CSV format.');
    process.exit(1);
}

const byCategory = {};
for (const item of items) {
    const key = `${item.category} - ${item.segment}`;
    if (!byCategory[key]) byCategory[key] = { count: 0, minDpl: Infinity, maxDpl: -Infinity };
    byCategory[key].count++;
    if (item.dpl < byCategory[key].minDpl) byCategory[key].minDpl = item.dpl;
    if (item.dpl > byCategory[key].maxDpl) byCategory[key].maxDpl = item.dpl;
}

const allDpls = items.map(i => i.dpl);
const minDpl  = Math.min(...allDpls);
const maxDpl  = Math.max(...allDpls);

console.log(`\n${'─'.repeat(60)}`);
console.log(`  Birla Opus DPL CSV — Parse Preview`);
console.log(`${'─'.repeat(60)}`);
console.log(`  File:           ${path.basename(absPath)}`);
console.log(`  Effective date: ${effectiveDate}`);
console.log(`  Total items:    ${items.length}`);
console.log(`  DPL range:      ₹${minDpl} – ₹${maxDpl}`);
console.log(`\n  By Category:`);
for (const [key, v] of Object.entries(byCategory).sort()) {
    console.log(`    ${key.padEnd(35)} ${String(v.count).padStart(4)} items   ₹${v.minDpl}–₹${v.maxDpl}`);
}
console.log(`\n  Sample (first 3 items):`);
for (const it of items.slice(0, 3)) {
    const salesPrice = Math.ceil(it.dpl * 1.298);
    console.log(`    ${it._proposedName}`);
    console.log(`      SKU: ${it._proposedZohoSku}   DPL: ₹${it.dpl}   Sales: ₹${salesPrice}`);
}
console.log(`${'─'.repeat(60)}\n`);

async function saveToDb() {
    const { createPool }    = require('../config/database');
    const brandDplService   = require('../services/brand-dpl-service');
    const pool              = createPool();
    brandDplService.setPool(pool);

    console.log('Saving to brand_dpl_lists...');
    const saved = await brandDplService.save({
        brand:       'birlaopus',
        rawText:     fs.readFileSync(absPath, 'utf8'),
        parsedRows:  items,
        effectiveDate,
        updatedBy:   'import-script',
    });
    console.log('Saved:', JSON.stringify(saved, null, 2));
    await pool.end();
}

if (autoSave) {
    saveToDb().catch(err => { console.error('Save failed:', err.message); process.exit(1); });
} else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Save to brand_dpl_lists? [y/N]: ', async answer => {
        rl.close();
        if (answer.trim().toLowerCase() === 'y') {
            await saveToDb().catch(err => { console.error('Save failed:', err.message); process.exit(1); });
        } else {
            console.log('Aborted — nothing saved.');
        }
    });
}
