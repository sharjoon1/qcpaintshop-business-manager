require('dotenv').config();
const { createPool } = require('../config/database');
const pool = createPool();
const pointsEngine = require('../services/painter-points-engine');
pointsEngine.setPool(pool);

(async () => {
    try {
        // Find paid estimates with no points
        const [estimates] = await pool.query(`
            SELECT pe.id, pe.estimate_number, pe.painter_id, pe.billing_type,
                   pe.grand_total, pe.final_grand_total, pe.markup_grand_total, pe.points_awarded
            FROM painter_estimates pe
            WHERE pe.status IN ('payment_recorded','pushed_to_zoho') AND (pe.points_awarded IS NULL OR pe.points_awarded = 0)
        `);
        console.log(`Found ${estimates.length} paid estimates with no points`);

        for (const est of estimates) {
            const [items] = await pool.query(
                'SELECT zoho_item_id, quantity, line_total FROM painter_estimate_items WHERE estimate_id = ?', [est.id]
            );
            console.log(`\nEstimate #${est.estimate_number} (ID ${est.id}): ${items.length} items, billing=${est.billing_type}`);

            const total = parseFloat(est.final_grand_total || est.markup_grand_total || est.grand_total || 0);
            const invoiceForPoints = {
                invoice_id: `EST-${est.id}`,
                invoice_number: est.estimate_number,
                date: new Date().toISOString().split('T')[0],
                total,
                line_items: items.map(i => ({
                    item_id: i.zoho_item_id,
                    quantity: parseFloat(i.quantity),
                    item_total: parseFloat(i.line_total)
                }))
            };

            const result = await pointsEngine.processInvoice(est.painter_id, invoiceForPoints, est.billing_type, 1);
            console.log('Result:', JSON.stringify(result));

            if (result && !result.alreadyProcessed) {
                const totalPts = (result.regularPoints || 0) + (result.annualPoints || 0);
                await pool.query(
                    'UPDATE painter_estimates SET points_awarded = ?, regular_points_awarded = ?, annual_points_awarded = ? WHERE id = ?',
                    [totalPts, result.regularPoints || 0, result.annualPoints || 0, est.id]
                );
                console.log(`  → Awarded: regular=${result.regularPoints}, annual=${result.annualPoints}`);
            }
        }

        // Show final painter balance
        const [painters] = await pool.query('SELECT id, full_name, regular_points, annual_points FROM painters');
        console.log('\nPainter balances:');
        console.table(painters.map(p => ({ id: p.id, name: p.full_name, regular: parseFloat(p.regular_points), annual: parseFloat(p.annual_points) })));

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
