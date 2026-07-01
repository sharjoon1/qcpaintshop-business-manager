/**
 * Unit tests for painter invite-token registration + Zoho auto-link + staff approval.
 *
 * Covers (per Task 4 spec):
 *   1. Registration with valid invite_token links lead to painter and stamps staff
 *   2. Registration with invalid invite_token → 400 INVALID_INVITE_TOKEN
 *   3. Registration auto-links when zoho_customers_map has matching phone
 *   4. Registration enqueues sync_queue when Zoho lookup finds nothing
 *   5. Approval: inviting staff can approve their own painter
 *   6. Approval: non-inviting staff cannot approve → 403 NOT_INVITING_STAFF
 *   7. Approval: full admin can approve any painter
 *   8. Approval: manager can approve any painter
 *
 * Strategy: stub painter-zoho-sync-service and notification-service so the
 * handlers run to completion. Drive both /register and /:id/approve against
 * an Express app with mocked pool, similar to painter-leads.test.js.
 */

jest.mock('../../services/audit-log', () => ({ record: jest.fn() }));
jest.mock('../../services/sms-service', () => ({ sendSms: jest.fn(async () => 'sms-ok') }));
jest.mock('../../services/notification-service', () => ({ send: jest.fn(async () => true) }));
jest.mock('../../services/painter-zoho-sync-service', () => ({
    syncPainterToZoho: jest.fn(async () => ({ skipped: 'test' })),
}));
jest.mock('../../services/painter-points-backfill-service', () => ({
    backfillPainter: jest.fn(async () => ({ skipped: 'test' })),
}));
jest.mock('../../services/zoho-api', () => ({
    updateContact: jest.fn(async () => ({ contact: { contact_id: 'Z1' } })),
    createContact: jest.fn(),
    createSalesperson: jest.fn(),
}));

// Stub the permission middleware: the registration endpoint is public (no
// middleware), and the admin /:id/approve endpoint uses requireAnyPermission
// in production. In tests, we attach req.user directly via the X-Test-User
// header so handlers run as if authorized.
jest.mock('../../middleware/permissionMiddleware', () => {
    const real = jest.requireActual('../../middleware/permissionMiddleware');
    return {
        ...real,
        requirePermission: () => (req, res, next) => {
            const raw = req.headers['x-test-user'];
            if (raw) req.user = JSON.parse(raw);
            next();
        },
        requireAnyPermission: () => (req, res, next) => {
            const raw = req.headers['x-test-user'];
            if (raw) req.user = JSON.parse(raw);
            next();
        },
        requireAuth: (req, res, next) => {
            const raw = req.headers['x-test-user'];
            if (raw) req.user = JSON.parse(raw);
            next();
        },
    };
});

const express = require('express');
const http = require('http');
const publicRoutes = require('../../routes/painters/public');
const adminRoutes = require('../../routes/painters/admin');
const painterZohoSync = require('../../services/painter-zoho-sync-service');
const painterBackfill = require('../../services/painter-points-backfill-service');
const zohoAPI = require('../../services/zoho-api');
const notificationService = require('../../services/notification-service');

// ─────────────────────────────────────────────────────────────────────────
//  Fake pool with programmable query responses
// ─────────────────────────────────────────────────────────────────────────

function makeFakePool() {
    const calls = [];
    const responses = [];
    const pool = {
        calls,
        query: jest.fn(async (sql, params) => {
            calls.push({ sql: String(sql).trim(), params });
            const next = responses.shift();
            if (next !== undefined) return next;
            return [[]];
        }),
        getConnection: jest.fn(async () => ({
            beginTransaction: jest.fn(async () => {}),
            commit: jest.fn(async () => {}),
            rollback: jest.fn(async () => {}),
            release: jest.fn(),
            query: jest.fn(async (sql, params) => {
                calls.push({ sql: String(sql).trim(), params, tx: true });
                return [[]];
            }),
        })),
    };
    pool.query.mockResolvedValueOnce = function (value) {
        responses.push(value);
        return pool.query;
    };
    return pool;
}

// ─────────────────────────────────────────────────────────────────────────
//  Express + raw http helpers (mirrors painter-leads.test.js style)
// ─────────────────────────────────────────────────────────────────────────

