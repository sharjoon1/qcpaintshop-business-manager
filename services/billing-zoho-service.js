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
        const [rows] = await pool.query(
            'SELECT zoho_contact_id, full_name, phone FROM painters WHERE id = ?',
            [painterId]
        );
        if (!rows.length) throw new Error(`Painter ${painterId} not found`);

        const painter = rows[0];
        if (painter.zoho_contact_id) {
            return painter.zoho_contact_id;
        }

        // Create contact in Zoho
        const contactName = painter.full_name || customerName || `Painter ${painterId}`;
        const phone = painter.phone || customerPhone;
        const result = await zohoAPI.createContact({
            contact_name: contactName,
            contact_type: 'customer',
            phone: phone
        });

        const contactId = result && result.contact && result.contact.contact_id;
        if (!contactId) throw new Error('Failed to create Zoho contact for painter');

        // Save back to painter record
        await pool.query('UPDATE painters SET zoho_contact_id = ? WHERE id = ?', [contactId, painterId]);
        return contactId;
    }

    // Customer lookup
    if (customerType === 'customer' && customerId) {
        const [rows] = await pool.query(
            'SELECT zoho_customer_id FROM zoho_customers_map WHERE id = ?',
            [customerId]
        );
        if (rows.length && rows[0].zoho_customer_id) {
            return rows[0].zoho_customer_id;
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
async function pushInvoiceToZoho(invoiceId, userId) {
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

    // 2. Load items
    const [items] = await pool.query(
        'SELECT * FROM billing_invoice_items WHERE invoice_id = ?',
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

    // 4. Credit limit check (non-blocking)
    try {
        const { checkCreditBeforeInvoice } = require('../routes/credit-limits');
        const creditResult = await checkCreditBeforeInvoice(pool, zohoContactId, invoice.grand_total);
        if (creditResult && !creditResult.allowed) {
            if (creditResult.reason && (creditResult.reason.includes('Credit limit') || creditResult.reason.includes('credit'))) {
                throw new Error(creditResult.reason);
            }
        }
    } catch (err) {
        // Only re-throw credit-related errors
        if (err.message && (err.message.includes('Credit limit') || err.message.includes('credit'))) {
            throw err;
        }
        // Swallow other errors (non-blocking)
    }

    // 5. Create Zoho invoice
    const invoiceDate = invoice.invoice_date
        ? new Date(invoice.invoice_date).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const lineItems = items.map(item => ({
        item_id: item.zoho_item_id || item.item_id,
        quantity: item.quantity,
        rate: item.rate
    }));

    const zohoResult = await zohoAPI.createInvoice({
        customer_id: zohoContactId,
        date: invoiceDate,
        line_items: lineItems
    });

    const zohoInvoice = zohoResult && zohoResult.invoice;
    if (!zohoInvoice || !zohoInvoice.invoice_id) {
        throw new Error('Failed to create Zoho invoice');
    }

    const zohoInvoiceId = zohoInvoice.invoice_id;
    const zohoInvoiceNumber = zohoInvoice.invoice_number;

    // 6. Award painter points if applicable
    let pointsResult = null;
    if (invoice.customer_type === 'painter' && invoice.painter_id && pointsEngine) {
        try {
            const invoiceForPoints = {
                invoice_id: zohoInvoiceId,
                invoice_number: zohoInvoiceNumber,
                date: invoiceDate,
                total: invoice.grand_total,
                line_items: items.map(item => ({
                    item_id: item.zoho_item_id || item.item_id,
                    quantity: item.quantity,
                    item_total: item.item_total || (item.quantity * item.rate)
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

    // 8. Update billing_invoices
    await pool.query(
        'UPDATE billing_invoices SET zoho_status = ?, zoho_invoice_id = ?, zoho_invoice_number = ? WHERE id = ?',
        ['pushed', zohoInvoiceId, zohoInvoiceNumber, invoiceId]
    );

    // 9. Return result
    return { zohoInvoiceId, zohoInvoiceNumber, pointsResult };
}

module.exports = { setPool, setPointsEngine, resolveZohoContact, pushInvoiceToZoho };
