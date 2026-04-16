/**
 * Auto-assign painter_leads to branches based on name prefix pattern
 * Pattern: "{NAME} PNTR {CODE}" or "PNTR {CODE} {NAME}"
 *
 * Mapping:
 *   RMD → branch_id=1 (QC - Main Branch / Headoffice Ramanathapuram)
 *   TCM → branch_id=2 (QC - Thangachimadam)
 *   PKD → branch_id=3 (QC - Paramakudi)
 *   RMM → branch_id=4 (QC - Rameswaram)
 *   PBN → branch_id=5 (QC - Pamban)
 *
 * Usage: node scripts/assign-painter-leads-by-branch.js
 * Add --dry-run to preview without updating
 */
require('dotenv').config();
const { createPool } = require('../config/database');

const BRANCH_CODE_MAP = {
    'RMD': 1,  // Headoffice / Ramanathapuram
    'TCM': 2,  // Thangachimadam
    'PKD': 3,  // Paramakudi
    'RMM': 4,  // Rameswaram
    'PBN': 5,  // Pamban
};

function detectBranchFromName(name) {
    if (!name) return null;
    // Match "PNTR CODE", "PNTR - CODE", "PNTR.CODE" anywhere in name (case-insensitive)
    const m = String(name).match(/PNTR\s*[-.]?\s*([A-Za-z]{2,5})/i);
    if (!m) return null;
    const code = m[1].toUpperCase();
    return BRANCH_CODE_MAP[code] || null;
}

async function run() {
    const dryRun = process.argv.includes('--dry-run');
    const pool = createPool();

    try {
        const [leads] = await pool.query(
            `SELECT id, full_name, branch_id FROM painter_leads WHERE branch_id IS NULL ORDER BY id`
        );
        console.log(`Found ${leads.length} unassigned leads\n`);

        const groups = {};
        const unmatched = [];

        for (const lead of leads) {
            const branchId = detectBranchFromName(lead.full_name);
            if (branchId) {
                if (!groups[branchId]) groups[branchId] = [];
                groups[branchId].push(lead.id);
            } else {
                unmatched.push({ id: lead.id, name: lead.full_name });
            }
        }

        // Branch names for display
        const branchNames = {
            1: 'QC - Main Branch (RMD / Headoffice)',
            2: 'QC - Thangachimadam (TCM)',
            3: 'QC - Paramakudi (PKD)',
            4: 'QC - Rameswaram (RMM)',
            5: 'QC - Pamban (PBN)',
        };

        console.log('=== ASSIGNMENT PLAN ===');
        for (const [branchId, ids] of Object.entries(groups)) {
            console.log(`  Branch ${branchId} (${branchNames[branchId]}): ${ids.length} leads`);
        }
        console.log(`  Unmatched (no PNTR code found): ${unmatched.length} leads`);
        if (unmatched.length > 0) {
            console.log('\nUnmatched leads:');
            unmatched.forEach(l => console.log(`  id=${l.id}: ${l.name}`));
        }

        if (dryRun) {
            console.log('\n[DRY RUN] No changes made. Remove --dry-run to apply.');
            process.exit(0);
        }

        console.log('\n=== APPLYING UPDATES ===');
        let totalUpdated = 0;
        for (const [branchId, ids] of Object.entries(groups)) {
            const placeholders = ids.map(() => '?').join(',');
            const [result] = await pool.query(
                `UPDATE painter_leads
                 SET branch_id = ?, branch_detected_via = 'name_prefix'
                 WHERE id IN (${placeholders}) AND branch_id IS NULL`,
                [Number(branchId), ...ids]
            );
            console.log(`  Branch ${branchId} (${branchNames[branchId]}): updated ${result.affectedRows} leads`);
            totalUpdated += result.affectedRows;
        }

        console.log(`\nDone! Total updated: ${totalUpdated} leads`);
        console.log(`Unmatched (left as NULL): ${unmatched.length} leads`);

    } finally {
        await pool.end();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