function makeApp(pool) {
    publicRoutes.setPool(pool);
    adminRoutes.setPool(pool);
    const app = express();
    app.use(express.json());
    app.use('/api/painters', publicRoutes.router);
    app.use('/api/painters/admin', adminRoutes.router);
    return app;
}

function httpCall(app, { method, path, body, user }) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, (err) => {
            if (err) return reject(err);
            const port = server.address().port;
            const data = body ? JSON.stringify(body) : null;
            const opts = { method, headers: {} };
            if (data) {
                opts.headers['content-type'] = 'application/json';
                opts.headers['content-length'] = Buffer.byteLength(data);
            }
            if (user) opts.headers['x-test-user'] = JSON.stringify(user);

            const req = http.request(`http://127.0.0.1:${port}${path}`, opts, (resp) => {
                let chunks = '';
                resp.on('data', (c) => { chunks += c; });
                resp.on('end', () => {
                    server.close();
                    let parsed;
                    try { parsed = JSON.parse(chunks); } catch (_) { parsed = chunks; }
                    resolve({ statusCode: resp.statusCode, body: parsed });
                });
            });
            req.on('error', (e) => { server.close(); reject(e); });
            if (data) req.write(data);
            req.end();
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────
//  Users
// ─────────────────────────────────────────────────────────────────────────

const ADMIN_USER = { id: 1, role: 'admin', full_name: 'Admin User' };
const MANAGER_USER = { id: 2, role: 'manager', full_name: 'Branch Manager' };
const INVITING_STAFF = { id: 50, role: 'staff', full_name: 'Inviting Staff' };
const OTHER_STAFF = { id: 51, role: 'staff', full_name: 'Other Staff' };

beforeEach(() => {
    jest.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════
//  1. Registration: invite token
// ═════════════════════════════════════════════════════════════════════════

describe('POST /api/painters/register — invite token', () => {
    test('valid invite_token links painter to lead and stamps invited_by_staff_id', async () => {
        const pool = makeFakePool();
        // Order of pool.query calls during a successful register-with-token flow:
        //   1. SELECT phone existing → []
        //   2. SELECT painter_leads by invite_token → lead row
        //   3. SELECT referral_code collision check → []
        //   4. INSERT INTO painters → insertId=99
        //   5. UPDATE painter_leads painter_id+status (best-effort)
        //   6. UPDATE painter_lead_invites registered_at
        //   7. SELECT zoho_customers_map by phone → []
        //   8. INSERT INTO painter_zoho_sync_queue
        //   9. SELECT admins for notify → empty
        //   (the fire-and-forget syncPainterToZoho is not awaited)
        pool.query
            .mockResolvedValueOnce([[]])                                  // 1. phone existing
            .mockResolvedValueOnce([[{                                   // 2. invite_token lookup
                id: 7, status: 'invited', assigned_to: 50, invited_by: 50,
                full_name: 'Lead Person', phone: '9876543210', branch_id: 1,
            }]])
            .mockResolvedValueOnce([[]])                                  // 3. referral code collision
            .mockResolvedValueOnce([{ insertId: 99 }])                    // 4. INSERT painter
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 5. UPDATE painter_leads
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 6. UPDATE painter_lead_invites
            .mockResolvedValueOnce([[]])                                  // 7. zoho_customers_map miss
            .mockResolvedValueOnce([{ insertId: 1 }])                     // 8. INSERT zoho queue
            .mockResolvedValueOnce([[]]);                                 // 9. admins notify

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painters/register',
            body: {
                full_name: 'Lead Person',
                phone: '+91 98765 43210',
                city: 'Bengaluru',
                invite_token: 'abcd1234',
            },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.painterId).toBe(99);

        // INSERT INTO painters must include painter_lead_id and invited_by_staff_id.
        const painterInsert = pool.calls.find(c => /^INSERT INTO painters/i.test(c.sql));
        expect(painterInsert).toBeDefined();
        // params order (15 cols):
        //   full_name, phone, email, city, district, experience_years, specialization,
        //   referral_code, referred_by, aadhar_number, pan_number, address, pincode,
        //   painter_lead_id, invited_by_staff_id
        expect(painterInsert.params[13]).toBe(7);     // painter_lead_id
        expect(painterInsert.params[14]).toBe(50);    // invited_by_staff_id
        // phone stored normalized to last 10 digits
        expect(painterInsert.params[1]).toBe('+91 98765 43210');

        // UPDATE painter_leads sets painter_id=99, status='registered'
        const leadUpdate = pool.calls.find(c =>
            /^UPDATE painter_leads/i.test(c.sql) && /painter_id\s*=\s*\?/i.test(c.sql)
        );
        expect(leadUpdate).toBeDefined();
        expect(leadUpdate.params[0]).toBe(99);
        expect(leadUpdate.params[1]).toBe(7);

        // painter_lead_invites row marked registered
        const inviteUpdate = pool.calls.find(c =>
            /^UPDATE painter_lead_invites/i.test(c.sql) && /registered_at/i.test(c.sql)
        );
        expect(inviteUpdate).toBeDefined();

        // No Zoho auto-link row, so we must have enqueued sync.
        const queueInsert = pool.calls.find(c => /^INSERT INTO painter_zoho_sync_queue/i.test(c.sql));
        expect(queueInsert).toBeDefined();
        expect(queueInsert.params[0]).toBe(99); // painter_id
        expect(queueInsert.sql).toContain("'customer'"); // sync_type hardcoded in SQL
        expect(queueInsert.params[1]).toBe('auto_link_miss_or_update_failed'); // last_error
    });

    test('invalid invite_token → 400 INVALID_INVITE_TOKEN, no INSERT', async () => {
        const pool = makeFakePool();
        // Order:
        //   1. SELECT phone existing → []
        //   2. SELECT painter_leads by invite_token → [] (no match)
        pool.query
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painters/register',
            body: {
                full_name: 'X',
                phone: '9876543210',
                invite_token: 'bad-token',
            },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('INVALID_INVITE_TOKEN');

        // No INSERT INTO painters must have run.
        const painterInsert = pool.calls.find(c => /^INSERT INTO painters/i.test(c.sql));
        expect(painterInsert).toBeUndefined();
    });

    test('no invite_token proceeds normally (backward compatible)', async () => {
        const pool = makeFakePool();
        // No invite_token → skip the painter_leads lookup.
        pool.query
            .mockResolvedValueOnce([[]])                          // 1. phone existing
            .mockResolvedValueOnce([[]])                          // 2. referral code collision
            .mockResolvedValueOnce([{ insertId: 200 }])            // 3. INSERT painter
            .mockResolvedValueOnce([[]])                          // 4. zoho_customers_map miss
            .mockResolvedValueOnce([{ insertId: 1 }])             // 5. INSERT zoho queue
            .mockResolvedValueOnce([[]]);                         // 6. admins notify

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painters/register',
            body: { full_name: 'Self Reg', phone: '9876543211' },
        });
        expect(res.statusCode).toBe(200);

        const painterInsert = pool.calls.find(c => /^INSERT INTO painters/i.test(c.sql));
        expect(painterInsert).toBeDefined();
        // painter_lead_id and invited_by_staff_id should be NULL
        expect(painterInsert.params[13]).toBeNull();
        expect(painterInsert.params[14]).toBeNull();
        // No painter_leads UPDATE should have run.
        const leadUpdate = pool.calls.find(c => /^UPDATE painter_leads/i.test(c.sql));
        expect(leadUpdate).toBeUndefined();
    });
});

