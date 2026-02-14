/**
 * ZOHO BOOKS API WRAPPER
 * Provides methods to interact with Zoho Books REST API
 *
 * Modules: Invoices, Payments, Contacts, Items, Reports
 * All methods auto-handle authentication via zoho-oauth service
 *
 * Usage:
 *   const zohoAPI = require('../services/zoho-api');
 *   zohoAPI.setPool(pool);
 *   const invoices = await zohoAPI.getInvoices({ status: 'overdue' });
 */

const https = require('https');
const zohoOAuth = require('./zoho-oauth');

let pool;

// Zoho Books API base (India datacenter)
const API_BASE = 'https://www.zohoapis.in/books/v3';

/**
 * Convert Zoho datetime (ISO 8601 with timezone) to MySQL DATETIME format
 * e.g. '2024-10-19T17:25:44+0530' -> '2024-10-19 17:25:44'
 */
function toMySQLDatetime(zohoDatetime) {
    if (!zohoDatetime) return null;
    try {
        const d = new Date(zohoDatetime);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 19).replace('T', ' ');
    } catch (e) {
        return null;
    }
}

function setPool(dbPool) {
    pool = dbPool;
    zohoOAuth.setPool(dbPool);
}

// ========================================
// INVOICES
// ========================================

/**
 * Get invoices from Zoho Books
 * @param {Object} params - Query params: status, customer_id, date, page, per_page, sort_column, sort_order
 */
async function getInvoices(params = {}) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const query = { organization_id: orgId, ...params };
    return await apiGet('/invoices', query);
}

/**
 * Get single invoice by Zoho ID
 */
async function getInvoice(invoiceId) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet(`/invoices/${invoiceId}`, { organization_id: orgId });
}

/**
 * Create invoice in Zoho Books
 */
async function createInvoice(invoiceData) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiPost(`/invoices?organization_id=${orgId}`, invoiceData);
}

/**
 * Get overdue invoices
 */
async function getOverdueInvoices() {
    return await getInvoices({ status: 'overdue', sort_column: 'due_date', sort_order: 'A' });
}

/**
 * Get unpaid invoices (sent + overdue + partially_paid)
 */
async function getUnpaidInvoices() {
    const results = [];
    for (const status of ['sent', 'overdue', 'partially_paid']) {
        const response = await getInvoices({ status });
        if (response.invoices) {
            results.push(...response.invoices);
        }
    }
    return results;
}

// ========================================
// PAYMENTS
// ========================================

/**
 * Get customer payments
 */
async function getPayments(params = {}) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/customerpayments', { organization_id: orgId, ...params });
}

/**
 * Get single payment
 */
async function getPayment(paymentId) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet(`/customerpayments/${paymentId}`, { organization_id: orgId });
}

/**
 * Record a payment in Zoho Books
 */
async function createPayment(paymentData) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiPost(`/customerpayments?organization_id=${orgId}`, paymentData);
}

// ========================================
// CONTACTS (Customers/Vendors)
// ========================================

/**
 * Get contacts from Zoho Books
 */
async function getContacts(params = {}) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/contacts', { organization_id: orgId, ...params });
}

/**
 * Get single contact
 */
async function getContact(contactId) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet(`/contacts/${contactId}`, { organization_id: orgId });
}

/**
 * Create contact in Zoho Books
 */
async function createContact(contactData) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiPost(`/contacts?organization_id=${orgId}`, contactData);
}

/**
 * Get customer balance (outstanding)
 */
async function getCustomerBalance(contactId) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const response = await apiGet(`/contacts/${contactId}`, { organization_id: orgId });
    if (response.contact) {
        return {
            contact_id: contactId,
            contact_name: response.contact.contact_name,
            outstanding: response.contact.outstanding_receivable_amount || 0,
            unused_credits: response.contact.unused_credits_receivable_amount || 0
        };
    }
    return null;
}

// ========================================
// ITEMS (Products)
// ========================================

/**
 * Get items from Zoho Books
 */
async function getItems(params = {}) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/items', { organization_id: orgId, ...params });
}

/**
 * Get single item
 */
async function getItem(itemId) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet(`/items/${itemId}`, { organization_id: orgId });
}

// ========================================
// REPORTS
// ========================================

/**
 * Get Profit & Loss report
 */
async function getProfitAndLoss(fromDate, toDate) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/reports/profitandloss', {
        organization_id: orgId,
        from_date: fromDate,
        to_date: toDate
    });
}

/**
 * Get Balance Sheet
 */
async function getBalanceSheet(date) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/reports/balancesheet', {
        organization_id: orgId,
        date: date
    });
}

/**
 * Get Sales by Customer report
 */
async function getSalesByCustomer(fromDate, toDate) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/reports/salesbycustomer', {
        organization_id: orgId,
        from_date: fromDate,
        to_date: toDate
    });
}

/**
 * Get Sales by Item report
 */
async function getSalesByItem(fromDate, toDate) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/reports/salesbyitem', {
        organization_id: orgId,
        from_date: fromDate,
        to_date: toDate
    });
}

/**
 * Get Receivables Summary (Aging)
 */
async function getReceivablesSummary() {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/reports/receivablesummary', {
        organization_id: orgId
    });
}

/**
 * Get Invoice Aging Summary
 */
async function getAgingSummary() {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/reports/agingsummary', {
        organization_id: orgId
    });
}

// ========================================
// SYNC METHODS (Zoho → MySQL)
// ========================================

/**
 * Sync invoices from Zoho to local MySQL
 * Returns sync stats
 */
