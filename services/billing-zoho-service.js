/**
 * Billing Zoho Service
 * Shared service for Zoho contact resolution and invoice push from the billing module.
 *
 * Exports: { setPool, setPointsEngine, resolveZohoContact, pushInvoiceToZoho }
 */

const zohoAPI = require('./zoho-api');

let pool;
let pointsEngine;

function setPool(p) { pool = p; }
function setPointsEngine(pe) { pointsEngine = pe; }

// ═══════════════════════════════════════════
// RESOLVE ZOHO CONTACT
// ═══════════════════════════════════════════

/**
 * Resolve or create a Zoho contact for the given customer type.
 * @param {string} customerType - 'painter' or 'customer'
 * @param {Object} opts - { customerId, painterId, customerName, customerPhone }
 * @returns {Promise<string>} zohoContactId
 */
async function resolveZohoContact(customerType, { customerId, painterId, customerName, customerPhone }) {
    // Painter lookup
    if (customerType === 'painter' && painterId) {
        // A painter is synced to Zoho as a CONTACT — but the painter-sync writes
        // that contact id to painters.zoho_customer_id while this billing path
        // historically only read zoho_contact_id. A synced painter (zoho_customer_id
        // set, zoho_contact_id NULL) therefore created a DUPLICATE Zoho contact on
        // the first invoice push. Read BOTH and prefer either existing id.
        const [rows] = await pool.query(
            'SELECT zoho_contact_id, zoho_customer_id, full_name, phone FROM painters WHERE id = ?',
            [painterId]
        );
        if (!rows.length) throw new Error(`Painter ${painterId} not found`);

        const painter = rows[0];
        const existing = painter.zoho_contact_id || painter.zoho_customer_id;
        if (existing) {
            // Backfill zoho_contact_id when only zoho_customer_id was set, so both
            // columns stay consistent for future lookups.
            if (!painter.zoho_contact_id) {
                await pool.query('UPDATE painters SET zoho_contact_id = ? WHERE id = ?', [existing, painterId]);
            }
            return existing;
        }

        // Create contact in Zoho (neither id set)
        const contactName = painter.full_name || customerName || `Painter ${painterId}`;
        const phone = painter.phone || customerPhone;
        const result = await zohoAPI.createContact({
            contact_name: contactName,
            contact_type: 'customer',
            phone: phone
        });

        const contactId = result && result.contact && result.contact.contact_id;
        if (!contactId) throw new Error('Failed to create Zoho contact for painter');

        // Save back to BOTH painter columns so the sync + billing paths agree.
        await pool.query('UPDATE painters SET zoho_contact_id = ?, zoho_customer_id = COALESCE(zoho_customer_id, ?) WHERE id = ?', [contactId, contactId, painterId]);
        return contactId;
    }

    // Customer lookup (column is zoho_contact_id — the old zoho_customer_id
    // name doesn't exist in zoho_customers_map, so every customer-type push
    // died on an Unknown-column SQL error before this fix)
    if (customerType === 'customer' && customerId) {
        const [rows] = await pool.query(
            'SELECT zoho_contact_id FROM zoho_customers_map WHERE id = ?',
            [customerId]
        );
        if (rows.length && rows[0].zoho_contact_id) {
            return rows[0].zoho_contact_id;
        }
    }

    // Fallback: create new contact
    if (!customerName) throw new Error('Customer name required to create Zoho contact');
    const result = await zohoAPI.createContact({
        contact_name: customerName,
        contact_type: 'customer',
        phone: customerPhone || undefined
    });

    const contactId = result && result.contact && result.contact.contact_id;
    if (!contactId) throw new Error('Failed to create Zoho contact');
    return contactId;
}

// ═══════════════════════════════════════════
// PUSH INVOICE TO ZOHO
// ═══════════════════════════════════════════

/**
 * Push a billing invoice to Zoho Books.
 * @param {number} invoiceId - billing_invoices.id
 * @param {number} userId - admin/staff user performing the push
 * @returns {Promise<{ zohoInvoiceId, zohoInvoiceNumber, pointsResult }>}
 */
