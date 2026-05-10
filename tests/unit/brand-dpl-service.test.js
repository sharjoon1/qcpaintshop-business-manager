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
        pool.query.mockResolvedValueOnce([[{ parsed_rows: parsedRows }]]);
        brandDplService.setPool(pool);

        const out = await brandDplService.getForMatch('birlaopus');
        expect(out).toEqual(parsedRows);
    });
});
