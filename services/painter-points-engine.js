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
        const earnBalance = currentBalance + amount;

        // Ledger entry for the full earn (always visible, even when clawbacks
        // absorb part or all of it — M2/Q-B2).
        await conn.query(
            `INSERT INTO painter_point_transactions (painter_id, pool, type, amount, balance_after, source, reference_id, reference_type, description, created_by)
             VALUES (?, ?, 'earn', ?, ?, ?, ?, ?, ?, ?)`,
            [painterId, pointPool, amount, earnBalance, source, refId || null, refType || null, description || null, createdBy || null]
        );

        // Net out pending clawbacks (regular pool only) — inside the same
        // transaction (the old out-of-txn netting could race a concurrent award)
        // and with a visible 'clawback' ledger entry instead of silently
        // shrinking the earn (M2/Q-B2). settled_ledger_id links each settled
        // pending row to the debit entry that consumed it.
        let absorbed = 0;
        if (pointPool === 'regular') {
            const [pending] = await conn.query(
                'SELECT id, amount FROM painter_clawback_pending WHERE painter_id=? AND settled_at IS NULL ORDER BY created_at FOR UPDATE',
                [painterId]
            );
            let remaining = amount;
            const settledIds = [];
            let partial = null; // { id, deduct }
            for (const row of pending) {
                if (remaining <= 0) break;
                const rowAmount = parseFloat(row.amount);
                const deduct = Math.min(remaining, rowAmount);
                if (deduct >= rowAmount) {
                    settledIds.push(row.id);
                } else {
                    partial = { id: row.id, deduct };
                }
                remaining -= deduct;
                absorbed += deduct;
            }

            if (absorbed > 0) {
                const [clawIns] = await conn.query(
                    `INSERT INTO painter_point_transactions (painter_id, pool, type, amount, balance_after, source, reference_id, reference_type, description, created_by)
                     VALUES (?, 'regular', 'debit', ?, ?, 'clawback', ?, ?, ?, NULL)`,
                    [painterId, -absorbed, earnBalance - absorbed, refId || null, refType || null,
                     'Clawback settlement (netted against earn)']
                );
                const ledgerId = clawIns.insertId || null;
                if (settledIds.length) {
                    await conn.query(
                        'UPDATE painter_clawback_pending SET settled_at=NOW(), settled_ledger_id=? WHERE id IN (?)',
                        [ledgerId, settledIds]
                    );
                }
                if (partial) {
                    await conn.query(
                        'UPDATE painter_clawback_pending SET amount = amount - ? WHERE id=?',
                        [partial.deduct, partial.id]
                    );
                }
            }
        }

        // Update cached balance. total_earned counts the FULL earn (the painter
        // did earn it; the clawback settles an earlier over-award whose own
        // total_earned contribution was never reversed).
        const newBalance = earnBalance - absorbed;
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

/**
 * True when an 'earn' ledger entry already exists for this painter/pool/source/
 * invoice — makes each award step idempotent so a retried invoice (after a
 * mid-processing failure, M1) never double-awards the parts that committed.
 */
async function invoiceAwardExists(painterId, pointPool, source, invoiceId) {
    const [rows] = await pool.query(
        `SELECT id FROM painter_point_transactions
         WHERE painter_id = ? AND pool = ? AND source = ? AND reference_id = ? AND type = 'earn' LIMIT 1`,
        [painterId, pointPool, source, String(invoiceId)]
    );
    return rows.length > 0;
}

