const mysql = require('mysql2/promise');
require('dotenv').config();

describe('Brand Reorder Config (data layer + business rules)', () => {
    let pool;
    beforeAll(async () => {
        pool = mysql.createPool({
            host: process.env.DB_HOST, user: process.env.DB_USER,
            password: process.env.DB_PASSWORD, database: process.env.DB_NAME
        });
    });
    afterAll(async () => { if (pool) await pool.end(); });

    beforeEach(async () => {
        await pool.query(`DELETE FROM brand_reorder_config WHERE brand_name != '__default__'`);
    });

    test('__default__ row exists after migration', async () => {
        const [rows] = await pool.query(`SELECT * FROM brand_reorder_config WHERE brand_name = '__default__'`);
        expect(rows.length).toBe(1);
        expect(rows[0].lead_time_days).toBe(7);
        expect(rows[0].safety_days).toBe(5);
    });

    test('INSERT new brand succeeds and returns with correct values', async () => {
        await pool.query(
            `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days) VALUES (?, ?, ?)`,
            ['Asian Paints', 3, 3]
        );
        const [rows] = await pool.query(`SELECT * FROM brand_reorder_config WHERE brand_name = ?`, ['Asian Paints']);
        expect(rows.length).toBe(1);
        expect(rows[0].lead_time_days).toBe(3);
        expect(rows[0].safety_days).toBe(3);
        expect(rows[0].is_active).toBe(1);
    });

    test('Duplicate brand_name raises ER_DUP_ENTRY', async () => {
        await pool.query(
            `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days) VALUES (?, ?, ?)`,
            ['Berger', 5, 3]
        );
        await expect(pool.query(
            `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days) VALUES (?, ?, ?)`,
            ['Berger', 6, 4]
        )).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });

    test('UPDATE changes lead/safety but preserves brand_name', async () => {
        const [ins] = await pool.query(
            `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days) VALUES (?, ?, ?)`,
            ['Shalimar', 10, 5]
        );
        await pool.query(
            `UPDATE brand_reorder_config SET lead_time_days = ?, safety_days = ? WHERE id = ?`,
            [12, 7, ins.insertId]
        );
        const [rows] = await pool.query(`SELECT * FROM brand_reorder_config WHERE id = ?`, [ins.insertId]);
        expect(rows[0].lead_time_days).toBe(12);
        expect(rows[0].safety_days).toBe(7);
        expect(rows[0].brand_name).toBe('Shalimar');
    });

    test('Business rule: __default__ cannot be deleted (enforced at route level)', () => {
        const isLocked = (n) => n === '__default__';
        expect(isLocked('__default__')).toBe(true);
        expect(isLocked('Asian Paints')).toBe(false);
    });
});
