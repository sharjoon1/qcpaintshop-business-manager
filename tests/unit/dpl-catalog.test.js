describe('migrate-dpl-catalog', () => {
    test('exports up() and creates the table idempotently', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        expect(typeof mig.up).toBe('function');

        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[]]; // table absent
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE dpl_catalog/.test(q))).toBe(true);
        expect(queries.some(q => /match_key/.test(q) && /UNIQUE/.test(q))).toBe(true);
    });

    test('up() skips creation when the table already exists', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[{ t: 'dpl_catalog' }]]; // present
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE/.test(q))).toBe(false);
    });
});