async function processInvoice(painterId, invoice, billingType, createdBy) {
    // Atomically claim this invoice via INSERT IGNORE against the
    // UNIQUE (painter_id, invoice_id, attribution_type) constraint. If
    // another worker already inserted, affectedRows is 0 and we bail
    // out — preventing the previous read-then-insert race where two
    // concurrent calls both passed the SELECT, both ran addPoints, and
    // double-awarded points before the late INSERT collision.
    // zoho_invoice_id (optional) links the row to zoho_invoices so the credit
    // overdue check (M3) can see its paid/unpaid state — callers that already
    // know the Zoho invoice id (billing module, estimate push-to-Zoho) pass it.
    const [claimResult] = await pool.query(
        `INSERT IGNORE INTO painter_invoices_processed
           (painter_id, invoice_id, invoice_number, invoice_date, invoice_total, billing_type, zoho_invoice_id, regular_points, annual_points, referral_points)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
        [painterId, invoice.invoice_id, invoice.invoice_number || null, invoice.date || null,
         parseFloat(invoice.total) || 0, billingType, invoice.zoho_invoice_id || null]
    );
    if (claimResult.affectedRows === 0) {
        return { success: false, message: 'Invoice already processed', alreadyProcessed: true };
    }
    const claimedRowId = claimResult.insertId;

    // M1: everything after the claim is fallible. On error, release the claim
    // (compensating delete) so a retry can re-process; the per-award
    // invoiceAwardExists guards make any committed parts of THIS attempt
    // idempotent on that retry.
    try {
        return await _awardInvoicePoints(painterId, invoice, billingType, createdBy, claimedRowId);
    } catch (err) {
        try {
            await pool.query('DELETE FROM painter_invoices_processed WHERE id = ?', [claimedRowId]);
        } catch (cleanupErr) {
            console.error(`[Points] CRITICAL: failed to release claim row ${claimedRowId} for invoice ${invoice.invoice_id} — manual retry needed:`, cleanupErr.message);
        }
        throw err;
    }
}

async function _awardInvoicePoints(painterId, invoice, billingType, createdBy, claimedRowId) {
    const billingSource = billingType === 'self' ? 'self_billing' : 'customer_billing';

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

    // Daily bonus product multiplier (capped per day)
    let dailyBonusPoints = 0;
    try {
        const [bonusCfg] = await pool.query(
            "SELECT config_key, config_value FROM ai_config WHERE config_key IN ('painter_daily_bonus_product_id', 'painter_daily_bonus_multiplier', 'painter_daily_bonus_cap')"
        );
        const bcfg = {};
        bonusCfg.forEach(c => { bcfg[c.config_key] = c.config_value; });
        const bonusProductId = bcfg.painter_daily_bonus_product_id;
        const bonusMultiplier = parseInt(bcfg.painter_daily_bonus_multiplier) || 2;
        const bonusCap = parseInt(bcfg.painter_daily_bonus_cap) || 500;

        if (bonusProductId && totalRegularPoints > 0) {
            // Check if any line items match the daily bonus product
            for (const item of lineItems) {
                const [mapped] = await pool.query(
                    'SELECT product_id FROM zoho_items_map WHERE zoho_item_id = ? AND product_id = ?',
                    [item.item_id, bonusProductId]
                );
                if (mapped.length) {
                    const bonusExtra = Math.round(totalRegularPoints * (bonusMultiplier - 1) * 100) / 100;
                    // Check how much bonus already earned today. created_at is stored in
                    // UTC (DB session is forced to +00:00 on an IST host), so we convert
                    // it to IST before truncating to a date — otherwise the per-day cap
                    // leaks across the IST midnight boundary (00:00–05:30 IST rows would
                    // fall under the previous UTC date). todayStr is the IST calendar day. (KN-P1-4)
                    const now = new Date();
                    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
                    const [todayBonus] = await pool.query(
                        `SELECT COALESCE(SUM(amount), 0) as total FROM painter_point_transactions
                         WHERE painter_id = ? AND source = 'daily_bonus'
                           AND DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) = ?`,
                        [painterId, todayStr]
                    );
                    const alreadyEarned = parseFloat(todayBonus[0].total);
                    const remaining = Math.max(0, bonusCap - alreadyEarned);
                    dailyBonusPoints = Math.min(bonusExtra, remaining);
                    break;
                }
            }
        }
    } catch (e) {
        console.error('[Points] Daily bonus check failed:', e.message);
    }

    // Award points (with level multiplier). Each step is guarded by a ledger
    // existence check (M1) so a retry after a partial failure skips the parts
    // that already committed.
    if (totalRegularPoints > 0 && !(await invoiceAwardExists(painterId, 'regular', billingSource, invoice.invoice_id))) {
        await addPointsWithMultiplier(painterId, 'regular', totalRegularPoints, billingSource,
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }
    if (totalAnnualPoints > 0 && !(await invoiceAwardExists(painterId, 'annual', billingSource, invoice.invoice_id))) {
        await addPointsWithMultiplier(painterId, 'annual', totalAnnualPoints, billingSource,
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }

    // Award daily bonus points if applicable (apply level multiplier so Gold/Diamond painters keep their tier bonus)
    if (dailyBonusPoints > 0 && !(await invoiceAwardExists(painterId, 'regular', 'daily_bonus', invoice.invoice_id))) {
        await addPointsWithMultiplier(painterId, 'regular', dailyBonusPoints, 'daily_bonus',
            invoice.invoice_id, 'invoice', 'Daily bonus product multiplier', createdBy);
    }

    // Process referral points
    let totalReferralPoints = 0;
    const [referral] = await pool.query(
        'SELECT * FROM painter_referrals WHERE referred_id = ? AND status = "active"',
        [painterId]
    );
    if (referral.length > 0) {
        const ref = referral[0];
        // M1: the referral award AND the total_bills increment are guarded
        // together — a retried invoice must not bump the tier counter twice.
        // Residual window (accepted): addPoints commits its own transaction, so
        // if the painter_referrals UPDATE below fails right after it, the retry
        // skips both and this bill never bumps total_bills.
        const alreadyReferred = await invoiceAwardExists(ref.referrer_id, 'regular', 'referral', invoice.invoice_id);
        if (alreadyReferred) {
            // Retry after the award committed: surface the already-awarded
            // amount so the re-inserted claim row doesn't record 0.
            const [prior] = await pool.query(
                `SELECT amount FROM painter_point_transactions
                 WHERE painter_id = ? AND pool = 'regular' AND source = 'referral' AND reference_id = ? AND type = 'earn' LIMIT 1`,
                [ref.referrer_id, String(invoice.invoice_id)]
            );
            if (prior.length) totalReferralPoints = parseFloat(prior[0].amount);
        }
        if (!alreadyReferred) {
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
    }

    // Update the claim row with the computed point totals. The row was
    // INSERTed at the top of this function with zeros as a placeholder.
    await pool.query(
        `UPDATE painter_invoices_processed
            SET regular_points = ?, annual_points = ?, referral_points = ?
          WHERE id = ?`,
        [totalRegularPoints, totalAnnualPoints, totalReferralPoints, claimedRowId]
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

        // Sum purchase total for this period. The same underlying Zoho invoice
        // may appear as TWO rows for one painter (direct_billing + salesperson
        // attribution — distinct invoice_id strings like ZINV-X-direct /
        // ZINV-X-salesperson but the same zoho_invoice_id), so count each
        // invoice once (M9/Q-B3). Rows without a zoho_invoice_id (EST-* estimate
        // rows) are already unique per invoice_id.
        const [totals] = await pool.query(
            `SELECT COALESCE(SUM(t.invoice_total), 0) AS total
             FROM (
                 SELECT MAX(invoice_total) AS invoice_total
                 FROM painter_invoices_processed
                 WHERE painter_id = ? AND invoice_date BETWEEN ? AND ?
                 GROUP BY COALESCE(NULLIF(zoho_invoice_id, ''), invoice_id)
             ) t`,
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
        // Oldest UNPAID self-billing invoice (M3/Q-B1). Payment state lives on
        // the linked Zoho invoice (zoho_invoices.balance). The Zoho link is
        // pip.zoho_invoice_id where stamped (backfill rows, credit-flow
        // estimate pushes), falling back to pip.invoice_id — the billing
        // module passes the raw Zoho invoice id AS invoice_id. Rows with no
        // resolvable link never count: confirm-payment EST-* rows are paid by
        // definition (points only awarded after payment is recorded).
        const [oldest] = await pool.query(
            `SELECT pip.invoice_date, DATEDIFF(CURDATE(), pip.invoice_date) as days_overdue
             FROM painter_invoices_processed pip
             JOIN zoho_invoices zi
               ON zi.zoho_invoice_id = COALESCE(NULLIF(pip.zoho_invoice_id, ''), pip.invoice_id)
             WHERE pip.painter_id = ? AND pip.billing_type = 'self'
               AND zi.balance > 0 AND zi.status NOT IN ('void', 'draft')
             ORDER BY pip.invoice_date ASC LIMIT 1`,
            [painter.id]
        );
        if (!oldest.length) {
            // Nothing unpaid — clear any stale overdue counter from earlier runs.
            await pool.query('UPDATE painters SET credit_overdue_days = 0 WHERE id = ? AND credit_overdue_days <> 0', [painter.id]);
            continue;
        }

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

            // M3/Q-B1: reduce credit_used by what was actually debited so the
            // daily cron doesn't re-debit the same exposure tomorrow.
            const debited = Math.round((amountToDebit - remaining) * 100) / 100;
            if (debited > 0) {
                await pool.query(
                    'UPDATE painters SET credit_used = GREATEST(0, credit_used - ?) WHERE id = ?',
                    [debited, painter.id]
                );
            }

            processed++;
        }
    }

    return { processed };
}

// ═══════════════════════════════════════════
// BALANCE DRIFT CHECK (M5)
// ═══════════════════════════════════════════

/**
 * Compares each painter's denormalized balances (painters.regular_points /
 * annual_points) against the SUM of their ledger entries. A mismatch beyond a
 * rounding epsilon means some write path skipped the ledger (or vice versa) —
 * report it, never auto-fix.
 */
async function checkPointsDrift() {
    const [drifted] = await pool.query(
        `SELECT * FROM (
             SELECT p.id, p.full_name,
                    p.regular_points, p.annual_points,
                    COALESCE(l.ledger_regular, 0) AS ledger_regular,
                    COALESCE(l.ledger_annual, 0) AS ledger_annual
             FROM painters p
             LEFT JOIN (
                 SELECT painter_id,
                        SUM(CASE WHEN pool = 'regular' THEN amount ELSE 0 END) AS ledger_regular,
                        SUM(CASE WHEN pool = 'annual' THEN amount ELSE 0 END) AS ledger_annual
                 FROM painter_point_transactions
                 GROUP BY painter_id
             ) l ON l.painter_id = p.id
         ) x
         WHERE ABS(x.regular_points - x.ledger_regular) > 0.01
            OR ABS(x.annual_points - x.ledger_annual) > 0.01`
    );
    for (const p of drifted) {
        console.error(
            `[Points] DRIFT painter ${p.id} (${p.full_name}): ` +
            `regular ${p.regular_points} vs ledger ${p.ledger_regular}; ` +
            `annual ${p.annual_points} vs ledger ${p.ledger_annual}`
        );
    }
    return { drifted: drifted.length, painters: drifted };
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
    // Idempotency guard: skip if a transaction for this attendance already exists.
    // Prevents double-credit if the caller (admin attendance recorder, cron retry, etc.) fires twice.
    const [existing] = await pool.query(
        `SELECT id FROM painter_point_transactions
         WHERE painter_id = ? AND source = 'attendance' AND reference_id = ? LIMIT 1`,
        [painterId, String(attendanceId)]
    );
    if (existing.length) return 0;

    const [config] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'painter_attendance_points'");
    const points = config.length ? parseFloat(config[0].config_value) : 5;

    if (points > 0) {
        await addPointsWithMultiplier(painterId, 'regular', points, 'attendance',
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

// ═══════════════════════════════════════════
// LEVEL SYSTEM
// ═══════════════════════════════════════════

async function getLevelMultiplier(painterId) {
    const [rows] = await pool.query(
        `SELECT pl.multiplier FROM painters p
         JOIN painter_levels pl ON pl.level_name = p.current_level
         WHERE p.id = ?`,
        [painterId]
    );
    return rows.length ? parseFloat(rows[0].multiplier) : 1.0;
}

async function addPointsWithMultiplier(painterId, pointPool, baseAmount, source, refId, refType, description, createdBy) {
    const multiplier = await getLevelMultiplier(painterId);
    const adjustedAmount = Math.round(baseAmount * multiplier * 100) / 100;
    const result = await addPoints(painterId, pointPool, adjustedAmount, source, refId, refType,
        multiplier > 1 ? `${description} (${multiplier}x level bonus)` : description, createdBy);
    // Check for level-up after awarding points — sends notification if leveled up
    const levelUp = await checkLevelUp(painterId);
    if (levelUp) {
        try {
            const painterNotificationService = require('./painter-notification-service');
            const [lvl] = await pool.query('SELECT multiplier FROM painter_levels WHERE level_name = ?', [levelUp.newLevel]);
            const notif = painterNotificationService.getRetentionNotification('level_up', levelUp.newLevel, lvl[0]?.multiplier || 1);
            painterNotificationService.sendToPainter(painterId, notif).catch(e =>
                console.error(`[Points] Level-up notification failed:`, e.message)
            );
        } catch (e) { /* notification service may not be initialized yet */ }
    }
    return { balance: result, levelUp };
}

async function checkLevelUp(painterId) {
    const [painter] = await pool.query(
        'SELECT current_level, total_earned_regular, total_earned_annual, full_name FROM painters WHERE id = ?',
        [painterId]
    );
    if (!painter.length) return null;

    const p = painter[0];
    const lifetime = parseFloat(p.total_earned_regular) + parseFloat(p.total_earned_annual);

    const [levels] = await pool.query(
        'SELECT * FROM painter_levels WHERE min_points <= ? ORDER BY min_points DESC LIMIT 1',
        [lifetime]
    );
    if (!levels.length) return null;

    const newLevel = levels[0].level_name;
    if (newLevel !== p.current_level) {
        await pool.query('UPDATE painters SET current_level = ?, card_generated_at = NULL, id_card_generated_at = NULL WHERE id = ?', [newLevel, painterId]);
        return { previousLevel: p.current_level, newLevel, painterName: p.full_name };
    }
    return null;
}

async function queueClawback(painterId, amount, reason, source = 'attendance') {
    await pool.query(
        'INSERT INTO painter_clawback_pending (painter_id, amount, reason, source) VALUES (?, ?, ?, ?)',
        [painterId, amount, reason, source]
    );
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
    checkPointsDrift,
    requestWithdrawal,
    processWithdrawal,
    awardAttendancePoints,
    generateReferralCode,
    getLevelMultiplier,
    addPointsWithMultiplier,
    checkLevelUp,
    queueClawback
};