async function syncInvoices(triggeredBy = null) {
    if (!pool) throw new Error('Database pool not initialized');

    // Create sync log entry
    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('invoices', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        let page = 1;
        let hasMore = true;
        let totalSynced = 0;
        let totalFailed = 0;

        while (hasMore) {
            const response = await getInvoices({ page, per_page: 200 });

            if (!response.invoices || response.invoices.length === 0) {
                hasMore = false;
                break;
            }

            for (const inv of response.invoices) {
                try {
                    // Find local customer mapping
                    const [custMap] = await pool.query(
                        `SELECT local_customer_id FROM zoho_customers_map WHERE zoho_contact_id = ? LIMIT 1`,
                        [inv.customer_id]
                    );

                    await pool.query(`
                        INSERT INTO zoho_invoices (
                            zoho_invoice_id, zoho_customer_id, local_customer_id,
                            invoice_number, reference_number, invoice_date, due_date,
                            currency_code, sub_total, tax_total, total, balance,
                            status, customer_name, created_time, last_modified_time, last_synced_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                        ON DUPLICATE KEY UPDATE
                            balance = VALUES(balance),
                            status = VALUES(status),
                            sub_total = VALUES(sub_total),
                            tax_total = VALUES(tax_total),
                            total = VALUES(total),
                            last_modified_time = VALUES(last_modified_time),
                            last_synced_at = NOW(),
                            updated_at = CURRENT_TIMESTAMP
                    `, [
                        inv.invoice_id, inv.customer_id,
                        custMap.length > 0 ? custMap[0].local_customer_id : null,
                        inv.invoice_number, inv.reference_number || null,
                        inv.date, inv.due_date,
                        inv.currency_code || 'INR',
                        inv.sub_total || 0, inv.tax_total || 0,
                        inv.total || 0, inv.balance || 0,
                        mapZohoStatus(inv.status), inv.customer_name,
                        toMySQLDatetime(inv.created_time), toMySQLDatetime(inv.last_modified_time)
                    ]);
                    totalSynced++;
                } catch (e) {
                    console.error(`[ZohoSync] Invoice ${inv.invoice_number} failed:`, e.message);
                    totalFailed++;
                }
            }

            hasMore = response.page_context?.has_more_page || false;
            page++;
        }

        // Update sync log
        await pool.query(`
            UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_failed = ?, records_total = ?, completed_at = NOW()
            WHERE id = ?
        `, [totalSynced, totalFailed, totalSynced + totalFailed, syncId]);

        return { success: true, synced: totalSynced, failed: totalFailed };

    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

/**
 * Sync customer contacts from Zoho to local mapping table
 */
async function syncCustomers(triggeredBy = null) {
    if (!pool) throw new Error('Database pool not initialized');

    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('customers', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        let page = 1;
        let hasMore = true;
        let totalSynced = 0;

        while (hasMore) {
            const response = await getContacts({ page, per_page: 200, contact_type: 'customer' });

            if (!response.contacts || response.contacts.length === 0) {
                hasMore = false;
                break;
            }

            for (const contact of response.contacts) {
                // Try to match with local customer by phone or email
                let localCustomerId = null;
                if (contact.phone || contact.email) {
                    const [localMatch] = await pool.query(
                        `SELECT id FROM customers WHERE phone = ? OR email = ? LIMIT 1`,
                        [contact.phone || '', contact.email || '']
                    );
                    if (localMatch.length > 0) {
                        localCustomerId = localMatch[0].id;
                    }
                }

                await pool.query(`
                    INSERT INTO zoho_customers_map (
                        local_customer_id, zoho_contact_id, zoho_contact_name,
                        zoho_email, zoho_phone, zoho_gst_no,
                        zoho_outstanding, zoho_unused_credits, last_synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE
                        local_customer_id = COALESCE(VALUES(local_customer_id), local_customer_id),
                        zoho_contact_name = VALUES(zoho_contact_name),
                        zoho_email = VALUES(zoho_email),
                        zoho_phone = VALUES(zoho_phone),
                        zoho_gst_no = VALUES(zoho_gst_no),
                        zoho_outstanding = VALUES(zoho_outstanding),
                        zoho_unused_credits = VALUES(zoho_unused_credits),
                        last_synced_at = NOW()
                `, [
                    localCustomerId, contact.contact_id, contact.contact_name,
                    contact.email || null, contact.phone || null,
                    contact.gst_no || null,
                    contact.outstanding_receivable_amount || 0,
                    contact.unused_credits_receivable_amount || 0
                ]);
                totalSynced++;
            }

            hasMore = response.page_context?.has_more_page || false;
            page++;
        }

        await pool.query(
            `UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_total = ?, completed_at = NOW() WHERE id = ?`,
            [totalSynced, totalSynced, syncId]
        );

        return { success: true, synced: totalSynced };

    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

/**
 * Sync payments from Zoho
 */
async function syncPayments(triggeredBy = null) {
    if (!pool) throw new Error('Database pool not initialized');

    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('payments', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        let page = 1;
        let hasMore = true;
        let totalSynced = 0;

        while (hasMore) {
            const response = await getPayments({ page, per_page: 200 });

            if (!response.customerpayments || response.customerpayments.length === 0) {
                hasMore = false;
                break;
            }

            for (const pmt of response.customerpayments) {
                const [custMap] = await pool.query(
                    `SELECT local_customer_id FROM zoho_customers_map WHERE zoho_contact_id = ? LIMIT 1`,
                    [pmt.customer_id]
                );

                await pool.query(`
                    INSERT INTO zoho_payments (
                        zoho_payment_id, zoho_invoice_id, zoho_customer_id,
                        local_customer_id, payment_number, payment_date,
                        amount, unused_amount, payment_mode,
                        reference_number, description, customer_name, last_synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE
                        amount = VALUES(amount),
                        unused_amount = VALUES(unused_amount),
                        payment_mode = VALUES(payment_mode),
                        last_synced_at = NOW()
                `, [
                    pmt.payment_id, pmt.invoice_id || null, pmt.customer_id,
                    custMap.length > 0 ? custMap[0].local_customer_id : null,
                    pmt.payment_number, pmt.date,
                    pmt.amount || 0, pmt.unused_amount || 0,
                    pmt.payment_mode || null,
                    pmt.reference_number || null, pmt.description || null,
                    pmt.customer_name
                ]);
                totalSynced++;
            }

            hasMore = response.page_context?.has_more_page || false;
            page++;
        }

        await pool.query(
            `UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_total = ?, completed_at = NOW() WHERE id = ?`,
            [totalSynced, totalSynced, syncId]
        );

        return { success: true, synced: totalSynced };

    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

/**
 * Full sync - all entities
 */
async function fullSync(triggeredBy = null) {
    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('full', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        const results = {};

        console.log('[ZohoSync] Starting full sync...');

        // Sync in order: customers first (for mapping), then invoices, payments, items, locations, stock
        results.customers = await syncCustomers(triggeredBy);
        console.log(`[ZohoSync] Customers synced: ${results.customers.synced}`);

        results.invoices = await syncInvoices(triggeredBy);
        console.log(`[ZohoSync] Invoices synced: ${results.invoices.synced}`);

        results.payments = await syncPayments(triggeredBy);
        console.log(`[ZohoSync] Payments synced: ${results.payments.synced}`);

        // Sync items, locations, and stock (best-effort - don't fail full sync)
        try {
            results.items = await syncItems(triggeredBy);
            console.log(`[ZohoSync] Items synced: ${results.items.synced}`);
        } catch (e) {
            console.error('[ZohoSync] Items sync failed (non-fatal):', e.message);
            results.items = { synced: 0, error: e.message };
        }

        try {
            results.locations = await syncLocations(triggeredBy);
            console.log(`[ZohoSync] Locations synced: ${results.locations.synced}`);
        } catch (e) {
            console.error('[ZohoSync] Locations sync failed (non-fatal):', e.message);
            results.locations = { synced: 0, error: e.message };
        }

        try {
            results.stock = await syncLocationStock(triggeredBy);
            console.log(`[ZohoSync] Stock synced: ${results.stock.synced}`);
        } catch (e) {
            console.error('[ZohoSync] Stock sync failed (non-fatal):', e.message);
            results.stock = { synced: 0, error: e.message };
        }

        const totalSynced = results.customers.synced + results.invoices.synced + results.payments.synced
            + (results.items?.synced || 0) + (results.locations?.synced || 0) + (results.stock?.synced || 0);

        await pool.query(
            `UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_total = ?, completed_at = NOW() WHERE id = ?`,
            [totalSynced, totalSynced, syncId]
        );

        // Update last_full_sync config
        await pool.query(
            `UPDATE zoho_config SET config_value = NOW() WHERE config_key = 'last_full_sync'`
        );

        console.log(`[ZohoSync] Full sync completed. Total records: ${totalSynced}`);
        return { success: true, results };

    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

// ========================================
// DASHBOARD HELPERS
// ========================================

/**
 * Get Zoho dashboard stats from local cache
 */
async function getDashboardStats() {
    if (!pool) throw new Error('Database pool not initialized');

    const [[invoiceStats]] = await pool.query(`
        SELECT
            COUNT(*) as total_invoices,
            SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_count,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
            SUM(CASE WHEN status IN ('sent','overdue','partially_paid') THEN 1 ELSE 0 END) as unpaid_count,
            SUM(total) as total_revenue,
            SUM(balance) as total_outstanding,
            SUM(CASE WHEN status = 'overdue' THEN balance ELSE 0 END) as overdue_amount
        FROM zoho_invoices
    `);

    const [[paymentStats]] = await pool.query(`
        SELECT
            COUNT(*) as total_payments,
            SUM(amount) as total_collected,
            SUM(CASE WHEN payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN amount ELSE 0 END) as collected_last_30_days
        FROM zoho_payments
    `);

    const [[syncStatus]] = await pool.query(`
        SELECT sync_type, status, completed_at
        FROM zoho_sync_log
        ORDER BY id DESC LIMIT 1
    `);

    const [[customerCount]] = await pool.query(`
        SELECT COUNT(*) as total FROM zoho_customers_map
    `);

    return {
        invoices: invoiceStats,
        payments: paymentStats,
        customers: { total: customerCount?.total || 0 },
        last_sync: syncStatus || null
    };
}

// ========================================
// HELPERS
// ========================================

/**
 * Map Zoho invoice status to our ENUM
 */
function mapZohoStatus(zohoStatus) {
    const map = {
        'draft': 'draft',
        'sent': 'sent',
        'overdue': 'overdue',
        'paid': 'paid',
        'partially_paid': 'partially_paid',
        'void': 'void'
    };
    return map[zohoStatus] || 'draft';
}

/**
 * HTTP GET to Zoho Books API
 */
async function apiGet(endpoint, params = {}) {
    const token = await zohoOAuth.getAccessToken();
    const queryStr = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    const url = `${API_BASE}${endpoint}${queryStr ? '?' + queryStr : ''}`;

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'Authorization': `Zoho-oauthtoken ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.code === 57) {
                        // Rate limit - wait and retry would go here
                        reject(new Error('Zoho API rate limit exceeded'));
                    } else if (parsed.code && parsed.code !== 0) {
                        reject(new Error(`Zoho API error ${parsed.code}: ${parsed.message}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`Invalid JSON from Zoho: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Zoho API request timeout'));
        });
        req.end();
    });
}

/**
 * HTTP PUT to Zoho Books API
 */
async function apiPut(endpoint, body = {}) {
    const token = await zohoOAuth.getAccessToken();
    const url = `${API_BASE}${endpoint}`;
    const putData = JSON.stringify(body);

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'PUT',
            headers: {
                'Authorization': `Zoho-oauthtoken ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(putData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.code && parsed.code !== 0) {
                        reject(new Error(`Zoho API error ${parsed.code}: ${parsed.message}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`Invalid JSON from Zoho: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Zoho API request timeout'));
        });
        req.write(putData);
        req.end();
    });
}

/**
 * HTTP DELETE to Zoho Books API
 */
async function apiDelete(endpoint, params = {}) {
    const token = await zohoOAuth.getAccessToken();
    const queryStr = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    const url = `${API_BASE}${endpoint}${queryStr ? '?' + queryStr : ''}`;

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'DELETE',
            headers: {
                'Authorization': `Zoho-oauthtoken ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.code && parsed.code !== 0) {
                        reject(new Error(`Zoho API error ${parsed.code}: ${parsed.message}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`Invalid JSON from Zoho: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Zoho API request timeout'));
        });
        req.end();
    });
}

/**
 * HTTP POST to Zoho Books API
 */
async function apiPost(endpoint, body = {}) {
    const token = await zohoOAuth.getAccessToken();
    const url = `${API_BASE}${endpoint}`;
    const postData = JSON.stringify(body);

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Authorization': `Zoho-oauthtoken ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.code && parsed.code !== 0) {
                        reject(new Error(`Zoho API error ${parsed.code}: ${parsed.message}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`Invalid JSON from Zoho: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Zoho API request timeout'));
        });
        req.write(postData);
        req.end();
    });
}

// ========================================
// FEATURE 2: LOCATIONS & STOCK
// ========================================

const rateLimiter = require('./zoho-rate-limiter');

/**
 * Get locations/warehouses from Zoho Books
 * Tries /settings/warehouses first (Zoho Books inventory), falls back to /locations
 */
async function getLocations() {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;

    // Try /settings/warehouses (Zoho Books multi-location inventory)
    try {
        console.log('[ZohoAPI] Trying /settings/warehouses...');
        const response = await apiGet('/settings/warehouses', { organization_id: orgId });
        console.log('[ZohoAPI] Warehouses response keys:', Object.keys(response));
        if (response.warehouses && response.warehouses.length > 0) {
            console.log(`[ZohoAPI] Found ${response.warehouses.length} warehouses`);
            return { locations: response.warehouses };
        }
    } catch (e) {
        console.log('[ZohoAPI] /settings/warehouses failed:', e.message);
    }

    // Try /locations
    try {
        console.log('[ZohoAPI] Trying /locations...');
        const response = await apiGet('/locations', { organization_id: orgId });
        console.log('[ZohoAPI] Locations response keys:', Object.keys(response));
        if (response.locations && response.locations.length > 0) {
            console.log(`[ZohoAPI] Found ${response.locations.length} locations`);
            return response;
        }
    } catch (e) {
        console.log('[ZohoAPI] /locations failed:', e.message);
    }

    // Try /settings/warehouses without org_id in query (some APIs want it in header)
    try {
        console.log('[ZohoAPI] Trying /settings/warehouses (no org param)...');
        const response = await apiGet('/settings/warehouses', {});
        console.log('[ZohoAPI] Warehouses (no org) response keys:', Object.keys(response));
        if (response.warehouses) {
            return { locations: response.warehouses };
        }
    } catch (e) {
        console.log('[ZohoAPI] /settings/warehouses (no org) failed:', e.message);
    }

    console.log('[ZohoAPI] No locations found from any endpoint');
    return { locations: [] };
}

/**
 * Sync locations from Zoho and auto-map to local branches
 */
async function syncLocations(triggeredBy = null) {
    if (!pool) throw new Error('Database pool not initialized');

    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('locations', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        const response = await getLocations();
        const locations = response.locations || [];
        let totalSynced = 0;

        // Log the first location to see field names
        if (locations.length > 0) {
            console.log('[ZohoSync] First location object keys:', Object.keys(locations[0]));
            console.log('[ZohoSync] First location sample:', JSON.stringify(locations[0]).substring(0, 500));
        }

        for (const loc of locations) {
            // Zoho returns address as an object - stringify it for storage
            let addressStr = null;
            if (loc.address) {
                if (typeof loc.address === 'object') {
                    const a = loc.address;
                    addressStr = [a.address, a.street2, a.city, a.state, a.zip, a.country]
                        .filter(Boolean).join(', ');
                } else {
                    addressStr = String(loc.address);
                }
            }

            // Try multiple field names for the location name
            const locName = loc.location_name || loc.warehouse_name || loc.name || loc.label || '';
            const locId = loc.location_id || loc.warehouse_id;
            const displayName = locName || ('Location ' + locId);

            await pool.query(`
                INSERT INTO zoho_locations_map (zoho_location_id, zoho_location_name, is_primary, address, last_synced_at)
                VALUES (?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    zoho_location_name = VALUES(zoho_location_name),
                    address = VALUES(address),
                    last_synced_at = NOW()
            `, [
                locId,
                displayName,
                loc.is_primary ? 1 : 0,
                addressStr
            ]);

            // Auto-map to branches by name match
            if (locName) {
                const [branches] = await pool.query(
                    `SELECT id FROM branches WHERE LOWER(name) LIKE ? AND zoho_location_id IS NULL LIMIT 1`,
                    [`%${locName.toLowerCase()}%`]
                );
                if (branches.length > 0) {
                    await pool.query(`UPDATE branches SET zoho_location_id = ? WHERE id = ?`, [locId, branches[0].id]);
                    await pool.query(`UPDATE zoho_locations_map SET local_branch_id = ? WHERE zoho_location_id = ?`, [branches[0].id, locId]);
                }
            }

            totalSynced++;
        }

        await pool.query(
            `UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_total = ?, completed_at = NOW() WHERE id = ?`,
            [totalSynced, totalSynced, syncId]
        );

        return { success: true, synced: totalSynced };
    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

/**
 * Get item details with per-location stock from Zoho
 * Fetches items individually with rate limiting and quota checks
 */
async function getItemDetails(itemIds) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const results = [];

    for (const itemId of itemIds) {
        // Check if daily quota allows continuing
        const status = rateLimiter.getStatus();
        if (status.daily_paused) {
            console.warn(`[ZohoSync] Stopping item detail fetch: daily quota near limit (${status.daily_used}/${status.daily_limit})`);
            break;
        }

        await rateLimiter.acquire('getItemDetails');
        try {
            const response = await apiGet(`/items/${itemId}`, { organization_id: orgId });
            if (response.item) {
                results.push(response.item);
            }
        } catch (e) {
            // If rate limit error, stop fetching more
            if (e.message.includes('rate limit') || e.message.includes('error 45') || e.message.includes('error 57')) {
                console.error(`[ZohoSync] Rate limit hit during item detail fetch. Stopping batch.`);
                break;
            }
            console.error(`[ZohoSync] Item detail ${itemId} failed:`, e.message);
        }

        // Add small delay between individual item fetches to smooth out rate
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return results;
}

/**
 * Sync items from Zoho to local zoho_items_map
 */
async function syncItems(triggeredBy = null) {
    if (!pool) throw new Error('Database pool not initialized');

    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('items', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        let page = 1;
        let hasMore = true;
        let totalSynced = 0;

        // Mark all items as inactive before sync; active ones will be restored
        await pool.query(`UPDATE zoho_items_map SET zoho_status = 'inactive'`);

        while (hasMore) {
            await rateLimiter.acquire('syncItems');
            const response = await getItems({ page, per_page: 200, status: 'active' });

            console.log(`[ZohoSync] Items page ${page}: ${response.items?.length || 0} items returned`);
            if (page === 1 && response.items && response.items.length > 0) {
                console.log('[ZohoSync] Sample item keys:', Object.keys(response.items[0]));
            }

            if (!response.items || response.items.length === 0) {
                hasMore = false;
                break;
            }

            for (const item of response.items) {
                // Extract custom fields
                const cfProductName = (item.custom_fields || []).find(f => f.label === 'Product Name' || f.api_name === 'cf_product_name');
                const cfDpl = (item.custom_fields || []).find(f => f.label === 'DPL' || f.api_name === 'cf_dpl');

                await pool.query(`
                    INSERT INTO zoho_items_map (
                        zoho_item_id, zoho_item_name, zoho_sku, zoho_rate, zoho_unit, zoho_tax_id,
                        zoho_description, zoho_purchase_rate, zoho_label_rate,
                        zoho_tax_name, zoho_tax_percentage, zoho_hsn_or_sac,
                        zoho_brand, zoho_manufacturer, zoho_reorder_level, zoho_stock_on_hand,
                        zoho_category_name, zoho_upc, zoho_ean, zoho_isbn, zoho_part_number,
                        zoho_cf_product_name, zoho_cf_dpl,
                        zoho_status, last_synced_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW())
                    ON DUPLICATE KEY UPDATE
                        zoho_item_name = VALUES(zoho_item_name),
                        zoho_sku = VALUES(zoho_sku),
                        zoho_rate = VALUES(zoho_rate),
                        zoho_unit = VALUES(zoho_unit),
                        zoho_tax_id = VALUES(zoho_tax_id),
                        zoho_description = VALUES(zoho_description),
                        zoho_purchase_rate = VALUES(zoho_purchase_rate),
                        zoho_label_rate = VALUES(zoho_label_rate),
                        zoho_tax_name = VALUES(zoho_tax_name),
                        zoho_tax_percentage = VALUES(zoho_tax_percentage),
                        zoho_hsn_or_sac = VALUES(zoho_hsn_or_sac),
                        zoho_brand = VALUES(zoho_brand),
                        zoho_manufacturer = VALUES(zoho_manufacturer),
                        zoho_reorder_level = VALUES(zoho_reorder_level),
                        zoho_stock_on_hand = VALUES(zoho_stock_on_hand),
                        zoho_category_name = VALUES(zoho_category_name),
                        zoho_upc = VALUES(zoho_upc),
                        zoho_ean = VALUES(zoho_ean),
                        zoho_isbn = VALUES(zoho_isbn),
                        zoho_part_number = VALUES(zoho_part_number),
                        zoho_cf_product_name = VALUES(zoho_cf_product_name),
                        zoho_cf_dpl = VALUES(zoho_cf_dpl),
                        zoho_status = 'active',
                        last_synced_at = NOW()
                `, [
                    item.item_id, item.name, item.sku || null,
                    item.rate || 0, item.unit || null, item.tax_id || null,
                    item.description || null, item.purchase_rate || null, item.label_rate || null,
                    item.tax_name || null, item.tax_percentage || null, item.hsn_or_sac || null,
                    item.brand || null, item.manufacturer || null,
                    item.reorder_level || null, item.stock_on_hand || null,
                    item.category_name || null, item.upc || null, item.ean || null,
                    item.isbn || null, item.part_number || null,
                    cfProductName?.value || null, cfDpl?.value || null
                ]);
                totalSynced++;
            }

            hasMore = response.page_context?.has_more_page || false;
            page++;
        }

        await pool.query(
            `UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_total = ?, completed_at = NOW() WHERE id = ?`,
            [totalSynced, totalSynced, syncId]
        );

        return { success: true, synced: totalSynced };
    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

/**
 * Sync per-location stock levels from Zoho
 */
async function syncLocationStock(triggeredBy = null) {
    if (!pool) throw new Error('Database pool not initialized');

    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('stock', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        // Get active items from local cache
        const [items] = await pool.query(`SELECT zoho_item_id, zoho_item_name, zoho_sku FROM zoho_items_map WHERE zoho_status = 'active' OR zoho_status IS NULL`);
        if (items.length === 0) {
            throw new Error('No items in cache. Run item sync first.');
        }

        let totalSynced = 0;
        const batchSize = 25;

        // Fetch item details in batches — each item detail includes a 'locations' array
        // with per-location stock (location_stock_on_hand, location_available_stock, etc.)
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const itemIds = batch.map(it => it.zoho_item_id);

            const itemDetails = await getItemDetails(itemIds);

            for (const item of itemDetails) {
                const locations = item.locations || [];

                for (const loc of locations) {
                    if (loc.status !== 'active') continue;

                    const stockOnHand = parseFloat(loc.location_stock_on_hand || 0);
                    const availableStock = parseFloat(loc.location_available_stock || 0);
                    const committedStock = parseFloat(loc.location_committed_stock || loc.location_actual_committed_stock || 0);
                    const availableForSale = parseFloat(loc.location_available_for_sale_stock || 0);

                    // Get previous stock for history
                    const [prevStock] = await pool.query(
                        `SELECT stock_on_hand FROM zoho_location_stock WHERE zoho_item_id = ? AND zoho_location_id = ? LIMIT 1`,
                        [item.item_id, loc.location_id]
                    );
                    const previousQty = prevStock.length > 0 ? parseFloat(prevStock[0].stock_on_hand) : 0;

                    await pool.query(`
                        INSERT INTO zoho_location_stock (zoho_item_id, zoho_location_id, item_name, sku, stock_on_hand, available_stock, committed_stock, available_for_sale, last_synced_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                        ON DUPLICATE KEY UPDATE
                            item_name = VALUES(item_name),
                            sku = VALUES(sku),
                            stock_on_hand = VALUES(stock_on_hand),
                            available_stock = VALUES(available_stock),
                            committed_stock = VALUES(committed_stock),
                            available_for_sale = VALUES(available_for_sale),
                            last_synced_at = NOW()
                    `, [
                        item.item_id, loc.location_id,
                        item.name, item.sku || null,
                        stockOnHand,
                        availableStock,
                        committedStock,
                        availableForSale
                    ]);

                    // Record stock change if different
                    if (Math.abs(previousQty - stockOnHand) > 0.001) {
                        await pool.query(`
                            INSERT INTO zoho_stock_history (zoho_item_id, zoho_location_id, item_name, previous_stock, new_stock, change_amount, source)
                            VALUES (?, ?, ?, ?, ?, ?, 'sync')
                        `, [item.item_id, loc.location_id, item.name, previousQty, stockOnHand, stockOnHand - previousQty]);
                    }

                    totalSynced++;
                }
            }

            console.log(`[ZohoSync] Stock sync progress: ${Math.min(i + batchSize, items.length)}/${items.length} items (${totalSynced} location-stock records)`);
        }

        await pool.query(
            `UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_total = ?, completed_at = NOW() WHERE id = ?`,
            [totalSynced, totalSynced, syncId]
        );

        return { success: true, synced: totalSynced };
    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

/**
 * Get location stock dashboard data with filters
 */
async function getLocationStockDashboard(filters = {}) {
    if (!pool) throw new Error('Database pool not initialized');

    let where = 'WHERE 1=1';
    const params = [];

    if (filters.location_id) {
        where += ' AND ls.zoho_location_id = ?';
        params.push(filters.location_id);
    }
    if (filters.search) {
        where += ' AND (ls.item_name LIKE ? OR ls.sku LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.low_stock === 'true') {
        where += ' AND ls.stock_on_hand <= COALESCE(rc.reorder_level, 0) AND rc.id IS NOT NULL';
    }

    const page = Math.max(1, parseInt(filters.page) || 1);
    const limit = Math.min(100, parseInt(filters.limit) || 50);
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query(`
        SELECT COUNT(*) as total FROM zoho_location_stock ls
        LEFT JOIN zoho_reorder_config rc ON ls.zoho_item_id = rc.zoho_item_id AND ls.zoho_location_id = rc.zoho_location_id
        ${where}
    `, params);

    const [rows] = await pool.query(`
        SELECT ls.*, lm.zoho_location_name, rc.reorder_level
        FROM zoho_location_stock ls
        LEFT JOIN zoho_locations_map lm ON ls.zoho_location_id = lm.zoho_location_id
        LEFT JOIN zoho_reorder_config rc ON ls.zoho_item_id = rc.zoho_item_id AND ls.zoho_location_id = rc.zoho_location_id
        ${where}
        ORDER BY ls.item_name ASC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return { data: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
}

// ========================================
// FEATURE 1: BULK ITEM UPDATES
// ========================================

/**
 * Update a single item in Zoho
 */
async function updateItem(itemId, data) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    await rateLimiter.acquire('bulkUpdateItem');
    return await apiPut(`/items/${itemId}?organization_id=${orgId}`, data);
}

/**
 * Create a bulk update job
 */
async function createBulkUpdateJob(filter, updateFields, userId) {
    if (!pool) throw new Error('Database pool not initialized');

    // Create job
    const [jobResult] = await pool.query(`
        INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, created_by)
        VALUES ('item_update', ?, ?, ?)
    `, [JSON.stringify(filter), JSON.stringify(updateFields), userId]);
    const jobId = jobResult.insertId;

    // Get items matching filter
    let where = 'WHERE 1=1';
    const params = [];

    if (filter.item_ids && filter.item_ids.length > 0) {
        where += ` AND zoho_item_id IN (${filter.item_ids.map(() => '?').join(',')})`;
        params.push(...filter.item_ids);
    }
    if (filter.search) {
        where += ' AND (zoho_item_name LIKE ? OR zoho_sku LIKE ?)';
        params.push(`%${filter.search}%`, `%${filter.search}%`);
    }

    const [items] = await pool.query(`SELECT zoho_item_id, zoho_item_name FROM zoho_items_map ${where}`, params);

    // Populate job items
    for (const item of items) {
        await pool.query(`
            INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
            VALUES (?, ?, ?, ?)
        `, [jobId, item.zoho_item_id, item.zoho_item_name, JSON.stringify(updateFields)]);
    }

    // Update total
    await pool.query(`UPDATE zoho_bulk_jobs SET total_items = ? WHERE id = ?`, [items.length, jobId]);

    return { job_id: jobId, total_items: items.length };
}

/**
 * Process a bulk job (called by scheduler)
 */
async function processBulkJob(jobId) {
    if (!pool) throw new Error('Database pool not initialized');

    const [jobs] = await pool.query(`SELECT * FROM zoho_bulk_jobs WHERE id = ? AND status IN ('pending','processing') LIMIT 1`, [jobId]);
    if (jobs.length === 0) return { message: 'Job not found or already completed' };

    const job = jobs[0];

    // Mark as processing
    await pool.query(`UPDATE zoho_bulk_jobs SET status = 'processing', started_at = COALESCE(started_at, NOW()) WHERE id = ?`, [jobId]);

    // Get config
    const [configRows] = await pool.query(`SELECT config_value FROM zoho_config WHERE config_key = 'bulk_job_delay_ms'`);
    const delayMs = Math.max(1000, parseInt(configRows[0]?.config_value || '1200'));

    // Reduced batch size: 20 items per cycle (was 50) to avoid quota spikes
    const [items] = await pool.query(
        `SELECT * FROM zoho_bulk_job_items WHERE job_id = ? AND status = 'pending' ORDER BY id LIMIT 20`,
        [jobId]
    );

    if (items.length === 0) {
        // Job complete
        await pool.query(`UPDATE zoho_bulk_jobs SET status = 'completed', completed_at = NOW() WHERE id = ?`, [jobId]);
        return { message: 'Job completed', processed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const item of items) {
        // Check daily quota before each item
        const quotaStatus = rateLimiter.getStatus();
        if (quotaStatus.daily_paused) {
            console.warn(`[BulkJob] Pausing job #${jobId}: daily quota near limit (${quotaStatus.daily_used}/${quotaStatus.daily_limit})`);
            break;
        }

        try {
            await pool.query(`UPDATE zoho_bulk_job_items SET status = 'processing' WHERE id = ?`, [item.id]);

            const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
            const result = await updateItem(item.zoho_item_id, payload);

            await pool.query(`
                UPDATE zoho_bulk_job_items SET status = 'completed', response_data = ?, processed_at = NOW(), attempts = attempts + 1 WHERE id = ?
            `, [JSON.stringify(result), item.id]);

            processed++;
        } catch (e) {
            failed++;
            const newAttempts = (item.attempts || 0) + 1;
            const newStatus = newAttempts >= 3 ? 'failed' : 'pending';

            await pool.query(`
                UPDATE zoho_bulk_job_items SET status = ?, error_message = ?, attempts = ? WHERE id = ?
            `, [newStatus, e.message, newAttempts, item.id]);

            // If rate limit error, stop processing this batch
            if (e.message.includes('rate limit') || e.message.includes('error 45') || e.message.includes('error 57') || e.message.includes('quota')) {
                console.error(`[BulkJob] Rate limit hit, pausing job #${jobId}`);
                break;
            }
        }

        // Delay between calls
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // Update counters
    await pool.query(`
        UPDATE zoho_bulk_jobs SET
            processed_items = (SELECT COUNT(*) FROM zoho_bulk_job_items WHERE job_id = ? AND status = 'completed'),
            failed_items = (SELECT COUNT(*) FROM zoho_bulk_job_items WHERE job_id = ? AND status = 'failed')
        WHERE id = ?
    `, [jobId, jobId, jobId]);

    // Check if all done
    const [[remaining]] = await pool.query(
        `SELECT COUNT(*) as cnt FROM zoho_bulk_job_items WHERE job_id = ? AND status = 'pending'`,
        [jobId]
    );
    if (remaining.cnt === 0) {
        await pool.query(`UPDATE zoho_bulk_jobs SET status = 'completed', completed_at = NOW() WHERE id = ?`, [jobId]);
    }

    return { processed, failed };
}

/**
 * Cancel a bulk job
 */
async function cancelBulkJob(jobId) {
    if (!pool) throw new Error('Database pool not initialized');

    await pool.query(`UPDATE zoho_bulk_job_items SET status = 'skipped' WHERE job_id = ? AND status = 'pending'`, [jobId]);
    await pool.query(`
        UPDATE zoho_bulk_jobs SET status = 'cancelled', completed_at = NOW(),
            skipped_items = (SELECT COUNT(*) FROM zoho_bulk_job_items WHERE job_id = ? AND status = 'skipped')
        WHERE id = ?
    `, [jobId, jobId]);

    return { success: true };
}

/**
 * Retry failed items in a bulk job
 */
async function retryBulkJob(jobId) {
    if (!pool) throw new Error('Database pool not initialized');

    const [result] = await pool.query(
        `UPDATE zoho_bulk_job_items SET status = 'pending', error_message = NULL WHERE job_id = ? AND status = 'failed'`,
        [jobId]
    );
    await pool.query(`UPDATE zoho_bulk_jobs SET status = 'pending' WHERE id = ?`, [jobId]);

    return { retried: result.affectedRows };
}

// ========================================
// FEATURE 3: DAILY TRANSACTION REPORTS
// ========================================

/**
 * Get invoices by location and date range
 */
async function getInvoicesByLocation(locationId, dateStart, dateEnd) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const params = { organization_id: orgId, date_start: dateStart, date_end: dateEnd, per_page: 200 };
    if (locationId) params.location_id = locationId;
    await rateLimiter.acquire('dailyReport.invoices');
    return await apiGet('/invoices', params);
}

/**
 * Get bills by location and date range
 */
async function getBillsByLocation(locationId, dateStart, dateEnd) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const params = { organization_id: orgId, date_start: dateStart, date_end: dateEnd, per_page: 200 };
    if (locationId) params.location_id = locationId;
    await rateLimiter.acquire('dailyReport.bills');
    return await apiGet('/bills', params);
}

/**
 * Get sales orders by location and date range
 */
async function getSalesOrdersByLocation(locationId, dateStart, dateEnd) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const params = { organization_id: orgId, date_start: dateStart, date_end: dateEnd, per_page: 200 };
    if (locationId) params.location_id = locationId;
    await rateLimiter.acquire('dailyReport.salesOrders');
    return await apiGet('/salesorders', params);
}

/**
 * Get purchase orders by location and date range
 */
async function getPurchaseOrdersByLocation(locationId, dateStart, dateEnd) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const params = { organization_id: orgId, date_start: dateStart, date_end: dateEnd, per_page: 200 };
    if (locationId) params.location_id = locationId;
    await rateLimiter.acquire('dailyReport.purchaseOrders');
    return await apiGet('/purchaseorders', params);
}

/**
 * Generate daily transaction report for a date range
 */
async function generateDailyTransactionReport(dateStart, dateEnd, triggeredBy = null) {
    if (!pool) throw new Error('Database pool not initialized');

    const [logResult] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by) VALUES ('transactions', 'zoho_to_local', 'started', ?)`,
        [triggeredBy]
    );
    const syncId = logResult.insertId;

    try {
        // Get locations
        const [locations] = await pool.query(`SELECT zoho_location_id, zoho_location_name FROM zoho_locations_map WHERE is_active = 1`);

        // Add null for "all/unassigned" location
        const locationList = [{ zoho_location_id: null, zoho_location_name: 'All Locations' }, ...locations];
        let totalSynced = 0;

        for (const loc of locationList) {
            const locId = loc.zoho_location_id;
            const locName = loc.zoho_location_name;

            // Fetch all transaction types
            const [invoicesRes, billsRes, soRes, poRes] = await Promise.all([
                getInvoicesByLocation(locId, dateStart, dateEnd).catch(() => ({ invoices: [] })),
                getBillsByLocation(locId, dateStart, dateEnd).catch(() => ({ bills: [] })),
                getSalesOrdersByLocation(locId, dateStart, dateEnd).catch(() => ({ salesorders: [] })),
                getPurchaseOrdersByLocation(locId, dateStart, dateEnd).catch(() => ({ purchaseorders: [] }))
            ]);

            const invoices = invoicesRes.invoices || [];
            const bills = billsRes.bills || [];
            const salesOrders = soRes.salesorders || [];
            const purchaseOrders = poRes.purchaseorders || [];

            // Group by date
            const dates = {};
            const start = new Date(dateStart);
            const end = new Date(dateEnd);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                dates[d.toISOString().split('T')[0]] = {
                    invoices: [], bills: [], salesOrders: [], purchaseOrders: []
                };
            }

            invoices.forEach(inv => { if (dates[inv.date]) dates[inv.date].invoices.push(inv); });
            bills.forEach(bill => { if (dates[bill.date]) dates[bill.date].bills.push(bill); });
            salesOrders.forEach(so => { if (dates[so.date]) dates[so.date].salesOrders.push(so); });
            purchaseOrders.forEach(po => { if (dates[po.date]) dates[po.date].purchaseOrders.push(po); });

            for (const [dateStr, data] of Object.entries(dates)) {
                const invAmount = data.invoices.reduce((sum, i) => sum + parseFloat(i.total || 0), 0);
                const billAmount = data.bills.reduce((sum, b) => sum + parseFloat(b.total || 0), 0);
                const soAmount = data.salesOrders.reduce((sum, s) => sum + parseFloat(s.total || 0), 0);
                const poAmount = data.purchaseOrders.reduce((sum, p) => sum + parseFloat(p.total || 0), 0);

                const [dtResult] = await pool.query(`
                    INSERT INTO zoho_daily_transactions (
                        transaction_date, zoho_location_id, location_name,
                        invoice_count, invoice_amount, bill_count, bill_amount,
                        sales_order_count, sales_order_amount, purchase_order_count, purchase_order_amount
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        location_name = VALUES(location_name),
                        invoice_count = VALUES(invoice_count), invoice_amount = VALUES(invoice_amount),
                        bill_count = VALUES(bill_count), bill_amount = VALUES(bill_amount),
                        sales_order_count = VALUES(sales_order_count), sales_order_amount = VALUES(sales_order_amount),
                        purchase_order_count = VALUES(purchase_order_count), purchase_order_amount = VALUES(purchase_order_amount),
                        updated_at = CURRENT_TIMESTAMP
                `, [
                    dateStr, locId, locName,
                    data.invoices.length, invAmount,
                    data.bills.length, billAmount,
                    data.salesOrders.length, soAmount,
                    data.purchaseOrders.length, poAmount
                ]);

                const dailyId = dtResult.insertId || dtResult.insertId;
                if (dailyId) {
                    // Store details for drilldown
                    // Delete old details first
                    await pool.query(`DELETE FROM zoho_daily_transaction_details WHERE daily_transaction_id = ?`, [dailyId]);

                    const details = [
                        ...data.invoices.map(i => ['invoice', i.invoice_id, i.invoice_number, i.date, i.customer_name, i.total, i.status, locId]),
                        ...data.bills.map(b => ['bill', b.bill_id, b.bill_number, b.date, b.vendor_name, b.total, b.status, locId]),
                        ...data.salesOrders.map(s => ['sales_order', s.salesorder_id, s.salesorder_number, s.date, s.customer_name, s.total, s.status, locId]),
                        ...data.purchaseOrders.map(p => ['purchase_order', p.purchaseorder_id, p.purchaseorder_number, p.date, p.vendor_name, p.total, p.status, locId])
                    ];

                    for (const d of details) {
                        await pool.query(`
                            INSERT INTO zoho_daily_transaction_details
                            (daily_transaction_id, transaction_type, zoho_transaction_id, transaction_number, transaction_date, contact_name, amount, status, zoho_location_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [dailyId, ...d]);
                    }
                }

                totalSynced++;
            }
        }

        await pool.query(
            `UPDATE zoho_sync_log SET status = 'completed', records_synced = ?, records_total = ?, completed_at = NOW() WHERE id = ?`,
            [totalSynced, totalSynced, syncId]
        );

        return { success: true, synced: totalSynced };
    } catch (error) {
        await pool.query(
            `UPDATE zoho_sync_log SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message, syncId]
        );
        throw error;
    }
}

// ========================================
// FEATURE 4: REORDER ALERTS
// ========================================

/**
 * Check reorder alerts based on current stock vs thresholds
 */
async function checkReorderAlerts() {
    if (!pool) throw new Error('Database pool not initialized');

    const [lowStockItems] = await pool.query(`
        SELECT rc.*, ls.stock_on_hand, ls.available_stock,
               ls.item_name, lm.zoho_location_name as location_name
        FROM zoho_reorder_config rc
        JOIN zoho_location_stock ls ON rc.zoho_item_id = ls.zoho_item_id AND rc.zoho_location_id = ls.zoho_location_id
        LEFT JOIN zoho_locations_map lm ON rc.zoho_location_id = lm.zoho_location_id
        WHERE rc.is_active = 1 AND ls.stock_on_hand < rc.reorder_level
    `);

    let created = 0;
    let skipped = 0;

    for (const item of lowStockItems) {
        // Calculate severity
        let severity = 'low';
        if (item.stock_on_hand <= 0) {
            severity = 'critical';
        } else if (item.stock_on_hand < item.reorder_level * 0.25) {
            severity = 'high';
        } else if (item.stock_on_hand < item.reorder_level * 0.50) {
            severity = 'medium';
        }

        // Check if active alert already exists
        const [existing] = await pool.query(`
            SELECT id FROM zoho_reorder_alerts
            WHERE zoho_item_id = ? AND zoho_location_id = ? AND status IN ('active','acknowledged')
            LIMIT 1
        `, [item.zoho_item_id, item.zoho_location_id]);

        if (existing.length > 0) {
            // Update severity if changed
            await pool.query(`UPDATE zoho_reorder_alerts SET severity = ?, current_stock = ? WHERE id = ?`,
                [severity, item.stock_on_hand, existing[0].id]);
            skipped++;
            continue;
        }

        await pool.query(`
            INSERT INTO zoho_reorder_alerts (
                zoho_item_id, zoho_location_id, reorder_config_id,
                item_name, location_name, current_stock, reorder_level,
                reorder_quantity, severity
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            item.zoho_item_id, item.zoho_location_id, item.id,
            item.item_name, item.location_name,
            item.stock_on_hand, item.reorder_level,
            item.reorder_quantity, severity
        ]);
        created++;
    }

    // Auto-resolve alerts where stock is now above reorder level
    const [autoResolved] = await pool.query(`
        UPDATE zoho_reorder_alerts ra
        JOIN zoho_location_stock ls ON ra.zoho_item_id = ls.zoho_item_id AND ra.zoho_location_id = ls.zoho_location_id
        JOIN zoho_reorder_config rc ON ra.zoho_item_id = rc.zoho_item_id AND ra.zoho_location_id = rc.zoho_location_id
        SET ra.status = 'auto_resolved', ra.resolved_at = NOW(), ra.current_stock = ls.stock_on_hand
        WHERE ra.status IN ('active','acknowledged') AND ls.stock_on_hand >= rc.reorder_level
    `);

    return { created, skipped, auto_resolved: autoResolved.affectedRows || 0 };
}

/**
 * Bulk set reorder levels
 */
async function bulkSetReorderLevels(items) {
    if (!pool) throw new Error('Database pool not initialized');

    let updated = 0;
    for (const item of items) {
        await pool.query(`
            INSERT INTO zoho_reorder_config (zoho_item_id, zoho_location_id, item_name, location_name, reorder_level, reorder_quantity, max_stock, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
                reorder_level = VALUES(reorder_level),
                reorder_quantity = VALUES(reorder_quantity),
                max_stock = VALUES(max_stock),
                item_name = COALESCE(VALUES(item_name), item_name),
                location_name = COALESCE(VALUES(location_name), location_name),
                is_active = 1
        `, [
            item.zoho_item_id, item.zoho_location_id,
            item.item_name || null, item.location_name || null,
            item.reorder_level || 0, item.reorder_quantity || 0, item.max_stock || 0
        ]);
        updated++;
    }
    return { updated };
}

/**
 * Get reorder dashboard data
 */
async function getReorderDashboard(filters = {}) {
    if (!pool) throw new Error('Database pool not initialized');

    let where = 'WHERE 1=1';
    const params = [];

    if (filters.location_id) {
        where += ' AND ra.zoho_location_id = ?';
        params.push(filters.location_id);
    }
    if (filters.severity) {
        where += ' AND ra.severity = ?';
        params.push(filters.severity);
    }
    if (filters.status) {
        where += ' AND ra.status = ?';
        params.push(filters.status);
    } else {
        where += ' AND ra.status IN ("active","acknowledged")';
    }

    const page = Math.max(1, parseInt(filters.page) || 1);
    const limit = Math.min(100, parseInt(filters.limit) || 50);
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_reorder_alerts ra ${where}`, params);

    const [alerts] = await pool.query(`
        SELECT ra.*, u1.full_name as acknowledged_by_name, u2.full_name as resolved_by_name
        FROM zoho_reorder_alerts ra
        LEFT JOIN users u1 ON ra.acknowledged_by = u1.id
        LEFT JOIN users u2 ON ra.resolved_by = u2.id
        ${where}
        ORDER BY FIELD(ra.severity, 'critical','high','medium','low'), ra.created_at DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return { data: alerts, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
}

/**
 * Acknowledge an alert
 */
async function acknowledgeAlert(alertId, userId) {
    if (!pool) throw new Error('Database pool not initialized');
    await pool.query(
        `UPDATE zoho_reorder_alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ? AND status = 'active'`,
        [userId, alertId]
    );
    return { success: true };
}

/**
 * Resolve an alert
 */
async function resolveAlert(alertId, userId, notes) {
    if (!pool) throw new Error('Database pool not initialized');
    await pool.query(
        `UPDATE zoho_reorder_alerts SET status = 'resolved', resolved_by = ?, resolved_at = NOW(), resolution_notes = ? WHERE id = ? AND status IN ('active','acknowledged')`,
        [userId, notes || null, alertId]
    );
    return { success: true };
}

/**
 * Create an inventory adjustment in Zoho Books
 * Zoho API: POST /inventoryadjustments
 */
async function createInventoryAdjustment(adjustmentData) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    await rateLimiter.acquire('inventoryAdjustment');
    return await apiPost(`/inventoryadjustments?organization_id=${orgId}`, adjustmentData);
}

/**
 * Get inventory adjustments from Zoho Books
 * Zoho API: GET /inventoryadjustments
 */
async function getInventoryAdjustments(params = {}) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/inventoryadjustments', { organization_id: orgId, ...params });
}