async function pushInvoiceToZoho(invoiceId, userId, options = {}) {
    // 1. Load invoice
    const [invoices] = await pool.query(
        'SELECT * FROM billing_invoices WHERE id = ?',
        [invoiceId]
    );
    if (!invoices.length) throw new Error(`Invoice ${invoiceId} not found`);
    const invoice = invoices[0];

    if (invoice.zoho_status === 'pushed') {
        throw new Error(`Invoice ${invoiceId} already pushed to Zoho`);
    }

    // Salesperson (owner requirement 2026-06-12: mandatory on every Zoho push —
    // Zoho's org makes the field required). Priority: the explicitly chosen one,
    // else the value already on the invoice, else — for painter invoices — the
    // painter's mapped Zoho salesperson (the painter-program concept reused
    // here). Resolve the display name from the local salesperson master.
    let salespersonId = options.salespersonId || invoice.zoho_salesperson_id || null;
    let salespersonName = null;
    if (!salespersonId && invoice.customer_type === 'painter' && invoice.painter_id) {
        const [pr] = await pool.query('SELECT zoho_salesperson_id FROM painters WHERE id = ?', [invoice.painter_id]);
        if (pr.length && pr[0].zoho_salesperson_id) salespersonId = pr[0].zoho_salesperson_id;
    }
    if (!salespersonId) {
        const err = new Error('A salesperson is required to push this invoice to Zoho. Pick one and try again.');
        err.code = 'SALESPERSON_REQUIRED';
        throw err;
    }
    try {
        const [sp] = await pool.query('SELECT salesperson_name FROM zoho_salespersons WHERE zoho_salesperson_id = ? LIMIT 1', [salespersonId]);
        if (sp.length) salespersonName = sp[0].salesperson_name;
        if (!salespersonName) {
            const [spm] = await pool.query('SELECT zoho_salesperson_name FROM painter_zoho_salesperson_map WHERE zoho_salesperson_id = ? LIMIT 1', [salespersonId]);
            if (spm.length) salespersonName = spm[0].zoho_salesperson_name;
        }
    } catch { /* name is best-effort */ }

    // Location/branch to post the invoice to (owner request 2026-06-12).
    let locationId = options.locationId || invoice.zoho_location_id || null;
    let locationName = null;
    if (locationId) {
        try {
            const [loc] = await pool.query('SELECT zoho_location_name FROM zoho_locations_map WHERE zoho_location_id = ? LIMIT 1', [locationId]);
            if (loc.length) locationName = loc[0].zoho_location_name;
        } catch { /* name is best-effort */ }
    }

    // 2. Load items
    const [items] = await pool.query(
        'SELECT * FROM billing_invoice_items WHERE invoice_id = ? AND deleted_at IS NULL',
        [invoiceId]
    );
    if (!items.length) throw new Error(`Invoice ${invoiceId} has no items`);

    // 3. Resolve Zoho contact
    const zohoContactId = await resolveZohoContact(invoice.customer_type, {
        customerId: invoice.customer_id,
        painterId: invoice.painter_id,
        customerName: invoice.customer_name,
        customerPhone: invoice.customer_phone
    });

    // 4. Push eligibility gate (owner policy 2026-06-12): an invoice may be
    // pushed ONLY when it is fully PAID, or the customer has enough available
    // credit limit to cover the outstanding balance. (Earlier the credit check
    // was "non-blocking" and customers outside the credit system passed —
    // unpaid zero-credit invoices could be pushed.)
    const balanceDue = parseFloat(invoice.balance_due != null
        ? invoice.balance_due
        : (invoice.grand_total - (invoice.amount_paid || 0))) || 0;
    if (invoice.payment_status !== 'paid' && balanceDue > 0.01) {
        let credit = { allowed: false, reason: 'Customer is not in the credit system' };
        try {
            const { checkCreditBeforeInvoice } = require('../routes/credit-limits');
            const result = await checkCreditBeforeInvoice(pool, zohoContactId, balanceDue);
            if (result) credit = result;
        } catch (err) {
            credit = { allowed: false, reason: 'Credit check failed: ' + err.message };
        }
        // checkCreditBeforeInvoice returns allowed:true for customers NOT in
        // the credit system (permissive default other callers rely on). For
        // the push gate, eligibility requires an actual evaluated limit —
        // detected structurally by the credit_limit field being present.
        const creditEligible = credit.allowed === true && credit.credit_limit != null;
        if (!creditEligible) {
            const gateErr = new Error(
                `Invoice is not paid (balance ₹${balanceDue.toFixed(2)}) and the customer has no eligible credit — ${credit.reason}. ` +
                'Record the payment first, or set a credit limit for this customer.'
            );
            gateErr.code = 'PUSH_GATE';
            throw gateErr;
        }
    }

    // 5. Create Zoho invoice
    const now = new Date();
    const invoiceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const lineItems = items.map(item => ({
        item_id: item.zoho_item_id,
        quantity: parseFloat(item.quantity),
        rate: parseFloat(item.unit_price)
    }));

    const zohoResult = await zohoAPI.createInvoice({
        customer_id: zohoContactId,
        date: invoiceDate,
        line_items: lineItems,
        salesperson_id: salespersonId,
        ...(locationId ? { location_id: locationId } : {})
    });

    const zohoInvoice = zohoResult && zohoResult.invoice;
    if (!zohoInvoice || !zohoInvoice.invoice_id) {
        throw new Error('Failed to create Zoho invoice');
    }

    const zohoInvoiceId = zohoInvoice.invoice_id;
    const zohoInvoiceNumber = zohoInvoice.invoice_number;

    // Take it OUT OF DRAFT (owner 2026-06-12): a staff push is submitted for the
    // admin's Zoho approval; an admin push is approved directly. Done before
    // recording any payment (Zoho won't accept a payment on a draft invoice).
    const finalizeState = (await zohoAPI.finalizeDocument('invoice', zohoInvoiceId, !!options.isAdmin)).state;

    // 6. Award painter points if applicable
    let pointsResult = null;
    if (invoice.customer_type === 'painter' && invoice.painter_id && pointsEngine) {
        try {
            const invoiceForPoints = {
                invoice_id: zohoInvoiceId,
                invoice_number: zohoInvoiceNumber,
                zoho_invoice_id: zohoInvoiceId, // explicit Zoho link for the credit overdue check (M3)
                date: invoiceDate,
                total: parseFloat(invoice.grand_total),
                line_items: items.map(item => ({
                    item_id: item.zoho_item_id,
                    quantity: parseFloat(item.quantity),
                    item_total: parseFloat(item.line_total)
                }))
            };
            pointsResult = await pointsEngine.processInvoice(
                invoice.painter_id,
                invoiceForPoints,
                'self',
                userId
            );
        } catch (err) {
            console.error('[billing-zoho] Points award error:', err.message);
        }
    }

    // 7. Record payment in Zoho if amount_paid > 0
    const amountPaid = parseFloat(invoice.amount_paid) || 0;
    if (amountPaid > 0) {
        try {
            await zohoAPI.createPayment({
                customer_id: zohoContactId,
                payment_mode: 'Cash',
                amount: amountPaid,
                date: invoiceDate,
                invoices: [{
                    invoice_id: zohoInvoiceId,
                    amount_applied: amountPaid
                }]
            });
        } catch (err) {
            console.error('[billing-zoho] Payment recording error:', err.message);
        }
    }

    // 8. Update billing_invoices (also stamp the salesperson + location used)
    await pool.query(
        `UPDATE billing_invoices
         SET zoho_status = ?, zoho_invoice_id = ?, zoho_invoice_number = ?,
             zoho_salesperson_id = ?, zoho_salesperson_name = ?,
             zoho_location_id = ?, zoho_location_name = ?
         WHERE id = ?`,
        ['pushed', zohoInvoiceId, zohoInvoiceNumber, salespersonId, salespersonName, locationId, locationName, invoiceId]
    );

    // 9. Return result
    return { zohoInvoiceId, zohoInvoiceNumber, salespersonId, salespersonName, locationId, locationName, zohoState: finalizeState, pointsResult };
}

module.exports = { setPool, setPointsEngine, resolveZohoContact, pushInvoiceToZoho };
