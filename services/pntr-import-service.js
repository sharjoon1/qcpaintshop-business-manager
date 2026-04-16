function normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return null;
    let result = digits;
    if (digits.length === 12 && digits.startsWith('91')) result = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) result = digits.slice(1);
    else if (digits.length > 10) return null;
    return result.length === 10 ? result : null;
}

function parseBranchPrefix(name, branches) {
    if (!name) return null;
    // Support both "PNTR CODE Name" and "Name PNTR CODE" patterns
    const m = String(name).match(/PNTR\s+([A-Za-z]{2,5})/i);
    if (!m) return null;
    const code = m[1].toUpperCase();
    const hit = branches.find(b => (b.code || '').toUpperCase() === code);
    return hit ? { id: hit.id, code } : null;
}

function parseSalespersonPhoneSuffix(name) {
    if (!name) return null;
    const m = String(name).match(/(\d{10})\s*$/);
    return m ? m[1] : null;
}

function levenshtein(a, b) {
    a = (a || '').toLowerCase();
    b = (b || '').toLowerCase();
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function matchSalesperson(sp, painters) {
    const phoneSuffix = parseSalespersonPhoneSuffix(sp.name);
    if (phoneSuffix) {
        const hit = painters.find(p => normalizePhone(p.phone) === phoneSuffix);
        if (hit) return { painter_id: hit.id, confidence: 'exact_phone' };
    }
    const nameNoPhone = (sp.name || '').replace(/\s*\d{10}\s*$/, '').trim().toLowerCase();
    const exactName = painters.find(p => (p.full_name || '').trim().toLowerCase() === nameNoPhone);
    if (exactName) return { painter_id: exactName.id, confidence: 'exact_name' };
    let best = null;
    for (const p of painters) {
        const d = levenshtein(nameNoPhone, (p.full_name || '').toLowerCase());
        if (d < 3 && (!best || d < best.dist)) best = { painter_id: p.id, dist: d };
    }
    if (best) return { painter_id: best.painter_id, confidence: 'fuzzy_name' };
    return { painter_id: null, confidence: 'unmatched' };
}

async function getBranches(pool) {
    const [rows] = await pool.query(
        `SELECT id, code, name, zoho_location_id FROM branches WHERE status = 'active'`
    );
    return rows;
}

async function detectBranch(pool, customer, branches, normalizedPhone) {
    const byPrefix = parseBranchPrefix(customer.contact_name, branches);
    if (byPrefix) return { id: byPrefix.id, via: 'name_prefix' };
    const [mapRows] = await pool.query(
        `SELECT branch_id FROM zoho_customers_map WHERE zoho_contact_id = ? LIMIT 1`,
        [customer.contact_id]
    );
    if (mapRows.length && mapRows[0].branch_id) {
        return { id: mapRows[0].branch_id, via: 'zoho_branch_id' };
    }
    const [invRows] = await pool.query(
        `SELECT local_branch_id, COUNT(*) AS c FROM zoho_invoices
         WHERE zoho_customer_id = ? AND invoice_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY)
           AND local_branch_id IS NOT NULL
         GROUP BY local_branch_id ORDER BY c DESC LIMIT 1`,
        [customer.contact_id]
    );
    if (invRows.length) return { id: invRows[0].local_branch_id, via: 'invoice_history' };
    return { id: null, via: null };
}

async function upsertPainterLead(pool, row) {
    const [res] = await pool.query(
        `INSERT INTO painter_leads
            (zoho_customer_id, full_name, phone, email, branch_id, branch_detected_via, status)
         VALUES (?, ?, ?, ?, ?, ?, 'new')`,
        [row.zoho_contact_id, row.full_name, row.phone, row.email || null, row.branch_id, row.branch_detected_via]
    );
    return res.insertId;
}

async function processCustomer({ pool, customer, branches, counters, runId }) {
    const phone = normalizePhone(customer.mobile || customer.phone);
    if (!phone) { counters.errors_count++; return; }

    const [painterRows] = await pool.query(
        `SELECT id FROM painters WHERE phone = ? LIMIT 1`, [phone]
    );
    if (painterRows.length) {
        await pool.query(
            `UPDATE painters SET zoho_customer_id = ? WHERE id = ? AND zoho_customer_id IS NULL`,
            [customer.contact_id, painterRows[0].id]
        );
        counters.linked_existing_painter++;
        return;
    }

    const [leadRows] = await pool.query(
        `SELECT id FROM painter_leads WHERE phone = ? LIMIT 1`, [phone]
    );
    if (leadRows.length) {
        await pool.query(
            `INSERT INTO painter_lead_duplicate_queue
                (original_painter_lead_id, duplicate_zoho_customer_id, duplicate_zoho_name, duplicate_phone)
             VALUES (?, ?, ?, ?)`,
            [leadRows[0].id, customer.contact_id, customer.contact_name, phone]
        );
        counters.duplicates_queued++;
        return;
    }

    const branch = await detectBranch(pool, customer, branches, phone);
    if (!branch.id) counters.branch_unresolved_count++;
    await upsertPainterLead(pool, {
        zoho_contact_id: customer.contact_id,
        full_name: customer.contact_name,
        phone,
        email: customer.email,
        branch_id: branch.id,
        branch_detected_via: branch.via
    });
    counters.imported_count++;
}

async function syncSalespersons({ pool, zohoApi }) {
    const resp = await zohoApi.listSalespersons();
    const salespersons = resp.salespersons || [];
    if (!salespersons.length) return { synced: 0 };
    const [painters] = await pool.query(`SELECT id, full_name, phone FROM painters`);
    let synced = 0;
    for (const sp of salespersons) {
        const match = matchSalesperson({ name: sp.salesperson_name }, painters);
        const phoneSuffix = parseSalespersonPhoneSuffix(sp.salesperson_name);
        await pool.query(
            `INSERT INTO painter_zoho_salesperson_map
                (zoho_salesperson_id, zoho_salesperson_name, zoho_salesperson_phone, painter_id, match_confidence)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                painter_id = VALUES(painter_id),
                match_confidence = VALUES(match_confidence),
                last_synced_at = NOW()`,
            [sp.salesperson_id, sp.salesperson_name, phoneSuffix || null, match.painter_id, match.confidence]
        );
        if (match.painter_id) {
            await pool.query(
                `UPDATE painters SET zoho_salesperson_id = ? WHERE id = ? AND zoho_salesperson_id IS NULL`,
                [sp.salesperson_id, match.painter_id]
            );
        }
        synced++;
    }
    return { synced };
}

async function runBulkImport({ pool, zohoApi, triggeredBy = null, runType = 'initial_bulk', sinceIso = null }) {
    const [runIns] = await pool.query(
        `INSERT INTO painter_pntr_import_runs (run_type, triggered_by, status) VALUES (?, ?, 'running')`,
        [runType, triggeredBy]
    );
    const runId = runIns.insertId;
    const counters = {
        total_zoho_pntr_customers: 0,
        imported_count: 0,
        linked_existing_painter: 0,
        duplicates_queued: 0,
        branch_unresolved_count: 0,
        errors_count: 0
    };
    try {
        const branches = await getBranches(pool);
        let page = 1, hasMore = true;
        while (hasMore) {
            const params = {
                page, per_page: 200
            };
            if (sinceIso) params.last_modified_time = sinceIso;
            const resp = await zohoApi.getContacts(params);
            const batch = (resp.contacts || []).filter(c => /PNTR/i.test(c.contact_name || ''));
            counters.total_zoho_pntr_customers += batch.length;
            for (const cust of batch) {
                try { await processCustomer({ pool, customer: cust, branches, counters, runId }); }
                catch (e) { console.error('[pntr-import] customer failed', cust.contact_id, e.message); counters.errors_count++; }
            }
            hasMore = resp.page_context?.has_more_page || false;
            page++;
        }
        await syncSalespersons({ pool, zohoApi });
        await pool.query(
            `UPDATE painter_pntr_import_runs SET
                status='completed', completed_at=NOW(),
                total_zoho_pntr_customers=?, imported_count=?, linked_existing_painter=?,
                duplicates_queued=?, branch_unresolved_count=?, errors_count=?
             WHERE id = ?`,
            [counters.total_zoho_pntr_customers, counters.imported_count, counters.linked_existing_painter,
             counters.duplicates_queued, counters.branch_unresolved_count, counters.errors_count, runId]
        );
        return { run_id: runId, ...counters };
    } catch (err) {
        await pool.query(
            `UPDATE painter_pntr_import_runs SET status='failed', completed_at=NOW(), notes=? WHERE id=?`,
            [err.message.slice(0, 500), runId]
        );
        throw err;
    }
}

async function runIncrementalImport({ pool, zohoApi, triggeredBy = null }) {
    const [last] = await pool.query(
        `SELECT completed_at FROM painter_pntr_import_runs WHERE status='completed' ORDER BY id DESC LIMIT 1`
    );
    const sinceIso = last.length ? new Date(last[0].completed_at).toISOString() : null;
    return runBulkImport({ pool, zohoApi, triggeredBy, runType: 'incremental_daily', sinceIso });
}

module.exports = {
    normalizePhone,
    parseBranchPrefix,
    parseSalespersonPhoneSuffix,
    levenshtein,
    matchSalesperson,
    getBranches,
    detectBranch,
    upsertPainterLead,
    processCustomer,
    syncSalespersons,
    runBulkImport,
    runIncrementalImport
};