module.exports = {
    setPool,
    // Invoices
    getInvoices,
    getInvoice,
    createInvoice,
    getOverdueInvoices,
    getUnpaidInvoices,
    // Payments
    getPayments,
    getPayment,
    createPayment,
    // Contacts
    getContacts,
    getContact,
    createContact,
    getCustomerBalance,
    // Items
    getItems,
    getItem,
    updateItem,
    // Reports
    getProfitAndLoss,
    getBalanceSheet,
    getSalesByCustomer,
    getSalesByItem,
    getReceivablesSummary,
    getAgingSummary,
    // Sync
    syncInvoices,
    syncCustomers,
    syncPayments,
    syncItems,
    syncLocations,
    syncLocationStock,
    fullSync,
    // Dashboard
    getDashboardStats,
    getLocationStockDashboard,
    // Locations
    getLocations,
    getItemDetails,
    // Bulk Updates
    createBulkUpdateJob,
    processBulkJob,
    cancelBulkJob,
    retryBulkJob,
    // Daily Transactions
    getInvoicesByLocation,
    getBillsByLocation,
    getSalesOrdersByLocation,
    getPurchaseOrdersByLocation,
    generateDailyTransactionReport,
    // Reorder Alerts
    checkReorderAlerts,
    bulkSetReorderLevels,
    getReorderDashboard,
    acknowledgeAlert,
    resolveAlert,
    // Inventory Adjustments
    createInventoryAdjustment,
    getInventoryAdjustments
};
