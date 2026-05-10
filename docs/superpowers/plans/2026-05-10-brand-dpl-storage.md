# Brand DPL Storage + Re-match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Birla Opus DPL price list in DB so admins set it once and re-match against Zoho catalog any time without re-pasting; replace the just-built ephemeral paste-text flow.

**Architecture:** New `brand_dpl_lists` DB table (single row per brand). Thin `services/brand-dpl-service.js` wraps DB CRUD. Three new `routes/zoho.js` endpoints (GET summary, POST save+match, POST re-match) replace the deleted `parse-pasted-dpl` endpoint. Frontend `admin-dpl.html` becomes state-machine driven: brand select → GET state → render summary card OR paste UI.

**Tech Stack:** Node.js + Express, MariaDB 10.11 (JSON column), Jest unit tests with mocked pool, vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-05-10-brand-dpl-storage-design.md`.

---

## File Touch List

- **Create:** `migrations/migrate-brand-dpl-lists.js`
- **Create:** `services/brand-dpl-service.js`
- **Create:** `tests/unit/brand-dpl-service.test.js`
- **Modify:** `routes/zoho.js` — delete `/items/parse-pasted-dpl` endpoint, hoist `PASTE_CAT_TO_CANON`, add 3 new endpoints
- **Modify:** `public/admin-dpl.html` — replace `parsePastedText()` flow with state-machine: `loadBrandDplState`, `renderSavedDplCard`, `renderPasteDplUI`, `saveBrandDpl`, `matchSavedDpl`, `startUpdateDpl`

No new npm dependencies. No changes to `services/price-list-parser.js` (parser unchanged from the earlier work).

---

## Task 1: DB migration

**Files:**
- Create: `migrations/migrate-brand-dpl-lists.js`

### - [ ] Step 1: Create the migration file

Create `migrations/migrate-brand-dpl-lists.js`:

```javascript
/**
 * Brand DPL Lists Migration
 *
 * Stores one DPL price list per brand. Single-row-per-brand model:
 * update via INSERT ... ON DUPLICATE KEY UPDATE, no history retained.
 *
 * raw_text:    original paste, kept for audit / future re-parse
 * parsed_rows: parseBirlaOpusTabular() result as JSON array,
 *              read directly by matchWithZohoItems on every Match Now click
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'brand_dpl_lists'");
    if (tables.length) {
        console.log('  brand_dpl_lists already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE brand_dpl_lists (
            brand           VARCHAR(50)   NOT NULL,
            raw_text        MEDIUMTEXT    NOT NULL,
            parsed_rows     JSON          NOT NULL,
            parsed_count    INT           NOT NULL,
            effective_date  DATE          DEFAULT NULL,
            updated_by      VARCHAR(100)  DEFAULT NULL,
            updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (brand)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created brand_dpl_lists table');
}

module.exports = { up };
```

### - [ ] Step 2: Verify the migration file syntax loads

Run from working directory (`D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com`):

```bash
node -e "const m = require('./migrations/migrate-brand-dpl-lists'); console.log(typeof m.up === 'function' ? 'OK' : 'BAD')"
```

Expected: `OK`

### - [ ] Step 3: Commit

```bash
git add migrations/migrate-brand-dpl-lists.js
git commit -m "$(cat <<'EOF'
feat(dpl): migration for brand_dpl_lists table

Single-row-per-brand storage for DPL price lists. raw_text + parsed_rows
JSON + effective_date. Backs the new persistent paste-text → save → re-match
flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Service layer with TDD

**Files:**
- Create: `services/brand-dpl-service.js`
- Create: `tests/unit/brand-dpl-service.test.js`

### - [ ] Step 1: Write failing tests

Create `tests/unit/brand-dpl-service.test.js`:

```javascript
const brandDplService = require('../../services/brand-dpl-service');

function makePool() {
    return { query: jest.fn() };
}

describe('brand-dpl-service — exports', () => {
    test('exports setPool, save, get, getForMatch', () => {
        expect(typeof brandDplService.setPool).toBe('function');
        expect(typeof brandDplService.save).toBe('function');
        expect(typeof brandDplService.get).toBe('function');
        expect(typeof brandDplService.getForMatch).toBe('function');
    });
});

describe('save', () => {
    test('inserts/replaces a brand row with parsed JSON', async () => {
        const pool = makePool();
        pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT
        pool.query.mockResolvedValueOnce([[{
            brand: 'birlaopus', parsed_count: 3, effective_date: '2026-02-25',
            updated_at: new Date('2026-05-10T13:45:22Z'), updated_by: 'sharjoon1'
        }]]); // SELECT after insert
        brandDplService.setPool(pool);

        const parsedRows = [
            { product: 'P1', packSize: '1L', dpl: 100, category: 'INTERIOR EMULSION', brand: 'Birla Opus', baseCode: '' },
            { product: 'P2', packSize: '4L', dpl: 400, category: 'INTERIOR EMULSION', brand: 'Birla Opus', baseCode: '' },
            { product: 'P3', packSize: '10L', dpl: 1000, category: 'INTERIOR EMULSION', brand: 'Birla Opus', baseCode: '' },
        ];
        const out = await brandDplService.save({
            brand: 'birlaopus',
            rawText: 'raw paste here',
            parsedRows,
            effectiveDate: '2026-02-25',
            updatedBy: 'sharjoon1',
        });

        expect(pool.query).toHaveBeenCalledTimes(2);
        const [insertSql, insertArgs] = pool.query.mock.calls[0];
        expect(insertSql).toMatch(/INSERT\s+INTO\s+brand_dpl_lists/i);
        expect(insertSql).toMatch(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i);
        expect(insertArgs[0]).toBe('birlaopus');
        expect(insertArgs[1]).toBe('raw paste here');
        expect(JSON.parse(insertArgs[2])).toEqual(parsedRows);
        expect(insertArgs[3]).toBe(3); // parsed_count
        expect(insertArgs[4]).toBe('2026-02-25');
        expect(insertArgs[5]).toBe('sharjoon1');

        expect(out).toEqual({
            brand: 'birlaopus',
            parsed_count: 3,
            effective_date: '2026-02-25',
            updated_at: expect.any(String),
            updated_by: 'sharjoon1',
        });
    });

    test('rejects when parsedRows is empty', async () => {
        brandDplService.setPool(makePool());
        await expect(brandDplService.save({
            brand: 'birlaopus', rawText: 'x', parsedRows: [], effectiveDate: '2026-02-25', updatedBy: 'sharjoon1'
        })).rejects.toThrow(/no.*rows/i);
    });

    test('defaults effectiveDate to null when not provided', async () => {
        const pool = makePool();
        pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
        pool.query.mockResolvedValueOnce([[{
            brand: 'birlaopus', parsed_count: 1, effective_date: null,
            updated_at: new Date(), updated_by: null,
        }]]);
        brandDplService.setPool(pool);

        await brandDplService.save({
            brand: 'birlaopus',
            rawText: 'x',
            parsedRows: [{ product: 'A', packSize: '1L', dpl: 100, category: '', brand: 'Birla Opus', baseCode: '' }],
            effectiveDate: null,
            updatedBy: null,
        });

        const [, insertArgs] = pool.query.mock.calls[0];
        expect(insertArgs[4]).toBeNull(); // effective_date
        expect(insertArgs[5]).toBeNull(); // updated_by
    });
});

describe('get', () => {
    test('returns summary row without raw_text by default', async () => {
        const pool = makePool();
        pool.query.mockResolvedValueOnce([[{
            brand: 'birlaopus', parsed_count: 1248, effective_date: '2026-02-25',
            updated_at: new Date('2026-05-10T13:45:22Z'), updated_by: 'sharjoon1',
        }]]);
        brandDplService.setPool(pool);

        const out = await brandDplService.get('birlaopus');

        const [sql] = pool.query.mock.calls[0];
        expect(sql).not.toMatch(/raw_text/);
        expect(out).toEqual({
            brand: 'birlaopus',
            parsed_count: 1248,
            effective_date: '2026-02-25',
            updated_at: expect.any(String),
            updated_by: 'sharjoon1',
        });
    });

    test('includes raw_text when includeRaw=true', async () => {
        const pool = makePool();
        pool.query.mockResolvedValueOnce([[{
            brand: 'birlaopus', raw_text: 'paste content',
            parsed_count: 1, effective_date: null,
            updated_at: new Date(), updated_by: null,
        }]]);
        brandDplService.setPool(pool);

        const out = await brandDplService.get('birlaopus', { includeRaw: true });

        const [sql] = pool.query.mock.calls[0];
        expect(sql).toMatch(/raw_text/);
        expect(out.raw_text).toBe('paste content');
    });

    test('returns null when no row exists', async () => {
        const pool = makePool();
        pool.query.mockResolvedValueOnce([[]]);
        brandDplService.setPool(pool);

        const out = await brandDplService.get('birlaopus');
        expect(out).toBeNull();
    });
});

describe('getForMatch', () => {
    test('returns parsed_rows when row exists', async () => {
        const parsedRows = [
            { product: 'P1', packSize: '1L', dpl: 100, category: 'INTERIOR EMULSION', brand: 'Birla Opus', baseCode: '' },
        ];
        const pool = makePool();
        pool.query.mockResolvedValueOnce([[{ parsed_rows: JSON.stringify(parsedRows) }]]);
        brandDplService.setPool(pool);

        const out = await brandDplService.getForMatch('birlaopus');
        expect(out).toEqual(parsedRows);
    });

    test('returns null when no row exists', async () => {
        const pool = makePool();
        pool.query.mockResolvedValueOnce([[]]);
        brandDplService.setPool(pool);

        const out = await brandDplService.getForMatch('birlaopus');
        expect(out).toBeNull();
    });

    test('handles parsed_rows already returned as object (MariaDB JSON column)', async () => {
        const parsedRows = [{ product: 'P', packSize: '1L', dpl: 50, category: '', brand: 'Birla Opus', baseCode: '' }];
        const pool = makePool();
        // Some MariaDB driver versions return JSON column as parsed object, not string.
        pool.query.mockResolvedValueOnce([[{ parsed_rows: parsedRows }]]);
        brandDplService.setPool(pool);

        const out = await brandDplService.getForMatch('birlaopus');
        expect(out).toEqual(parsedRows);
    });
});
```

### - [ ] Step 2: Run tests to verify they fail

Run: `npx jest tests/unit/brand-dpl-service.test.js`

Expected: All tests fail with `Cannot find module '../../services/brand-dpl-service'`.

### - [ ] Step 3: Implement the service

Create `services/brand-dpl-service.js`:

```javascript
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

    return await get(brand);
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
    const [rows] = await pool.query(
        `SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ?`,
        [brand]
    );
    if (rows.length === 0) return null;
    const raw = rows[0].parsed_rows;
    // MariaDB driver may return JSON column as already-parsed object or as string.
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

module.exports = { setPool, save, get, getForMatch };
```

### - [ ] Step 4: Run tests to verify they pass

Run: `npx jest tests/unit/brand-dpl-service.test.js`

Expected: All tests pass.

### - [ ] Step 5: Commit

```bash
git add services/brand-dpl-service.js tests/unit/brand-dpl-service.test.js
git commit -m "$(cat <<'EOF'
feat(dpl): brand-dpl-service for brand_dpl_lists CRUD

Thin service wrapping save (INSERT ON DUPLICATE KEY UPDATE), get summary,
getForMatch (parsed_rows only). All operations injected pool via setPool.
12 unit tests with mocked pool.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend endpoints

**Files:**
- Modify: `routes/zoho.js`

The current `routes/zoho.js` has the `parse-pasted-dpl` endpoint at lines ~5290-5465 (added in commit `bff1518`). It contains the inline `PASTE_CAT_TO_CANON` constant. We will: (1) hoist the constant to the top of the file alongside other module-level constants, (2) delete the `parse-pasted-dpl` endpoint entirely, (3) add three new endpoints: GET, POST save, POST match.

### - [ ] Step 1: Hoist `PASTE_CAT_TO_CANON` to a module-level constant

Find the inline `PASTE_CAT_TO_CANON` definition in `routes/zoho.js` (search for `PASTE_CAT_TO_CANON =` to locate). Cut the entire definition out of the route handler.

Near the top of `routes/zoho.js` (after the existing `require()` calls and pool imports, before the first `router.<method>(...)` call — search for the first line that creates a constant like `const router = express.Router()` to find this region), insert:

```javascript
// Maps DPL paste-mode category strings (e.g. "Interior Luxury") to canonical
// category names that matchWithZohoItems / propose-naming expect.
// Shared by /items/brand-dpl/:brand POST + /items/brand-dpl/:brand/match.
const PASTE_CAT_TO_CANON = {
    'INTERIOR LUXURY':       'INTERIOR EMULSION',
    'INTERIOR PREMIUM':      'INTERIOR EMULSION',
    'INTERIOR ECONOMY':      'INTERIOR EMULSION',
    'EXTERIOR LUXURY':       'EXTERIOR EMULSION',
    'EXTERIOR PREMIUM':      'EXTERIOR EMULSION',
    'EXTERIOR ECONOMY':      'EXTERIOR EMULSION',
    'WATERPROOFING':         'WATERPROOFING',
    'ENAMEL LUXURY':         'ENAMEL',
    'ENAMEL PREMIUM':        'ENAMEL',
    'ENAMEL ECONOMY':        'ENAMEL',
    'WOOD FINISHES LUXURY':  'WOOD FINISH',
    'WOOD FINISHES PREMIUM': 'WOOD FINISH',
    'WOOD FINISHES ECONOMY': 'WOOD FINISH',
    'WOOD FINISHES OTHER':   'WOOD FINISH',
    'PAINTING TOOLS':        '',
    'THINNERS':              '',
    'COLORANTS':             'COLORANT',
    'STAINERS':              'COLORANT',
};
```

### - [ ] Step 2: Wire `brandDplService.setPool(pool)` at the top of the file

In `routes/zoho.js`, find the existing `priceListParser` require (search for `services/price-list-parser`). Just below it, add the require for the new service:

```javascript
const brandDplService = require('../services/brand-dpl-service');
brandDplService.setPool(pool);
```

(`pool` should already be in scope from existing requires. If `setPool(pool)` cannot be called immediately because `pool` isn't yet defined at that line, move the call to right after `pool` is created. Verify by grepping for `const pool` or similar pool initialization.)

### - [ ] Step 3: Delete the old `parse-pasted-dpl` endpoint

Find the JSDoc block starting with `* POST /api/zoho/items/parse-pasted-dpl` and delete from that comment through the closing `});` of `router.post('/items/parse-pasted-dpl', ...)`. Search anchor: `'/items/parse-pasted-dpl'`. Approximately 175 lines.

### - [ ] Step 4: Add the 3 new endpoints

Insert at the same location (just before the existing `propose-naming` route). Search anchor: `router.get('/items/propose-naming'`. Insert directly above:

```javascript
/**
 * GET /api/zoho/items/brand-dpl/:brand
 *
 * Return saved DPL summary for a brand. Drives the Saved Summary Card
 * in admin-dpl.html. ?include=raw also returns raw_text (used when admin
 * clicks "Update DPL" to pre-fill the textarea).
 */
