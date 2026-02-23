/**
 * Painter Points Engine
 * Handles all points calculation, slab evaluation, invoice processing, and credit management
 */

let pool;

function setPool(p) { pool = p; }

// ═══════════════════════════════════════════
// REFERRAL TIER CALCULATOR
// ═══════════════════════════════════════════

function getReferralTier(totalBills) {
    if (totalBills >= 10) return 2.0;
    if (totalBills >= 5) return 1.5;
    if (totalBills >= 3) return 1.0;
    return 0.5;
}

// ═══════════════════════════════════════════
// BALANCE HELPERS
// ═══════════════════════════════════════════

async function getBalance(painterId) {
    const [rows] = await pool.query(
        'SELECT regular_points, annual_points, total_earned_regular, total_earned_annual, total_redeemed_regular, total_redeemed_annual FROM painters WHERE id = ?',
        [painterId]
    );
    if (!rows.length) return null;
    return {
        regular: parseFloat(rows[0].regular_points),
        annual: parseFloat(rows[0].annual_points),
        totalEarnedRegular: parseFloat(rows[0].total_earned_regular),
        totalEarnedAnnual: parseFloat(rows[0].total_earned_annual),
        totalRedeemedRegular: parseFloat(rows[0].total_redeemed_regular),
        totalRedeemedAnnual: parseFloat(rows[0].total_redeemed_annual)
    };
}

