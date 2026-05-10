/**
 * Brand DPL Lists service.
 *
 * Wraps `brand_dpl_lists` CRUD. Single row per brand — saves are
 * INSERT ... ON DUPLICATE KEY UPDATE.
 */

let pool = null;
function setPool(p) { pool = p; }

/**
 * Persist a brand's DPL price list. Replaces any existing row for the brand.
 *
 * @param {object} args
 * @param {string} args.brand          Lowercase brand key (e.g. 'birlaopus')
 * @param {string} args.rawText        Original paste text
 * @param {Array<object>} args.parsedRows  Parser output, must be non-empty
 * @param {string|null} args.effectiveDate  ISO date string or null
 * @param {string|null} args.updatedBy
 * @returns {Promise<object>} The saved summary row (no raw_text)
 */
async function save({ brand, rawText, parsedRows, effectiveDate, updatedBy }) {
    if (!pool) throw new Error('brand-dpl-service: pool not set');
    if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
        throw new Error('Cannot save brand DPL with zero parsed rows');
    }

    const parsedJson = JSON.stringify(parsedRows);
    const parsedCount = parsedRows.length;

    await pool.query(
        `INSERT INTO brand_dpl_lists
            (brand, raw_text, parsed_rows, parsed_count, effective_date, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            raw_text       = VALUES(raw_text),
            parsed_rows    = VALUES(parsed_rows),
            parsed_count   = VALUES(parsed_count),
            effective_date = VALUES(effective_date),
            updated_by     = VALUES(updated_by)`,
        [brand, rawText, parsedJson, parsedCount, effectiveDate || null, updatedBy || null]
    );

    const saved = await get(brand);
    if (!saved) {
        throw new Error(`brand-dpl-service: save succeeded but readback for '${brand}' returned null`);
    }
    return saved;
}

/**
 * Read brand DPL summary. By default omits raw_text + parsed_rows for performance.
 *
 * @param {string} brand
 * @param {object} [opts]
 * @param {boolean} [opts.includeRaw=false]  Include raw_text in result
 * @returns {Promise<object|null>}
 */
async function get(brand, opts = {}) {
    if (!pool) throw new Error('brand-dpl-service: pool not set');
    const cols = opts.includeRaw
        ? 'brand, raw_text, parsed_count, effective_date, updated_at, updated_by'
        : 'brand, parsed_count, effective_date, updated_at, updated_by';

    const [rows] = await pool.query(
        `SELECT ${cols} FROM brand_dpl_lists WHERE brand = ?`,
        [brand]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
        brand: r.brand,
        parsed_count: r.parsed_count,
        effective_date: r.effective_date
            ? (typeof r.effective_date === 'string' ? r.effective_date : r.effective_date.toISOString().slice(0, 10))
            : null,
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        updated_by: r.updated_by,
        ...(opts.includeRaw ? { raw_text: r.raw_text } : {}),
    };
}

/**
 * Read parsed_rows JSON only — used by Match Now flow.
 *
 * @param {string} brand
 * @returns {Promise<Array<object>|null>}
 */
async function getForMatch(brand) {
    if (!pool) throw new Error('brand-dpl-service: pool not set');
    const [rows] = await pool.query(
        `SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ?`,
        [brand]
    );
    if (rows.length === 0) return null;
    // MariaDB driver may return JSON column as already-parsed object or as string.
    const raw = rows[0].parsed_rows;
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        throw new Error(`brand-dpl-service: parsed_rows for '${brand}' is not valid JSON: ${e.message}`);
    }
}

module.exports = { setPool, save, get, getForMatch };
