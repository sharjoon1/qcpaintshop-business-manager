const mysql = require('mysql2/promise');
const attendanceService = require('../../services/painter-attendance-service');
require('dotenv').config();

let pool;
let testPainterId;
let testBranchId;

beforeAll(async () => {
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'qc_business_manager',
        port: process.env.DB_PORT || 3306
    });
    attendanceService.setPool(pool);

    // Insert a test painter (painters has only full_name + phone as strictly required)
    const [p] = await pool.query(
        "INSERT INTO painters (full_name, phone) VALUES ('Test Attendance Painter', ?)",
        [`900000${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`]
    );
    testPainterId = p.insertId;

    // Find an existing active branch with GPS. Do NOT mutate production branches.
    const [b] = await pool.query(
        "SELECT id FROM branches WHERE status='active' AND latitude IS NOT NULL AND longitude IS NOT NULL LIMIT 1"
    );
    if (b.length > 0) {
        testBranchId = b[0].id;
    } else {
        throw new Error('No active branch with GPS coordinates available for integration test. Please set lat/lng on at least one branch.');
    }
});

afterAll(async () => {
    if (testPainterId) {
        await pool.query('DELETE FROM painter_attendance_ledger WHERE painter_id=?', [testPainterId]);
        await pool.query('DELETE FROM painter_attendance_checkins WHERE painter_id=?', [testPainterId]);
        await pool.query('DELETE FROM painter_attendance_monthly WHERE painter_id=?', [testPainterId]);
        await pool.query('DELETE FROM painter_clawback_pending WHERE painter_id=?', [testPainterId]);
        await pool.query('DELETE FROM painters WHERE id=?', [testPainterId]);
    }
    await pool.end();
});

describe('attendance flow', () => {
    test('check-in creates ledger + monthly row', async () => {
        // Use the branch's own GPS as the painter's position so distance = 0 (well within geofence)
        const [branchRow] = await pool.query(
            'SELECT latitude, longitude FROM branches WHERE id=?', [testBranchId]
        );
        const lat = Number(branchRow[0].latitude);
        const lng = Number(branchRow[0].longitude);

        const result = await attendanceService.recordCheckin({
            painterId: testPainterId,
            branchId: testBranchId,
            lat,
            lng,
            selfiePath: '/uploads/painter-attendance/test.jpg',
            distanceMeters: 10,
            pointsPerDay: 100
        });
        expect(result.checkinId).toBeGreaterThan(0);

        const [ledger] = await pool.query(
            "SELECT * FROM painter_attendance_ledger WHERE painter_id=? AND type='earn'",
            [testPainterId]
        );
        expect(ledger.length).toBe(1);
        expect(ledger[0].ap_delta).toBe(100);

        const [monthly] = await pool.query(
            'SELECT * FROM painter_attendance_monthly WHERE painter_id=?',
            [testPainterId]
        );
        expect(monthly[0].total_checkins).toBe(1);
        expect(monthly[0].total_ap_earned).toBe(100);
    });

    test('duplicate check-in same day errors via UNIQUE key', async () => {
        const [branchRow] = await pool.query(
            'SELECT latitude, longitude FROM branches WHERE id=?', [testBranchId]
        );
        const lat = Number(branchRow[0].latitude);
        const lng = Number(branchRow[0].longitude);

        await expect(attendanceService.recordCheckin({
            painterId: testPainterId,
            branchId: testBranchId,
            lat,
            lng,
            selfiePath: '/test2.jpg',
            distanceMeters: 10,
            pointsPerDay: 100
        })).rejects.toThrow();
    });
});