router.get('/items/brand-dpl/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (brand !== 'birlaopus') {
            return res.status(400).json({ success: false, message: `Brand "${brand}" not yet supported` });
        }
        const includeRaw = req.query.include === 'raw';
        const row = await brandDplService.get(brand, { includeRaw });
        if (!row) {
            return res.status(404).json({ success: false, code: 'NO_SAVED_DPL', message: 'No DPL saved for this brand' });
        }
        return res.json({ success: true, data: row });
    } catch (err) {
        console.error('GET brand-dpl error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * POST /api/zoho/items/brand-dpl/:brand
 *
 * Save (or replace) a brand's DPL price list. Optionally runs match in
 * the same call (default true) so the frontend can plug the response
 * into the existing aiData / showAiResults() review UI.
 *
 * Body: { text, effective_date?, match? }
 */
router.post('/items/brand-dpl/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (brand !== 'birlaopus') {
            return res.status(400).json({ success: false, message: `Brand "${brand}" not yet supported for paste-text mode` });
        }
        const body = req.body || {};
        const text = String(body.text || '');
        if (!text.trim()) {
            return res.status(400).json({ success: false, message: 'No text provided' });
        }
        if (text.length > 1_000_000) {
            return res.status(413).json({ success: false, message: 'Pasted text is too large. Maximum 1,000,000 characters.' });
        }

        const effectiveDate = body.effective_date && /^\d{4}-\d{2}-\d{2}$/.test(body.effective_date)
            ? body.effective_date
            : new Date().toISOString().slice(0, 10);
        const runMatch = body.match !== false; // default true

        // 1. Parse.
        const parsedRows = priceListParser.parseBirlaOpusTabular(text);
        if (parsedRows.length === 0) {
            return res.status(400).json({ success: false, message: 'No data rows found in pasted text' });
        }

        // 2. Audit log "before" snapshot.
        const before = await brandDplService.get(brand);

        // 3. Save (replaces existing row).
        const updatedBy = req.user && req.user.username ? req.user.username : null;
        const saved = await brandDplService.save({
            brand, rawText: text, parsedRows, effectiveDate, updatedBy,
        });

        // 4. Audit.
        try {
            const audit = require('../services/audit-log');
            await audit.record(req, {
                action: 'brand_dpl.save',
                entity_type: 'brand_dpl_lists',
                entity_id: brand,
                before: before ? { parsed_count: before.parsed_count, effective_date: before.effective_date, updated_at: before.updated_at } : null,
                after: { parsed_count: saved.parsed_count, effective_date: saved.effective_date, updated_at: saved.updated_at },
            });
        } catch (e) {
            // Audit failure must not break the user-facing request.
            console.warn('audit-log record failed:', e.message);
        }

        // 5. Optional match in same call.
        let match = null;
        if (runMatch) {
            match = await runMatchAgainstStoredDpl(brand, parsedRows);
        }

        return res.json({ success: true, data: { saved, ...(match ? { match } : {}) } });
    } catch (err) {
        console.error('POST brand-dpl error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * POST /api/zoho/items/brand-dpl/:brand/match
 *
 * Re-match against already-saved DPL — no text in body. Powers the
 * "Match Now" button on the Saved Summary Card.
 */
router.post('/items/brand-dpl/:brand/match', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (brand !== 'birlaopus') {
            return res.status(400).json({ success: false, message: `Brand "${brand}" not yet supported` });
        }
        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows) {
            return res.status(404).json({ success: false, code: 'NO_SAVED_DPL', message: 'No DPL saved for this brand' });
        }
        const match = await runMatchAgainstStoredDpl(brand, parsedRows);
        return res.json({ success: true, data: match });
    } catch (err) {
        console.error('POST brand-dpl match error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * Internal helper: run matchWithZohoItems against parsed-rows + return the
 * payload shape consumed by admin-dpl.html's showAiResults().
 */
async function runMatchAgainstStoredDpl(brand, parsedRows) {
    const unmappedCats = new Set();
    const cleanItems = parsedRows.map(r => {
        const rawCat = String(r.category || '').toUpperCase().trim();
        let canonCat = PASTE_CAT_TO_CANON[rawCat];
        if (canonCat === undefined && rawCat) {
            unmappedCats.add(rawCat);
            canonCat = r.category || '';
        }
        return {
            product: r.product, packSize: r.packSize, dpl: r.dpl,
            category: canonCat || '',
            brand: r.brand, baseCode: r.baseCode,
        };
    });
    if (unmappedCats.size > 0) {
        console.warn('[brand-dpl] Unmapped categories — pass-through (may mis-match): ' + Array.from(unmappedCats).join(', '));
    }

    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                zoho_rate AS rate, zoho_cf_dpl AS cf_dpl,
                zoho_brand AS brand, zoho_category_name AS category, zoho_description AS description,
                dpl_updated_at
         FROM zoho_items_map
         WHERE zoho_status = 'active'
         ORDER BY zoho_item_name ASC`
    );

    const matchResult = priceListParser.matchWithZohoItems(cleanItems, zohoItems);

    const itemsOut = [];
    for (const m of matchResult.matched) {
        const out = { product: m.product, packSize: m.packSize, dpl: m.dpl, category: m.category };
        if (m.zoho_item_id) {
            out.auto_match = {
                zoho_item_id:         m.zoho_item_id,
                zoho_item_name:       m.zoho_item_name,
                proposed_name:        m.proposed_name        || null,
                proposed_sku:         m.proposed_sku         || null,
                proposed_description: m.proposed_description || null,
                proposed_rate:        m.proposed_rate        || null,
                current_sku:          m.current_sku          || null,
                current_description:  m.current_description  || null,
                current_rate:         m.currentRate          || null,
                current_dpl:          m.currentDpl           || null,
                warning:              m._warning             || null,
            };
        }
        itemsOut.push(out);
    }
    for (const u of matchResult.unmatched) {
        itemsOut.push({
            product: u.product, packSize: u.packSize || '?', dpl: u.dpl, category: u.category,
            unmatched_reason: u._reject_reason || null,
        });
    }

    const brandNorm = priceListParser.normalizeBrand('Birla Opus');
    const sameBrandZoho = zohoItems.filter(z => {
        let zb = priceListParser.normalizeBrand(z.brand || '');
        if (!zb) {
            const nm = (z.name || '').toUpperCase();
            zb = (nm.includes('BIRLA') || nm.includes('OPUS')) ? 'BIRLAOPUS' : '';
        }
        if (!zb) return true;
        return zb === brandNorm || zb.includes(brandNorm) || brandNorm.includes(zb);
    });

    const zohoItemsOut = sameBrandZoho.map(z => ({
        zoho_item_id: z.zoho_item_id,
        name: z.name, sku: z.sku,
        rate: parseFloat(z.rate || 0),
        cf_dpl: parseFloat(z.cf_dpl || 0),
        category: z.category || '', description: z.description || '', brand: z.brand || '',
        dpl_updated_at: z.dpl_updated_at ? new Date(z.dpl_updated_at).toISOString() : null,
    }));

    return {
        brand, pages: 0,
        totalExtracted: itemsOut.length,
        autoMatched: matchResult.matched.length,
        needsReview: matchResult.unmatched.length,
        items: itemsOut,
        zohoItems: zohoItemsOut,
        source: { type: 'stored-dpl', parsed: parsedRows.length },
    };
}
```

### - [ ] Step 5: Verify the module loads

Run from working directory:

```bash
node -e "require('./routes/zoho.js'); console.log('OK')"
```

Expected: `OK`. If it errors, read the error carefully — most likely cause is `pool` not being in scope where `brandDplService.setPool(pool)` was inserted; move that call to wherever `pool` is created.

### - [ ] Step 6: Commit

```bash
git add routes/zoho.js
git commit -m "$(cat <<'EOF'
feat(dpl): brand_dpl_lists endpoints (GET / POST save / POST match)

Replaces the ephemeral /items/parse-pasted-dpl endpoint with three persistent
endpoints backed by the new brand_dpl_lists table:

- GET  /items/brand-dpl/:brand        — summary card data
- POST /items/brand-dpl/:brand        — save text + optionally match
- POST /items/brand-dpl/:brand/match  — re-match using stored data

PASTE_CAT_TO_CANON hoisted to module-level constant for reuse. Audit
log records brand_dpl.save with row-count diff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend state machine

**Files:**
- Modify: `public/admin-dpl.html`

The current frontend has the amber "Paste DPL Text" panel inserted at lines ~209-237 (HTML) and the `parsePastedText()` + `updatePastedDplLineCount()` JS handlers at lines ~739-790. We will:
1. Restructure the panel HTML so it has two child containers: a Saved Summary Card (initially hidden) and a Paste UI block (the existing textarea + Save button, relabeled).
2. Replace `parsePastedText()` with a state machine: `loadBrandDplState`, `renderSavedDplCard`, `renderPasteDplUI`, `saveBrandDpl`, `matchSavedDpl`, `startUpdateDpl`.
3. Wire the brand-card click handler (existing `selectBrand` function) to call `loadBrandDplState(brand)`.
4. Update `backToUpload()` to reload brand state.

### - [ ] Step 1: Replace the amber panel HTML

Find the existing amber panel block in `public/admin-dpl.html` (search for `<!-- Paste Text Mode — alternate input` to locate). Replace from that comment line through the closing `</div>` of the outer `<div class="mt-4 border-t pt-4">` (roughly 28 lines) with this new block:

```html
            <!-- Brand DPL Mode — saved per-brand DPL price list -->
            <div id="brandDplPanel" class="mt-4 border-t pt-4 hidden">
                <!-- State A: Saved DPL summary card -->
                <div id="brandDplSavedCard" class="hidden">
                    <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <div class="flex items-start gap-3 mb-3">
                            <svg class="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                            <div class="flex-1">
                                <div class="font-bold text-sm text-emerald-800" id="brandDplSavedTitle">Birla Opus DPL — Saved</div>
                                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-[11px]">
                                    <div><span class="text-gray-500">Rows:</span> <span class="font-semibold text-gray-800" id="brandDplSavedRows">-</span></div>
                                    <div><span class="text-gray-500">Effective:</span> <span class="font-semibold text-gray-800" id="brandDplSavedEffective">-</span></div>
                                    <div><span class="text-gray-500">Last updated:</span> <span class="font-semibold text-gray-800" id="brandDplSavedUpdated">-</span></div>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2 mt-2">
                            <button onclick="matchSavedDpl()" id="matchSavedDplBtn" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-2 disabled:opacity-50">
                                <svg id="matchSavedDplSpinner" class="hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                ⚡ Match Now
                            </button>
                            <button onclick="startUpdateDpl()" id="updateDplBtn" class="px-4 py-2 border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold transition">📝 Update DPL</button>
                        </div>
                    </div>
                </div>
                <!-- State B: Paste UI -->
                <div id="brandDplPasteCard" class="hidden">
                    <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div class="flex items-start gap-3 mb-3">
                            <svg class="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                            <div>
                                <div class="font-bold text-sm text-amber-800" id="brandDplPasteTitle">Paste DPL Text — Birla Opus</div>
                                <div class="text-[11px] text-amber-700 mt-0.5">Paste a tab-separated DPL table (SNo, Category, Product, Shade, PackSize, Price). The text is saved as the brand's default — match runs automatically afterwards.</div>
                            </div>
                        </div>
                        <textarea id="pastedDplText" rows="8" aria-label="Pasted DPL text"
                                  class="w-full text-[11px] font-mono px-3 py-2 border border-amber-300 rounded bg-white focus:border-amber-500 outline-none resize-y"
                                  placeholder="1&#9;Interior Luxury&#9;One Pure Elegance (941001)&#9;White&#9;1L&#9;490&#10;2&#9;Interior Luxury&#9;One Pure Elegance (941001)&#9;White&#9;4L&#9;1,930&#10;..."
                                  oninput="updatePastedDplLineCount()"></textarea>
                        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mt-3">
                            <div class="flex flex-wrap items-center gap-3">
                                <div id="pastedDplLineCount" class="text-[11px] text-amber-700">Lines detected: 0</div>
                                <label class="text-[11px] text-amber-700">Effective date:
                                    <input type="date" id="pastedDplEffectiveDate" class="ml-1 px-2 py-0.5 border border-amber-300 rounded text-[11px] bg-white focus:border-amber-500 outline-none">
                                </label>
                            </div>
                            <button onclick="saveBrandDpl()" id="saveBrandDplBtn" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-2 disabled:opacity-50">
                                <svg id="saveBrandDplSpinner" class="hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                💾 Save & Match
                            </button>
                        </div>
                    </div>
                </div>
            </div>
```

### - [ ] Step 2: Replace the JS handlers

Find the existing JS handler block (search anchor: `function updatePastedDplLineCount()` — should locate around line 740). Replace from `// ============ PASTE TEXT MODE ============` through the closing `}` of `parsePastedText()` (about 50 lines, ending before the next function definition) with this new block:

```javascript
    // ============ BRAND DPL MODE (saved + match) ============
    var currentBrandDpl = null; // tracks which brand's panel is currently visible

    function updatePastedDplLineCount() {
        var ta = document.getElementById('pastedDplText');
        var txt = ta && ta.value ? ta.value : '';
        var nonBlankLines = txt.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
        var out = document.getElementById('pastedDplLineCount');
        if (out) out.textContent = 'Lines detected: ' + nonBlankLines;
    }

    async function loadBrandDplState(brand) {
        currentBrandDpl = brand;
        var panel = document.getElementById('brandDplPanel');
        var savedCard = document.getElementById('brandDplSavedCard');
        var pasteCard = document.getElementById('brandDplPasteCard');
        if (!panel || !savedCard || !pasteCard) return;
        panel.classList.remove('hidden');

        // For v1, only Birla Opus is supported. Other brands → no panel.
        if (brand !== 'birlaopus') {
            panel.classList.add('hidden');
            return;
        }

        try {
            var resp = await fetch('/api/zoho/items/brand-dpl/' + encodeURIComponent(brand), {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (resp.status === 404) {
                renderPasteDplUI();
                return;
            }
            if (!resp.ok) {
                var err = await resp.json().catch(function() { return {}; });
                throw new Error(err.message || ('Server error ' + resp.status));
            }
            var body = await resp.json();
            renderSavedDplCard(body.data);
        } catch (e) {
            showToast('Failed to load DPL state: ' + e.message, 'error');
            renderPasteDplUI();
        }
    }

    function renderSavedDplCard(data) {
        document.getElementById('brandDplSavedCard').classList.remove('hidden');
        document.getElementById('brandDplPasteCard').classList.add('hidden');
        document.getElementById('brandDplSavedRows').textContent = data.parsed_count != null ? data.parsed_count : '-';
        document.getElementById('brandDplSavedEffective').textContent = data.effective_date ? formatDplDate(data.effective_date) : '—';
        var updatedTxt = '—';
        if (data.updated_at) {
            var d = new Date(data.updated_at);
            updatedTxt = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
                         ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
            if (data.updated_by) updatedTxt += ' (' + data.updated_by + ')';
        }
        document.getElementById('brandDplSavedUpdated').textContent = updatedTxt;
    }

    function renderPasteDplUI() {
        document.getElementById('brandDplSavedCard').classList.add('hidden');
        document.getElementById('brandDplPasteCard').classList.remove('hidden');
        var dateInput = document.getElementById('pastedDplEffectiveDate');
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().slice(0, 10);
        }
        updatePastedDplLineCount();
    }

    function formatDplDate(iso) {
        // iso "2026-02-25" → "25 Feb 2026"
        var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return iso;
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return parseInt(m[3], 10) + ' ' + months[parseInt(m[2], 10) - 1] + ' ' + m[1];
    }

    async function saveBrandDpl() {
        var brand = currentBrandDpl || 'birlaopus';
        var ta = document.getElementById('pastedDplText');
        var dateInput = document.getElementById('pastedDplEffectiveDate');
        var text = ta && ta.value ? ta.value : '';
        var effectiveDate = dateInput && dateInput.value ? dateInput.value : null;
        if (!text.trim()) {
            showToast('Paste some DPL text first', 'error');
            return;
        }
        var btn = document.getElementById('saveBrandDplBtn');
        var sp = document.getElementById('saveBrandDplSpinner');
        btn.disabled = true; sp.classList.remove('hidden');
        var statusEl = document.getElementById('parseStatus');
        if (statusEl) statusEl.textContent = 'Saving + matching...';
        try {
            var resp = await fetch('/api/zoho/items/brand-dpl/' + encodeURIComponent(brand), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
                body: JSON.stringify({ text: text, effective_date: effectiveDate, match: true })
            });
            if (!resp.ok) {
                var err = await resp.json().catch(function() { return {}; });
                throw new Error(err.message || ('Server error ' + resp.status));
            }
            var body = await resp.json();
            if (!body.success) throw new Error(body.message || 'Save failed');
            aiData = body.data.match;
            if (statusEl) statusEl.textContent = 'Saved + matched ' + (body.data.match.totalExtracted || 0) + ' rows.';
            showAiResults();
            // Pre-emptively flip the panel so when the user comes back via backToUpload it shows summary.
            renderSavedDplCard(body.data.saved);
        } catch (err) {
            showToast('Save error: ' + err.message, 'error');
            if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        } finally {
            btn.disabled = false; sp.classList.add('hidden');
        }
    }

    async function matchSavedDpl() {
        var brand = currentBrandDpl || 'birlaopus';
        var btn = document.getElementById('matchSavedDplBtn');
        var sp = document.getElementById('matchSavedDplSpinner');
        btn.disabled = true; sp.classList.remove('hidden');
        var statusEl = document.getElementById('parseStatus');
        if (statusEl) statusEl.textContent = 'Matching saved DPL...';
        try {
            var resp = await fetch('/api/zoho/items/brand-dpl/' + encodeURIComponent(brand) + '/match', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (!resp.ok) {
                var err = await resp.json().catch(function() { return {}; });
                throw new Error(err.message || ('Server error ' + resp.status));
            }
            var body = await resp.json();
            if (!body.success) throw new Error(body.message || 'Match failed');
            aiData = body.data;
            if (statusEl) statusEl.textContent = 'Matched ' + (body.data.totalExtracted || 0) + ' rows from saved DPL.';
            showAiResults();
        } catch (err) {
            showToast('Match error: ' + err.message, 'error');
            if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        } finally {
            btn.disabled = false; sp.classList.add('hidden');
        }
    }

    async function startUpdateDpl() {
        var brand = currentBrandDpl || 'birlaopus';
        try {
            var resp = await fetch('/api/zoho/items/brand-dpl/' + encodeURIComponent(brand) + '?include=raw', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (resp.ok) {
                var body = await resp.json();
                var ta = document.getElementById('pastedDplText');
                if (ta && body.data && body.data.raw_text) {
                    ta.value = body.data.raw_text;
                    updatePastedDplLineCount();
                }
                var dateInput = document.getElementById('pastedDplEffectiveDate');
                if (dateInput && body.data && body.data.effective_date) {
                    dateInput.value = body.data.effective_date;
                }
            }
        } catch (e) {
            // Pre-fill is optional — fall through to empty paste UI.
        }
        renderPasteDplUI();
    }
```

### - [ ] Step 3: Wire `loadBrandDplState` to brand-card click

Find the existing `selectBrand` function in `public/admin-dpl.html` (search for `function selectBrand(`). At the end of that function (just before its closing `}`), add a call to `loadBrandDplState`:

```javascript
        loadBrandDplState(brand);
```

If the function uses early returns, ensure the call runs on every successful path (i.e., place it just before the function's closing brace, after all the brand-card visual-state updates).

### - [ ] Step 4: Update `backToUpload` to refresh brand state

Find the `backToUpload` function (search for `function backToUpload()`). Replace the existing pasted-text reset block:

```javascript
        var pastedTa = document.getElementById('pastedDplText');
        if (pastedTa) pastedTa.value = '';
        var pastedCount = document.getElementById('pastedDplLineCount');
        if (pastedCount) pastedCount.textContent = 'Lines detected: 0';
```

With:

```javascript
        var pastedTa = document.getElementById('pastedDplText');
        if (pastedTa) pastedTa.value = '';
        var pastedCount = document.getElementById('pastedDplLineCount');
        if (pastedCount) pastedCount.textContent = 'Lines detected: 0';
        // Re-fetch brand DPL state so saved-summary card appears if data was just saved
        if (currentBrandDpl) loadBrandDplState(currentBrandDpl);
```

### - [ ] Step 5: Skip live browser test

Browser smoke testing is the user's responsibility post-deploy; skip live test in this task. As a static check, verify that the file contains all the new IDs the JS references:

```bash
grep -n "brandDplPanel\|brandDplSavedCard\|brandDplPasteCard\|matchSavedDplBtn\|saveBrandDplBtn\|pastedDplEffectiveDate" public/admin-dpl.html
```

Expected: each ID appears at least once in HTML and at least once in the JS handlers.

### - [ ] Step 6: Commit

```bash
git add public/admin-dpl.html
git commit -m "$(cat <<'EOF'
feat(dpl): brand-DPL state machine in admin-dpl.html

Replaces the ephemeral parse-then-show flow with a saved-summary card
+ paste-UI state machine driven by brand-card selection. Two states:

- SavedDplCard (rows, effective date, last updated) + [Match Now] +
  [Update DPL] buttons
- PasteCard (textarea + effective-date picker + Save & Match button)

Uses the new GET / POST save / POST match endpoints. parsePastedText()
removed; new functions: loadBrandDplState, renderSavedDplCard,
renderPasteDplUI, saveBrandDpl, matchSavedDpl, startUpdateDpl,
formatDplDate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification (after all tasks)

- [ ] All Jest tests pass: `npx jest tests/unit/brand-dpl-service.test.js tests/unit/dpl-tabular-parser.test.js` → green.
- [ ] Existing tests still pass: `npx jest` → no NEW failures (the 3 baseline failures `reorder-report`, `production-monitor`, `invoice-line-sync` are pre-existing).
- [ ] `node -e "require('./routes/zoho.js'); console.log('OK')"` prints `OK`.
- [ ] `git log --oneline -5` shows four new commits: migration, service, endpoints, frontend.
- [ ] `grep -n "parse-pasted-dpl\|parsePastedText" routes/zoho.js public/admin-dpl.html` returns no matches (deleted endpoint + handler are fully removed).

## Self-Review Notes

- **Spec coverage:**
  - Goal 1 (DB persistence) → Task 1 (migration) + Task 2 (service)
  - Goal 2 (summary on saved, paste UI on unsaved) → Task 4 (state machine)
  - Goal 3 (Match Now uses stored data) → Task 3 (POST `/match` endpoint)
  - Goal 4 (Update DPL replaces saved row) → Task 4 (`startUpdateDpl` + `saveBrandDpl`)
  - Goal 5 (parse once at save, not on every match) → Task 2 (`getForMatch` returns parsed_rows JSON; no re-parse)

- **Type consistency:** `saved` summary shape `{ brand, parsed_count, effective_date, updated_at, updated_by }` is identical across service `save()` return, `get()` return, GET endpoint response, POST endpoint `data.saved`, frontend `renderSavedDplCard` consumer.

- **No placeholders.** Every step has exact code, exact paths, exact commands.

- **Cutover safety.** Migration in Task 1 lands first; old endpoint deleted in Task 3. Frontend in Task 4. Order is critical: deploy must run migration before serving the new endpoint code, but `migrate.js` runs at app start so on `pm2 restart` the table exists before the route handler is callable.