// ═════════════════════════════════════════════════════════════════════════
//  2. Registration: Zoho auto-link by phone
// ═════════════════════════════════════════════════════════════════════════

describe('POST /api/painters/register — Zoho auto-link', () => {
    test('matching phone in zoho_customers_map → sets zoho_contact_id on painter + lead, calls updateContact', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[]])                                  // 1. phone existing
            .mockResolvedValueOnce([[{                                   // 2. invite_token lookup
                id: 8, status: 'invited', invited_by: 50, assigned_to: 50,
                full_name: 'Existing Customer', phone: '9876543299', branch_id: 1,
            }]])
            .mockResolvedValueOnce([[]])                                  // 3. referral collision
            .mockResolvedValueOnce([{ insertId: 300 }])                    // 4. INSERT painter
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 5. UPDATE painter_leads
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 6. UPDATE invite
            .mockResolvedValueOnce([[{ zoho_contact_id: 'ZC-EXISTING' }]])// 7. zoho_customers_map HIT
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 8. UPDATE painters zoho_contact_id
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 9. UPDATE painter_leads zoho_contact_id
            .mockResolvedValueOnce([[]]);                                 // 10. admins notify

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painters/register',
            body: {
                full_name: 'Existing Customer',
                phone: '9876543299',
                invite_token: 'good-token',
            },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        // zohoAPI.updateContact called once with cf_painter=true
        expect(zohoAPI.updateContact).toHaveBeenCalledTimes(1);
        const updArgs = zohoAPI.updateContact.mock.calls[0];
        expect(updArgs[0]).toBe('ZC-EXISTING');
        const cf = (updArgs[1].custom_fields || []).find(f => f.api_name === 'cf_painter');
        expect(cf).toBeDefined();
        expect(cf.value).toBe(true);

        // painters.zoho_contact_id was set to ZC-EXISTING
        const painterZcidUpdate = pool.calls.find(c =>
            /^UPDATE painters SET zoho_contact_id/i.test(c.sql)
        );
        expect(painterZcidUpdate).toBeDefined();
        expect(painterZcidUpdate.params[0]).toBe('ZC-EXISTING');
        expect(painterZcidUpdate.params[1]).toBe(300);

        // painter_leads.zoho_contact_id was also set
        const leadZcidUpdate = pool.calls.find(c =>
            /^UPDATE painter_leads SET zoho_contact_id/i.test(c.sql)
        );
        expect(leadZcidUpdate).toBeDefined();
        expect(leadZcidUpdate.params[0]).toBe('ZC-EXISTING');
        expect(leadZcidUpdate.params[1]).toBe(8);

        // When zohoLinkOk, the zoho sync queue should NOT have been enqueued.
        const queueInsert = pool.calls.find(c => /^INSERT INTO painter_zoho_sync_queue/i.test(c.sql));
        expect(queueInsert).toBeUndefined();
    });

    test('updateContact failure → still enqueues sync_queue', async () => {
        const pool = makeFakePool();
        zohoAPI.updateContact.mockRejectedValueOnce(new Error('Zoho 503'));

        pool.query
            .mockResolvedValueOnce([[]])                                  // 1. phone existing
            .mockResolvedValueOnce([[{                                   // 2. invite_token
                id: 9, status: 'invited', invited_by: 50, assigned_to: 50,
                full_name: 'Test', phone: '9876543200', branch_id: 1,
            }]])
            .mockResolvedValueOnce([[]])                                  // 3. referral collision
            .mockResolvedValueOnce([{ insertId: 400 }])                    // 4. INSERT painter
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 5. UPDATE painter_leads
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 6. UPDATE invite
            .mockResolvedValueOnce([[{ zoho_contact_id: 'ZC-EXISTING' }]])// 7. zoho_customers_map HIT
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 8. UPDATE painters zoho_contact_id
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 9. UPDATE painter_leads zoho_contact_id
            .mockResolvedValueOnce([{ insertId: 1 }])                     // 10. INSERT zoho queue
            .mockResolvedValueOnce([[]]);                                 // 11. admins notify

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painters/register',
            body: {
                full_name: 'Test',
                phone: '9876543200',
                invite_token: 'good-token-2',
            },
        });
        // Registration must still succeed despite Zoho failure.
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        // Queue row should be enqueued because zohoLinkOk=false (updateContact threw).
        const queueInsert = pool.calls.find(c => /^INSERT INTO painter_zoho_sync_queue/i.test(c.sql));
        expect(queueInsert).toBeDefined();
        expect(queueInsert.params[0]).toBe(400); // painter_id
        expect(queueInsert.sql).toContain("'customer'"); // sync_type hardcoded in SQL
        expect(queueInsert.params[1]).toBe('auto_link_miss_or_update_failed'); // last_error
    });
});

