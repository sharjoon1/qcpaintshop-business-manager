// tests/unit/admin-notifications.test.js
const { buildAudienceQuery } = require('../../routes/admin-notifications');

describe('buildAudienceQuery', () => {
    test('all: no extra WHERE clauses', () => {
        const { sql, params } = buildAudienceQuery('all', null);
        expect(sql).not.toContain('branch_id');
        expect(sql).not.toContain('current_level');
        expect(params).toHaveLength(0);
    });

    test('branch: adds branch_id IN filter', () => {
        const { sql, params } = buildAudienceQuery('branch', [1, 2]);
        expect(sql).toContain('p.branch_id IN (?)');
        expect(params).toEqual([[1, 2]]);
    });

    test('level: adds current_level IN filter', () => {
        const { sql, params } = buildAudienceQuery('level', ['bronze', 'silver']);
        expect(sql).toContain('p.current_level IN (?)');
        expect(params).toEqual([['bronze', 'silver']]);
    });

    test('city: adds city IN filter', () => {
        const { sql, params } = buildAudienceQuery('city', ['Chennai']);
        expect(sql).toContain('p.city IN (?)');
        expect(params).toEqual([['Chennai']]);
    });

    test('specific: adds painter id IN filter', () => {
        const { sql, params } = buildAudienceQuery('specific', [5, 10]);
        expect(sql).toContain('p.id IN (?)');
        expect(params).toEqual([[5, 10]]);
    });

    test('unknown audience type: no extra filter (safe fallback)', () => {
        const { sql, params } = buildAudienceQuery('unknown', [1]);
        expect(params).toHaveLength(0);
    });
});
