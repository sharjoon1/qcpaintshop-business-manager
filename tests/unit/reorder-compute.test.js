const {
    computeReorderLevel, computeSeverity, computeReorderQuantity,
    refreshAlerts, setPool
} = require('../../services/reorder-compute-service');

describe('reorder-compute pure helpers', () => {
    test('computeReorderLevel multiplies avg sales by (lead + safety) and ceils', () => {
        expect(computeReorderLevel(2.5, 7, 5)).toBe(30);
        expect(computeReorderLevel(1, 3, 3)).toBe(6);
        expect(computeReorderLevel(0.5, 10, 5)).toBe(8);
    });

    test('computeReorderQuantity returns 15-day replenish pack (ceiled)', () => {
        expect(computeReorderQuantity(2)).toBe(30);
        expect(computeReorderQuantity(0.5)).toBe(8);
    });

    test('computeSeverity tiers by stock/reorder ratio', () => {
        expect(computeSeverity(2, 10)).toBe('critical');
        expect(computeSeverity(4, 10)).toBe('high');
        expect(computeSeverity(6, 10)).toBe('medium');
        expect(computeSeverity(9, 10)).toBe('low');
        expect(computeSeverity(15, 10)).toBe(null);
    });

    test('computeSeverity returns null when reorder level is 0 or negative', () => {
        expect(computeSeverity(5, 0)).toBe(null);
        expect(computeSeverity(5, -1)).toBe(null);
    });
});

/**
 * P2 — refreshAlerts() wrote alert rows with NULL item_name / location_name, so the
 * reorder dashboard could not say WHICH item at WHICH branch was low. The other writer
 * to the same table (zoho-api.js :: checkReorderAlerts) already sources those names from
 * zoho_location_stock.item_name + zoho_locations_map.zoho_location_name; refreshAlerts
 * now does the same. Columns already exist on prod (checkReorderAlerts writes them) —
 * no DDL, no migration.
 */
describe('refreshAlerts (DB path, mocked pool)', () => {
    /** Runs refreshAlerts over `rows` (the SELECT result); returns every query made. */
    async function run(rows, { updateAffected = 1 } = {}) {
        const calls = [];
        setPool({
            query: async (sql, params) => {
                calls.push({ sql, params });
                if (/^\s*SELECT/i.test(sql)) return [rows];
                if (/^\s*UPDATE/i.test(sql)) return [{ affectedRows: updateAffected }];
                return [{}];
            }
        });
        const result = await refreshAlerts();
        return {
            result,
            selectSql: calls[0].sql,
            inserts: calls.filter(c => /INSERT INTO zoho_reorder_alerts/i.test(c.sql)),
            updates: calls.filter(c => /UPDATE zoho_reorder_alerts/i.test(c.sql))
        };
    }

    const lowStockRow = {
        zoho_item_id: 'I1', zoho_location_id: 'L1', reorder_level: 100, stock: 10,
        item_name: 'IE01 RD1 ROYALE 01 L', location_name: 'Main Branch'
    };

    test('reads the item and location names alongside stock', async () => {
        const { selectSql } = await run([lowStockRow]);
        expect(selectSql).toMatch(/zoho_reorder_config rc/);
        expect(selectSql).toMatch(/zoho_location_stock ls/);
        expect(selectSql).toMatch(/ls\.item_name/);
        expect(selectSql).toMatch(/zoho_locations_map/);
        expect(selectSql).toMatch(/zoho_location_name/);
        expect(selectSql).toMatch(/rc\.is_active = 1/);
    });

    test('inserts an active alert carrying item_name and location_name', async () => {
        const { result, inserts } = await run([lowStockRow]);

        expect(result).toEqual({ active: 1, resolved: 0 });
        expect(inserts).toHaveLength(1);
        expect(inserts[0].sql).toMatch(/item_name/);
        expect(inserts[0].sql).toMatch(/location_name/);
        // severity: 10/100 = 0.1 → critical
        expect(inserts[0].params).toEqual(['I1', 'L1', 'critical', 'IE01 RD1 ROYALE 01 L', 'Main Branch', 10, 100]);
    });

    test('a NULL name never clobbers a name already on the row (COALESCE, as in syncItems)', async () => {
        const { inserts } = await run([{ ...lowStockRow, item_name: null, location_name: null }]);
        expect(inserts[0].sql).toMatch(/item_name = COALESCE\(VALUES\(item_name\), item_name\)/);
        expect(inserts[0].sql).toMatch(/location_name = COALESCE\(VALUES\(location_name\), location_name\)/);
        expect(inserts[0].params).toEqual(['I1', 'L1', 'critical', null, null, 10, 100]);
    });

    test('keeps the upsert semantics: status back to active, stock/level/severity refreshed', async () => {
        const { inserts } = await run([lowStockRow]);
        expect(inserts[0].sql).toMatch(/ON DUPLICATE KEY UPDATE/);
        expect(inserts[0].sql).toMatch(/severity = VALUES\(severity\)/);
        expect(inserts[0].sql).toMatch(/status = 'active'/);
        expect(inserts[0].sql).toMatch(/current_stock = VALUES\(current_stock\)/);
        expect(inserts[0].sql).toMatch(/reorder_level = VALUES\(reorder_level\)/);
    });

    test('resolves (never inserts) when stock is back above the reorder level', async () => {
        const { result, inserts, updates } = await run([
            { ...lowStockRow, stock: 500 } // ratio > 1 → severity null
        ]);
        expect(inserts).toHaveLength(0);
        expect(updates).toHaveLength(1);
        expect(updates[0].sql).toMatch(/status = 'resolved'/);
        expect(updates[0].params).toEqual(['I1', 'L1']);
        expect(result).toEqual({ active: 0, resolved: 1 });
    });

    test('does not count a resolve that matched no active alert', async () => {
        const { result } = await run([{ ...lowStockRow, stock: 500 }], { updateAffected: 0 });
        expect(result).toEqual({ active: 0, resolved: 0 });
    });
});