// ═════════════════════════════════════════════════════════════════════════
//  3. Approval: inviting staff vs non-inviting staff
// ═════════════════════════════════════════════════════════════════════════

describe('PUT /api/painters/admin/:id/approve — staff approval gate', () => {
    test('inviting staff can approve their own painter', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                                   // 1. SELECT painter
                id: 500, status: 'pending', full_name: 'P1', phone: '9876543210',
                invited_by_staff_id: INVITING_STAFF.id, painter_lead_id: 7,
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 2. UPDATE painters status
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 3. UPDATE painter_leads approved_by
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 4. UPDATE painter_referrals
            .mockResolvedValueOnce([[]]);                                 // 5. SELECT painter for WA

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painters/admin/500/approve',
            user: INVITING_STAFF,
            body: { action: 'approve' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        // painters UPDATE — req.params.id is a string from Express.
        const painterUpdate = pool.calls.find(c =>
            /^UPDATE painters SET status/i.test(c.sql) && /approved_by/i.test(c.sql)
        );
        expect(painterUpdate).toBeDefined();
        expect(painterUpdate.params[0]).toBe('approved');
        expect(painterUpdate.params[1]).toBe(INVITING_STAFF.id);
        expect(painterUpdate.params[2]).toBe('500');

        // painter_leads UPDATE (mirror): [approved_by, status_arg, lead_id]
        const leadUpdate = pool.calls.find(c =>
            /^UPDATE painter_leads/i.test(c.sql) && /approved_by/i.test(c.sql)
        );
        expect(leadUpdate).toBeDefined();
        expect(leadUpdate.params[2]).toBe(7); // lead id

        // Zoho sync + backfill triggered
        expect(painterZohoSync.syncPainterToZoho).toHaveBeenCalledWith(
            500, expect.objectContaining({ pool })
        );
        // Wait for the .then() chain to flush.
        await new Promise(resolve => setImmediate(resolve));
        expect(painterBackfill.backfillPainter).toHaveBeenCalledWith(
            500, expect.any(String), expect.objectContaining({ pool })
        );
    });

    test('non-inviting staff cannot approve → 403 NOT_INVITING_STAFF', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{                            // 1. SELECT painter
            id: 600, status: 'pending', full_name: 'P2', phone: '9876543211',
            invited_by_staff_id: INVITING_STAFF.id, // invited by 50, caller is 51
            painter_lead_id: null,
        }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painters/admin/600/approve',
            user: OTHER_STAFF, // id 51, but invited_by_staff_id is 50
            body: { action: 'approve' },
        });
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('NOT_INVITING_STAFF');

        // No UPDATE should have run.
        const updates = pool.calls.filter(c => /^UPDATE (painters|painter_leads)/i.test(c.sql));
        expect(updates).toHaveLength(0);
        expect(painterZohoSync.syncPainterToZoho).not.toHaveBeenCalled();
    });

    test('full admin can approve any painter (no owner check)', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                                   // 1. SELECT
                id: 700, status: 'pending', full_name: 'P3', phone: '9876543212',
                invited_by_staff_id: INVITING_STAFF.id, painter_lead_id: 99,
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 2. UPDATE painters
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 3. UPDATE painter_leads
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 4. UPDATE painter_referrals
            .mockResolvedValueOnce([[]]);                                 // 5. SELECT for WA

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painters/admin/700/approve',
            user: ADMIN_USER,
            body: { action: 'approve' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('manager can approve any painter (no owner check)', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                                   // 1. SELECT
                id: 800, status: 'pending', full_name: 'P4', phone: '9876543213',
                invited_by_staff_id: INVITING_STAFF.id, painter_lead_id: 100,
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 2. UPDATE painters
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 3. UPDATE painter_leads
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 4. UPDATE painter_referrals
            .mockResolvedValueOnce([[]]);                                 // 5. SELECT for WA

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painters/admin/800/approve',
            user: MANAGER_USER,
            body: { action: 'approve' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('reject path does not trigger Zoho sync or backfill', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                                   // 1. SELECT
                id: 900, status: 'pending', full_name: 'P5', phone: '9876543214',
                invited_by_staff_id: INVITING_STAFF.id, painter_lead_id: null,
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 2. UPDATE painters status=rejected
            .mockResolvedValueOnce([{ affectedRows: 1 }])                 // 3. UPDATE painter_leads
            .mockResolvedValueOnce([[]]);                                 // 4. SELECT for WA

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painters/admin/900/approve',
            user: INVITING_STAFF,
            body: { action: 'reject' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toMatch(/rejected/);

        await new Promise(resolve => setImmediate(resolve));
        expect(painterZohoSync.syncPainterToZoho).not.toHaveBeenCalled();
        expect(painterBackfill.backfillPainter).not.toHaveBeenCalled();
    });

    test('painter not found → 404', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[]]);                           // empty SELECT

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painters/admin/99999/approve',
            user: ADMIN_USER,
            body: { action: 'approve' },
        });
        expect(res.statusCode).toBe(404);
    });
});
