/**
 * Migration: Update painter_levels thresholds and multipliers
 *
 * New values:
 * - Bronze: 0 pts, 1.0x multiplier
 * - Silver: 3,000 pts, 1.2x multiplier (annual)
 * - Gold: 5,000 pts, 1.5x multiplier (annual)
 * - Diamond: 10,000 pts, 2.0x multiplier (annual)
 */

const pool = require('../config/database');

async function migrate() {
    console.log('=== Updating painter_levels thresholds ===');

    await pool.query(`UPDATE painter_levels SET min_points = 0, multiplier = 1.00 WHERE level_name = 'bronze'`);
    await pool.query(`UPDATE painter_levels SET min_points = 3000, multiplier = 1.20 WHERE level_name = 'silver'`);
    await pool.query(`UPDATE painter_levels SET min_points = 5000, multiplier = 1.50 WHERE level_name = 'gold'`);
    await pool.query(`UPDATE painter_levels SET min_points = 10000, multiplier = 2.00 WHERE level_name = 'diamond'`);

    console.log('  Updated painter_levels:');
    console.log('    Bronze:  0 pts, 1.0x');
    console.log('    Silver:  3,000 pts, 1.2x');
    console.log('    Gold:    5,000 pts, 1.5x');
    console.log('    Diamond: 10,000 pts, 2.0x');

    // Recalculate all painters' current levels based on new thresholds
    const [painters] = await pool.query('SELECT id, total_earned_regular, total_earned_annual, current_level FROM painters');
    let updated = 0;
    for (const p of painters) {
        const lifetime = parseFloat(p.total_earned_regular || 0) + parseFloat(p.total_earned_annual || 0);
        let newLevel = 'bronze';
        if (lifetime >= 10000) newLevel = 'diamond';
        else if (lifetime >= 5000) newLevel = 'gold';
        else if (lifetime >= 3000) newLevel = 'silver';

        if (newLevel !== p.current_level) {
            await pool.query('UPDATE painters SET current_level = ? WHERE id = ?', [newLevel, p.id]);
            console.log(`  Painter ${p.id}: ${p.current_level} → ${newLevel} (${lifetime} pts)`);
            updated++;
        }
    }
    console.log(`  Recalculated ${updated} painter levels`);

    console.log('=== Migration complete ===');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