async function addPoints(painterId, pointPool, amount, source, refId, refType, description, createdBy) {
    if (amount <= 0) return;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Get current balance
        const [painter] = await conn.query('SELECT regular_points, annual_points FROM painters WHERE id = ? FOR UPDATE', [painterId]);
        if (!painter.length) throw new Error('Painter not found');

        const currentBalance = parseFloat(painter[0][`${pointPool}_points`]);
        const newBalance = currentBalance + amount;

        // Insert ledger entry
        await conn.query(
            `INSERT INTO painter_point_transactions (painter_id, pool, type, amount, balance_after, source, reference_id, reference_type, description, created_by)
             VALUES (?, ?, 'earn', ?, ?, ?, ?, ?, ?, ?)`,
            [painterId, pointPool, amount, newBalance, source, refId || null, refType || null, description || null, createdBy || null]
        );

        // Update cached balance
        const poolCol = `${pointPool}_points`;
        const totalCol = `total_earned_${pointPool}`;
        await conn.query(
            `UPDATE painters SET ${poolCol} = ?, ${totalCol} = ${totalCol} + ? WHERE id = ?`,
            [newBalance, amount, painterId]
        );

        await conn.commit();
        return newBalance;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function deductPoints(painterId, pointPool, amount, source, refId, refType, description, createdBy) {
    if (amount <= 0) return;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [painter] = await conn.query('SELECT regular_points, annual_points FROM painters WHERE id = ? FOR UPDATE', [painterId]);
        if (!painter.length) throw new Error('Painter not found');

        const currentBalance = parseFloat(painter[0][`${pointPool}_points`]);
        if (currentBalance < amount) throw new Error(`Insufficient ${pointPool} points. Have: ${currentBalance}, Need: ${amount}`);

        const newBalance = currentBalance - amount;

        await conn.query(
            `INSERT INTO painter_point_transactions (painter_id, pool, type, amount, balance_after, source, reference_id, reference_type, description, created_by)
             VALUES (?, ?, 'debit', ?, ?, ?, ?, ?, ?, ?)`,
            [painterId, pointPool, -amount, newBalance, source, refId || null, refType || null, description || null, createdBy || null]
        );

        const poolCol = `${pointPool}_points`;
        const totalCol = `total_redeemed_${pointPool}`;
        await conn.query(
            `UPDATE painters SET ${poolCol} = ?, ${totalCol} = ${totalCol} + ? WHERE id = ?`,
            [newBalance, amount, painterId]
        );

        await conn.commit();
        return newBalance;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function getLedger(painterId, pointPool, limit = 50, offset = 0) {
    let query = 'SELECT * FROM painter_point_transactions WHERE painter_id = ?';
    const params = [painterId];
    if (pointPool) {
        query += ' AND pool = ?';
        params.push(pointPool);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows] = await pool.query(query, params);
    return rows;
}

// ═══════════════════════════════════════════
// INVOICE PROCESSING
// ═══════════════════════════════════════════

async function processInvoice(painterId, invoice, billingType, createdBy) {
    // Check if already processed
    const [existing] = await pool.query(
        'SELECT id FROM painter_invoices_processed WHERE invoice_id = ?',
        [invoice.invoice_id]
    );
    if (existing.length > 0) {
        return { success: false, message: 'Invoice already processed', alreadyProcessed: true };
    }

    // Get product point rates
    const [rates] = await pool.query('SELECT * FROM painter_product_point_rates WHERE is_active = 1');
    const rateMap = {};
    for (const r of rates) {
        rateMap[r.item_id] = r;
    }

    let totalRegularPoints = 0;
    let totalAnnualPoints = 0;
    const lineItems = invoice.line_items || [];

    for (const item of lineItems) {
        const rate = rateMap[item.item_id];
        if (!rate) continue;

        const quantity = parseFloat(item.quantity) || 0;
        const lineTotal = parseFloat(item.item_total) || 0;

        if (billingType === 'customer') {
            // Customer billing: regular_points_per_unit * quantity → Regular pool
            const regPts = parseFloat(rate.regular_points_per_unit) * quantity;
            if (regPts > 0) totalRegularPoints += regPts;
        }
        // Self-billing: skip regular points, only annual if eligible

        // Both billing types: annual if eligible
        if (rate.annual_eligible && lineTotal > 0) {
            const annPts = lineTotal * (parseFloat(rate.annual_pct) / 100);
            if (annPts > 0) totalAnnualPoints += annPts;
        }
    }

    // Round to 2 decimal places
    totalRegularPoints = Math.round(totalRegularPoints * 100) / 100;
    totalAnnualPoints = Math.round(totalAnnualPoints * 100) / 100;

    // Award points
    if (totalRegularPoints > 0) {
        await addPoints(painterId, 'regular', totalRegularPoints, billingType === 'self' ? 'self_billing' : 'customer_billing',
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }
    if (totalAnnualPoints > 0) {
        await addPoints(painterId, 'annual', totalAnnualPoints, billingType === 'self' ? 'self_billing' : 'customer_billing',
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }

    // Process referral points
    let totalReferralPoints = 0;
    const [referral] = await pool.query(
        'SELECT * FROM painter_referrals WHERE referred_id = ? AND status = "active"',
        [painterId]
    );
    if (referral.length > 0) {
        const ref = referral[0];
        const newBills = ref.total_bills + 1;
        const tierPct = getReferralTier(newBills);
        const invoiceTotal = parseFloat(invoice.total) || 0;
        const refPoints = Math.round(invoiceTotal * (tierPct / 100) * 100) / 100;

        if (refPoints > 0) {
            await addPoints(ref.referrer_id, 'regular', refPoints, 'referral',
                invoice.invoice_id, 'invoice', `Referral from painter #${painterId} - Invoice ${invoice.invoice_number || ''}`, createdBy);
            totalReferralPoints = refPoints;
        }

        // Update referral record
        await pool.query(
            'UPDATE painter_referrals SET total_bills = ?, current_tier_pct = ?, total_referral_points = total_referral_points + ? WHERE id = ?',
            [newBills, tierPct, refPoints, ref.id]
        );
    }

    // Record processed invoice
    await pool.query(
        `INSERT INTO painter_invoices_processed (painter_id, invoice_id, invoice_number, invoice_date, invoice_total, billing_type, regular_points, annual_points, referral_points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [painterId, invoice.invoice_id, invoice.invoice_number || null, invoice.date || null,
         parseFloat(invoice.total) || 0, billingType, totalRegularPoints, totalAnnualPoints, totalReferralPoints]
    );

    return {
        success: true,
        regularPoints: totalRegularPoints,
        annualPoints: totalAnnualPoints,
        referralPoints: totalReferralPoints
    };
}

// ═══════════════════════════════════════════
// SLAB EVALUATION
// ═══════════════════════════════════════════

async function evaluateMonthlySlabs(yearMonth) {
    // yearMonth format: '2026-02'
    const [year, month] = yearMonth.split('-').map(Number);
    const periodStart = `${yearMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const periodEnd = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    const periodLabel = yearMonth;

    return _evaluateSlabs('monthly', periodLabel, periodStart, periodEnd);
}

async function evaluateQuarterlySlabs(yearQuarter) {
    // yearQuarter format: '2026-Q1'
    const [year, qStr] = yearQuarter.split('-Q');
    const quarter = parseInt(qStr);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const periodStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(parseInt(year), endMonth, 0).getDate();
    const periodEnd = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const periodLabel = yearQuarter;

    return _evaluateSlabs('quarterly', periodLabel, periodStart, periodEnd);
}

async function _evaluateSlabs(periodType, periodLabel, periodStart, periodEnd) {
    // Get active slabs for this period type
    const [slabs] = await pool.query(
        'SELECT * FROM painter_value_slabs WHERE period_type = ? AND is_active = 1 ORDER BY min_amount DESC',
        [periodType]
    );
    if (!slabs.length) return { evaluated: 0, awarded: 0 };

    // Get all approved painters
    const [painters] = await pool.query('SELECT id FROM painters WHERE status = "approved"');
    let evaluated = 0;
    let awarded = 0;

    for (const painter of painters) {
        // Check if already evaluated
        const [existing] = await pool.query(
            'SELECT id FROM painter_slab_evaluations WHERE painter_id = ? AND period_type = ? AND period_label = ?',
            [painter.id, periodType, periodLabel]
        );
        if (existing.length > 0) continue;

        // Sum purchase total for this period
        const [totals] = await pool.query(
            'SELECT COALESCE(SUM(invoice_total), 0) as total FROM painter_invoices_processed WHERE painter_id = ? AND invoice_date BETWEEN ? AND ?',
            [painter.id, periodStart, periodEnd]
        );
        const totalPurchase = parseFloat(totals[0].total);

        // Find matching slab (highest first)
        let matchedSlab = null;
        for (const slab of slabs) {
            const min = parseFloat(slab.min_amount);
            const max = slab.max_amount ? parseFloat(slab.max_amount) : Infinity;
            if (totalPurchase >= min && totalPurchase <= max) {
                matchedSlab = slab;
                break;
            }
        }

        const bonusPoints = matchedSlab ? parseFloat(matchedSlab.bonus_points) : 0;

        // Award points if matched
        if (bonusPoints > 0) {
            await addPoints(painter.id, 'annual', bonusPoints, periodType === 'monthly' ? 'monthly_slab' : 'quarterly_slab',
                periodLabel, 'slab', `${periodType} slab bonus: ${matchedSlab.label || ''} (${totalPurchase.toFixed(2)} purchased)`, null);
            awarded++;
        }

        // Record evaluation
        await pool.query(
            `INSERT INTO painter_slab_evaluations (painter_id, period_type, period_label, period_start, period_end, total_purchase, slab_id, points_awarded)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [painter.id, periodType, periodLabel, periodStart, periodEnd, totalPurchase, matchedSlab ? matchedSlab.id : null, bonusPoints]
        );
        evaluated++;
    }

    return { evaluated, awarded };
}

// ═══════════════════════════════════════════
// CREDIT MANAGEMENT
// ═══════════════════════════════════════════

async function checkOverdueCredits() {
    const [config] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'painter_credit_overdue_days'");
    const maxDays = config.length ? parseInt(config[0].config_value) : 30;

    // Find painters with credit enabled and overdue invoices
    const [painters] = await pool.query(
        'SELECT id, credit_used, regular_points, annual_points FROM painters WHERE credit_enabled = 1 AND credit_used > 0'
    );

    let processed = 0;
    for (const painter of painters) {
        // Check oldest unpaid self-billing invoice
        const [oldest] = await pool.query(
            `SELECT invoice_date, DATEDIFF(CURDATE(), invoice_date) as days_overdue
             FROM painter_invoices_processed
             WHERE painter_id = ? AND billing_type = 'self'
             ORDER BY invoice_date ASC LIMIT 1`,
            [painter.id]
        );
        if (!oldest.length) continue;

        const daysOverdue = oldest[0].days_overdue;
        await pool.query('UPDATE painters SET credit_overdue_days = ? WHERE id = ?', [daysOverdue, painter.id]);

        if (daysOverdue > maxDays) {
            const amountToDebit = parseFloat(painter.credit_used);
            let remaining = amountToDebit;

            // Try deducting from regular first
            const regularBal = parseFloat(painter.regular_points);
            if (regularBal > 0 && remaining > 0) {
                const deductAmt = Math.min(regularBal, remaining);
                try {
                    await deductPoints(painter.id, 'regular', deductAmt, 'credit_debit', null, null,
                        `Auto-debit for overdue credit (${daysOverdue} days)`, null);
                    remaining -= deductAmt;
                } catch (e) { /* insufficient balance handled */ }
            }

            // Then from annual
            if (remaining > 0) {
                const annualBal = parseFloat(painter.annual_points);
                if (annualBal > 0) {
                    const deductAmt = Math.min(annualBal, remaining);
                    try {
                        await deductPoints(painter.id, 'annual', deductAmt, 'credit_debit', null, null,
                            `Auto-debit for overdue credit (${daysOverdue} days)`, null);
                        remaining -= deductAmt;
                    } catch (e) { /* insufficient balance handled */ }
                }
            }

            processed++;
        }
    }

    return { processed };
}

// ═══════════════════════════════════════════
// WITHDRAWALS
// ═══════════════════════════════════════════

async function requestWithdrawal(painterId, pointPool, amount) {
    const balance = await getBalance(painterId);
    if (!balance) throw new Error('Painter not found');

    const available = pointPool === 'regular' ? balance.regular : balance.annual;
    if (amount > available) throw new Error(`Insufficient ${pointPool} points. Available: ${available}`);

    // For annual withdrawals, check if withdrawal window is open
    if (pointPool === 'annual') {
        const [config] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key IN ('painter_annual_withdrawal_month', 'painter_annual_withdrawal_day') ORDER BY config_key"
        );
        // Simple check - can be enhanced later
    }

    const [result] = await pool.query(
        'INSERT INTO painter_withdrawals (painter_id, pool, amount) VALUES (?, ?, ?)',
        [painterId, pointPool, amount]
    );

    return { withdrawalId: result.insertId };
}

async function processWithdrawal(withdrawalId, action, adminId, paymentRef, notes) {
    const [withdrawal] = await pool.query('SELECT * FROM painter_withdrawals WHERE id = ?', [withdrawalId]);
    if (!withdrawal.length) throw new Error('Withdrawal not found');

    const w = withdrawal[0];
    if (w.status !== 'pending') throw new Error(`Withdrawal already ${w.status}`);

    if (action === 'approve' || action === 'paid') {
        // Deduct points
        await deductPoints(w.painter_id, w.pool, parseFloat(w.amount), 'withdrawal',
            String(w.id), 'withdrawal', `Withdrawal #${w.id} ${action}d`, adminId);

        await pool.query(
            'UPDATE painter_withdrawals SET status = ?, processed_by = ?, processed_at = NOW(), payment_reference = ?, notes = ? WHERE id = ?',
            [action === 'paid' ? 'paid' : 'approved', adminId, paymentRef || null, notes || null, withdrawalId]
        );
    } else if (action === 'reject') {
        await pool.query(
            'UPDATE painter_withdrawals SET status = "rejected", processed_by = ?, processed_at = NOW(), notes = ? WHERE id = ?',
            [adminId, notes || null, withdrawalId]
        );
    }

    return { success: true };
}

// ═══════════════════════════════════════════
// ATTENDANCE POINTS
// ═══════════════════════════════════════════

async function awardAttendancePoints(painterId, attendanceId) {
    const [config] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'painter_attendance_points'");
    const points = config.length ? parseFloat(config[0].config_value) : 5;

    if (points > 0) {
        await addPoints(painterId, 'regular', points, 'attendance',
            String(attendanceId), 'attendance', 'Attendance points', null);
    }

    await pool.query('UPDATE painter_attendance SET points_awarded = ? WHERE id = ?', [points, attendanceId]);
    return points;
}

// ═══════════════════════════════════════════
// REFERRAL CODE GENERATOR
// ═══════════════════════════════════════════

function generateReferralCode(name) {
    const prefix = (name || 'QC').replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase();
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}${random}`;
}

module.exports = {
    setPool,
    getReferralTier,
    getBalance,
    addPoints,
    deductPoints,
    getLedger,
    processInvoice,
    evaluateMonthlySlabs,
    evaluateQuarterlySlabs,
    checkOverdueCredits,
    requestWithdrawal,
    processWithdrawal,
    awardAttendancePoints,
    generateReferralCode
};
