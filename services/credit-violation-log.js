/**
 * Shared best-effort audit log for a refused / over-limit invoice push.
 *
 * Writes one row to credit_limit_violations using the REAL prod columns. Both the
 * billing-Zoho push gate and the painter-admin estimate→invoice path log here;
 * the painter path previously inserted nonexistent columns (violation_type,
 * invoice_amount) and omitted the NOT NULL customer_id/attempted_amount, so the
 * INSERT threw on prod and the (swallowed) failure meant those violations were
 * never recorded. Callers should still wrap this in try/catch — a logging failure
 * must never mask the gate decision.
 *
 * @param {object} pool - mysql2 pool
 * @param {object} f - { customerId, zohoCustomerMapId, invoiceNumber,
 *   attemptedAmount, creditLimit, creditUsed, availableCredit, staffId, branchId, actionTaken }
 */
async function logCreditViolation(pool, f = {}) {
    await pool.query(
        `INSERT INTO credit_limit_violations
            (customer_id, zoho_customer_map_id, invoice_number, attempted_amount,
             credit_limit, credit_used, available_credit, staff_id, branch_id, action_taken)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
            f.customerId || 0,
            f.zohoCustomerMapId || null,
            f.invoiceNumber || null,
            Number(f.attemptedAmount) || 0,
            Number(f.creditLimit) || 0,
            Number(f.creditUsed) || 0,
            Number(f.availableCredit) || 0,
            f.staffId || null,
            f.branchId || null,
            f.actionTaken || 'blocked',
        ]
    );
}

module.exports = { logCreditViolation };
