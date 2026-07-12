/**
 * Unit tests for routes/painter-leads/api.js
 *
 * Strategy: stub out the permission middleware so handlers run as if the
 * caller is the user we set on req.user. Drive the route handlers against
 * a mocked pool that returns canned rows and captures SQL. SMS service is
 * mocked too so we don't hit Nettyfish in tests.
 *
 * Covers (per Task 3 spec):
 *   1. CRUD: create + update + assign happy path
 *   2. Owner check: a staff user cannot edit leads they don't own
 *   3. Duplicate phone: second insert with same number is rejected 409
 *   4. Followup: status moves to 'in_progress' and counts increment
 *   5. Invite: token generated, painter_lead_invites row inserted, status 'invited'
 */

jest.mock('../../services/audit-log', () => ({ record: jest.fn() }));
jest.mock('../../services/sms-service', () => ({ sendSms: jest.fn(async () => 'sms-ok') }));

// Stub permission middleware so handlers run as the user we attach to req.user.
jest.mock('../../middleware/permissionMiddleware', () => {
    const real = jest.requireActual('../../middleware/permissionMiddleware');
    return {
        ...real,
        requirePermission: () => (req, res, next) => {
            // Inject req.user from a header for testability — handlers read req.user.
            const raw = req.headers['x-test-user'];
            if (raw) req.user = JSON.parse(raw);
            next();
        },
        requireAnyPermission: () => (req, res, next) => {
            const raw = req.headers['x-test-user'];
            if (raw) req.user = JSON.parse(raw);
            next();
        },
    };
});

const express = require('express');
const painterLeads = require('../../routes/painter-leads/api');
const smsService = require('../../services/sms-service');

// ─────────────────────────────────────────────────────────────────────────
//  Helpers — fake pool with query spy
// ─────────────────────────────────────────────────────────────────────────

function makeFakePool() {
    const calls = [];
    const responses = [];
    let connectionCalls = 0;

    const pool = {
        calls,
        query: jest.fn(async (sql, params) => {
            calls.push({ kind: 'q', sql: String(sql).trim(), params });
            const next = responses.shift();
            if (next !== undefined) return next;
            return [[]];
        }),
        getConnection: jest.fn(async () => {
            connectionCalls += 1;
            return {
                beginTransaction: jest.fn(async () => {}),
                commit: jest.fn(async () => {}),
                rollback: jest.fn(async () => {}),
                release: jest.fn(),
                query: jest.fn(async (sql, params) => {
                    calls.push({ kind: 'tx', sql: String(sql).trim(), params });
                    return [[]];
                }),
            };
        }),
        _connectionCalls: () => connectionCalls,
    };

    // mockResolvedValueOnce normally replaces the mock implementation, which
    // would stop SQL/params from being captured in pool.calls. Queue responses
    // manually so every query is still recorded.
    pool.query.mockResolvedValueOnce = function (value) {
        responses.push(value);
        return pool.query;
    };

    return pool;
}

function makeApp(pool) {
    painterLeads.setPool(pool);
    const app = express();
    app.use(express.json());
    app.use('/api/painter-leads', painterLeads.router);
    return app;
}

// Tiny supertest replacement so we don't depend on supertest being installed.
function call(app, { method, path, body, user }) {
    return new Promise((resolve) => {
        const req = { method, url: path, body: body || {}, headers: {} };
        if (user) req.headers['x-test-user'] = JSON.stringify(user);
        const res = {
            statusCode: 200,
            body: null,
            status(c) { this.statusCode = c; return this; },
            json(b) { this.body = b; this._ended = true; resolve(this); return this; },
        };
        // Express route lookup
        app._router.handle(req, res, () => {
            if (!res._ended) resolve(res);
        });
    });
}

// Build a minimal Express app and request manually using express itself.
function httpCall(app, { method, path, body, user }) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, (err) => {
            if (err) return reject(err);
            const port = server.address().port;
            const data = body ? JSON.stringify(body) : null;
            const url = `http://127.0.0.1:${port}${path}`;
            const opts = { method, headers: {} };
            if (data) {
                opts.headers['content-type'] = 'application/json';
                opts.headers['content-length'] = Buffer.byteLength(data);
            }
            if (user) opts.headers['x-test-user'] = JSON.stringify(user);

            const http = require('http');
            const req = http.request(url, opts, (resp) => {
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
//  Test users
// ─────────────────────────────────────────────────────────────────────────

const ADMIN_USER = { id: 1, role: 'admin', full_name: 'Admin User', username: 'admin', branch_id: 1 };
const MANAGER_USER = { id: 2, role: 'manager', full_name: 'Branch Manager', username: 'mgr', branch_id: 1 };
const STAFF_OWNER = { id: 10, role: 'staff', full_name: 'Ravi K', username: 'ravi', branch_id: 1 };
const STAFF_OTHER = { id: 11, role: 'staff', full_name: 'Kavi R', username: 'kavi', branch_id: 1 };

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
//  1. CRUD happy path — create then update
// ─────────────────────────────────────────────────────────────────────────

describe('CRUD: create + update + assign', () => {
    test('admin creates lead, lead_number generated as PL-YYYYMMDD-XXXX, then updates notes', async () => {
        const pool = makeFakePool();
        // First call: SELECT MAX for lead_number → empty day → seq 0001
        // Second call: INSERT
        // Third call: SELECT to return created row
        pool.query
            .mockResolvedValueOnce([[]])                              // SELECT MAX for generateLeadNumber
            .mockResolvedValueOnce([{ insertId: 42 }])                // INSERT painter_leads
            .mockResolvedValueOnce([[{                               // SELECT for response
                id: 42, lead_number: 'PL-20260630-0001',
                full_name: 'Test Painter', phone: '9876543210', status: 'new',
                assigned_to: 1, created_by: 1, total_attempts: 0, contact_count: 0,
                assigned_to_name: 'Admin User', branch_name: 'HQ',
            }]])
            .mockResolvedValueOnce([[{                               // SELECT for PUT (existing row)
                id: 42, assigned_to: 1, status: 'new', phone: '9876543210',
                lead_number: 'PL-20260630-0001',
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])              // UPDATE
            .mockResolvedValueOnce([[{                               // SELECT post-update
                id: 42, lead_number: 'PL-20260630-0001', notes: 'Updated note',
                assigned_to_name: 'Admin User', branch_name: 'HQ',
            }]]);

        const app = makeApp(pool);
        const create = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads',
            user: ADMIN_USER,
            body: { full_name: 'Test Painter', phone: '+91 98765 43210', email: 'tp@example.com', notes: 'orig' },
        });
        expect(create.statusCode).toBe(201);
        expect(create.body.success).toBe(true);
        expect(create.body.data.lead_number).toMatch(/^PL-\d{8}-\d{4}$/);

        // Lead number generator should have issued a SELECT MAX inside a tx.
        const maxCall = pool.calls.find(c => /FROM painter_leads/.test(c.sql) && /LIKE \?/.test(c.sql));
        expect(maxCall).toBeDefined();

        // Verify the INSERT uses parameterized phone (last 10 digits).
        const insertCall = pool.calls.find(c => /INSERT INTO painter_leads/i.test(c.sql));
        expect(insertCall).toBeDefined();
        expect(insertCall.params).toContain('9876543210');
        expect(insertCall.params).toContain('Test Painter');

        // Update the same lead with notes
        const upd = await httpCall(app, {
            method: 'PUT', path: '/api/painter-leads/42',
            user: ADMIN_USER,
            body: { notes: 'Updated note' },
        });
        expect(upd.statusCode).toBe(200);
        expect(upd.body.success).toBe(true);
        expect(upd.body.data.notes).toBe('Updated note');
    });

    test('manager assigns lead to a staff member', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                              // SELECT existing
                id: 7, assigned_to: null, branch_id: 1, lead_number: 'PL-20260630-0007',
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])              // UPDATE
            .mockResolvedValueOnce([[{                              // SELECT post
                id: 7, lead_number: 'PL-20260630-0007',
                assigned_to: 10, assigned_to_name: 'Ravi K', branch_name: 'HQ',
            }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/7/assign',
            user: MANAGER_USER,
            body: { assigned_to: 10 },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.assigned_to).toBe(10);

        const updateCall = pool.calls.find(c => /UPDATE painter_leads SET/i.test(c.sql) && /assigned_to/i.test(c.sql));
        expect(updateCall).toBeDefined();
        expect(updateCall.params).toContain(10);
        expect(updateCall.params).toContain(7);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  2. Owner check — staff can only edit own leads
// ─────────────────────────────────────────────────────────────────────────

describe('Owner check: PUT /:id rejects non-owner staff', () => {
    test('staff editing a lead assigned to a different user → 403', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                              // SELECT existing row
                id: 5, assigned_to: 99, status: 'new', phone: '9876543211',
                lead_number: 'PL-20260630-0005',
            }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painter-leads/5',
            user: STAFF_OWNER, // owner is 99, caller is 10
            body: { notes: 'should not stick' },
        });
        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);

        // No UPDATE should have run.
        const updateCall = pool.calls.find(c => /^UPDATE painter_leads SET/.test(c.sql));
        expect(updateCall).toBeUndefined();
    });

    test('staff editing a lead assigned to themselves → 200', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                              // SELECT existing
                id: 5, assigned_to: 10, status: 'new', phone: '9876543211',
                lead_number: 'PL-20260630-0005',
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])              // UPDATE
            .mockResolvedValueOnce([[{                              // SELECT post-update
                id: 5, lead_number: 'PL-20260630-0005', notes: 'owner edit',
                assigned_to_name: 'Ravi K', branch_name: 'HQ',
            }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'PUT', path: '/api/painter-leads/5',
            user: STAFF_OWNER,
            body: { notes: 'owner edit' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  3. Duplicate phone — second insert with same number rejected
// ─────────────────────────────────────────────────────────────────────────

describe('Duplicate phone rejection', () => {
    test('POST with phone matching an active lead → 409 DUPLICATE_PHONE', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[                          // SELECT for dup check
            { id: 99, lead_number: 'PL-20260630-0099', full_name: 'Existing', status: 'interested' },
        ]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads',
            user: STAFF_OWNER,
            body: { full_name: 'New Painter', phone: '9876543210' },
        });
        expect(res.statusCode).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('DUPLICATE_PHONE');
        expect(res.body.existing_lead.lead_number).toBe('PL-20260630-0099');

        // No INSERT should have run.
        const insertCall = pool.calls.find(c => /^INSERT INTO painter_leads/.test(c.sql));
        expect(insertCall).toBeUndefined();
    });

    test('phone with country code 91 is normalized to last 10 digits before comparison', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[]]);                       // SELECT for dup check (no match)

        const app = makeApp(pool);
        await httpCall(app, {
            method: 'POST', path: '/api/painter-leads',
            user: STAFF_OWNER,
            body: { full_name: 'P', phone: '+91-98765 43210' },
        });

        const dupCheck = pool.calls.find(c => /SELECT.*FROM painter_leads/i.test(c.sql) && /phone/i.test(c.sql));
        expect(dupCheck).toBeDefined();
        expect(dupCheck.params).toContain('9876543210');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  4. Followup — status transitions and counters increment
// ─────────────────────────────────────────────────────────────────────────

describe('Followup logging', () => {
    test('first followup on a new lead moves status → in_progress, increments total_attempts', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                              // SELECT existing lead
                id: 3, assigned_to: 10, status: 'new',
            }]])
            .mockResolvedValueOnce([{ insertId: 500 }])               // INSERT followup (inside tx)
            .mockResolvedValueOnce([[{                              // SELECT followup
                id: 500, painter_lead_id: 3, followup_type: 'call',
                outcome: 'callback', notes: 'called, will retry',
            }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/3/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'call', outcome: 'callback', notes: 'called, will retry' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.lead_status).toBe('in_progress');

        // UPDATE should bump total_attempts and set status.
        const upd = pool.calls.find(c =>
            /^UPDATE painter_leads/.test(c.sql) && /total_attempts = total_attempts \+ 1/.test(c.sql)
        );
        expect(upd).toBeDefined();
        // params order: outcome, status, next_eligible, connected-flag, id
        expect(upd.params[1]).toBe('in_progress');
        expect(upd.params[4]).toBe(3);
    });

    test('followup with outcome=not_interested moves status → not_interested', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{ id: 3, assigned_to: 10, status: 'in_progress' }]])
            .mockResolvedValueOnce([{ insertId: 501 }])
            .mockResolvedValueOnce([[{ id: 501, outcome: 'not_interested' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/3/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'call', outcome: 'not_interested', notes: 'declined' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.body.data.lead_status).toBe('not_interested');
    });

    test('followup missing notes → 400', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 3, assigned_to: 10, status: 'new' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/3/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'call', outcome: 'callback' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  4b. CM1 hotfix — widened ENUMs, call_status validation, PNTR bridge
// ─────────────────────────────────────────────────────────────────────────

describe('Followup ENUM widening + call_status validation (CM1)', () => {
    const ALL_OUTCOMES = [
        'interested', 'not_interested', 'callback', 'no_response',
        'converted', 'wrong_number', 'unreachable', 'other',
    ];

    test.each(ALL_OUTCOMES)('outcome "%s" passes validation → 201', async (outcome) => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 3, assigned_to: 10, status: 'in_progress' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/3/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'call', outcome, notes: 'logged' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
    });

    test('followup_type "sms" is accepted → 201', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 3, assigned_to: 10, status: 'in_progress' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/3/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'sms', outcome: 'interested', notes: 'texted' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
    });

    test('invalid call_status → 400 with NO INSERT and no transaction opened', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 3, assigned_to: 10, status: 'new' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/3/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'call', outcome: 'interested', notes: 'n', call_status: 'not_a_status' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/call_status/);

        // Validation happens before any DB write / transaction.
        const insert = pool.calls.find(c => /INSERT INTO painter_lead_followups/i.test(c.sql));
        expect(insert).toBeUndefined();
        const bridge = pool.calls.find(c => /painter_daily_assignments/i.test(c.sql));
        expect(bridge).toBeUndefined();
        expect(pool._connectionCalls()).toBe(0);
    });

    test('valid call_status "connected" is accepted → 201', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 3, assigned_to: 10, status: 'new' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/3/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'call', outcome: 'interested', notes: 'reached', call_status: 'connected' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
    });
});

describe('PNTR bridge — painter_daily_assignments stamp inside the tx (CM1)', () => {
    test('owner followup stamps contacted_at + contact_outcome scoped to lead.assigned_to', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 7, assigned_to: 10, status: 'new' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/7/followup',
            user: STAFF_OWNER,
            body: { followup_type: 'call', outcome: 'interested', notes: 'reached', call_status: 'connected' },
        });
        expect(res.statusCode).toBe(201);

        const bridge = pool.calls.find(c => c.kind === 'tx' && /painter_daily_assignments/.test(c.sql));
        expect(bridge).toBeDefined();
        expect(bridge.sql).toMatch(/contacted_at = NOW\(\)/);
        expect(bridge.sql).toMatch(/assigned_date = CURDATE\(\)/);
        expect(bridge.sql).toMatch(/painter_lead_id = \?/);
        expect(bridge.sql).toMatch(/user_id = \?/);
        // params: [outcome, painter_lead_id, user_id(=assigned_to)]
        expect(bridge.params).toEqual(['interested', 7, 10]);
    });

    test('manager acting on another user\'s lead binds user_id to lead.assigned_to, not the actor', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 8, assigned_to: 10, status: 'in_progress' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/8/followup',
            user: MANAGER_USER, // id 2, acting on staff 10's lead
            body: { followup_type: 'call', outcome: 'callback', notes: 'will retry' },
        });
        expect(res.statusCode).toBe(201);

        const bridge = pool.calls.find(c => c.kind === 'tx' && /painter_daily_assignments/.test(c.sql));
        expect(bridge).toBeDefined();
        expect(bridge.params).toEqual(['callback', 8, 10]); // assigned_to's row, not actor 2
        expect(bridge.params).not.toContain(MANAGER_USER.id);
    });

    test('lead with no assignee omits the user_id filter (still stamps)', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{ id: 9, assigned_to: null, status: 'new' }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/9/followup',
            user: ADMIN_USER,
            body: { followup_type: 'whatsapp', outcome: 'no_response', notes: 'no reply' },
        });
        expect(res.statusCode).toBe(201);

        const bridge = pool.calls.find(c => c.kind === 'tx' && /painter_daily_assignments/.test(c.sql));
        expect(bridge).toBeDefined();
        expect(bridge.sql).not.toMatch(/user_id = \?/);
        expect(bridge.params).toEqual(['no_response', 9]);
    });
});

describe('migration 20260713_painter_followup_enums (CM1)', () => {
    const migration = require('../../migrations/20260713_painter_followup_enums');

    const PROD_OUTCOME =
        "enum('interested_in_program','already_aware','will_visit_shop','wants_callback','not_interested','wrong_number','no_answer')";
    const PROD_FOLLOWUP = "enum('call','whatsapp','visit')";
    const WIDE_OUTCOME =
        "enum('interested_in_program','already_aware','will_visit_shop','wants_callback','not_interested','wrong_number','no_answer','interested','callback','no_response','converted','unreachable','other')";
    const WIDE_FOLLOWUP = "enum('call','whatsapp','visit','sms')";

    function makeMigrationPool({ outcomeType, followupType, outcomeDefault = null }) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).trim();
                calls.push({ s, params });
                if (/information_schema\.COLUMNS/i.test(s)) {
                    const col = params[1];
                    if (col === 'outcome') {
                        return [[{ COLUMN_TYPE: outcomeType, IS_NULLABLE: 'YES', COLUMN_DEFAULT: outcomeDefault }]];
                    }
                    if (col === 'followup_type') {
                        return [[{ COLUMN_TYPE: followupType, IS_NULLABLE: 'NO', COLUMN_DEFAULT: null }]];
                    }
                    return [[]];
                }
                return [[]];
            }),
        };
    }

    test('exports an up() function', () => {
        expect(typeof migration.up).toBe('function');
    });

    test('appends the 6 outcome values + sms at the END, preserving order + nullability', async () => {
        const pool = makeMigrationPool({ outcomeType: PROD_OUTCOME, followupType: PROD_FOLLOWUP });
        await migration.up(pool);

        const alters = pool.calls.filter(c => /^ALTER TABLE/i.test(c.s));
        expect(alters.length).toBe(2);

        const outcomeAlter = alters.find(a => /MODIFY COLUMN outcome/.test(a.s));
        expect(outcomeAlter).toBeDefined();
        // existing values preserved in order, new ones appended at the end
        expect(outcomeAlter.s).toContain(
            "'no_answer','interested','callback','no_response','converted','unreachable','other')"
        );
        expect(outcomeAlter.s.endsWith(' NULL')).toBe(true);   // stays NULLable
        expect(outcomeAlter.s.includes('NOT NULL')).toBe(false);

        const typeAlter = alters.find(a => /MODIFY COLUMN followup_type/.test(a.s));
        expect(typeAlter).toBeDefined();
        expect(typeAlter.s).toContain("'call','whatsapp','visit','sms')");
        expect(typeAlter.s.endsWith('NOT NULL')).toBe(true);   // stays NOT NULL
    });

    test('re-run against a DB already reporting the new values is a no-op (no ALTER)', async () => {
        const pool = makeMigrationPool({ outcomeType: WIDE_OUTCOME, followupType: WIDE_FOLLOWUP });
        await migration.up(pool);

        const alters = pool.calls.filter(c => /^ALTER TABLE/i.test(c.s));
        expect(alters.length).toBe(0);
    });

    test('parseEnumValues / buildEnumType round-trip', () => {
        const vals = migration.parseEnumValues(PROD_FOLLOWUP);
        expect(vals).toEqual(['call', 'whatsapp', 'visit']);
        expect(migration.buildEnumType(vals)).toBe(PROD_FOLLOWUP);
    });

    // Regression: MariaDB 10.2+ reports a NULL default as the SQL literal string 'NULL'
    // (unlike MySQL's SQL NULL). The first prod run generated DEFAULT 'NULL' — an invalid
    // enum member — and the outcome ALTER failed with "Invalid default value".
    test("MariaDB 'NULL' string COLUMN_DEFAULT never becomes DEFAULT 'NULL'", async () => {
        const pool = makeMigrationPool({
            outcomeType: PROD_OUTCOME,
            followupType: WIDE_FOLLOWUP,
            outcomeDefault: 'NULL',
        });
        await migration.up(pool);

        const outcomeAlter = pool.calls.find(c => /MODIFY COLUMN outcome/.test(c.s));
        expect(outcomeAlter).toBeDefined();
        expect(outcomeAlter.s).not.toContain("DEFAULT 'NULL'");
        expect(outcomeAlter.s.endsWith('DEFAULT NULL')).toBe(true);
    });

    test("MariaDB quoted string default ('x') is unwrapped, not double-quoted", async () => {
        const pool = makeMigrationPool({
            outcomeType: PROD_OUTCOME,
            followupType: WIDE_FOLLOWUP,
            outcomeDefault: "'no_answer'",
        });
        await migration.up(pool);

        const outcomeAlter = pool.calls.find(c => /MODIFY COLUMN outcome/.test(c.s));
        expect(outcomeAlter.s.endsWith("DEFAULT 'no_answer'")).toBe(true);
        expect(outcomeAlter.s).not.toContain("''no_answer''");
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  5. Invite — token generated, painter_lead_invites row inserted,
//     lead status moves to 'invited'. WhatsApp unavailable → SMS fallback.
// ─────────────────────────────────────────────────────────────────────────

describe('Send-invite endpoint', () => {
    test('staff sends invite for own lead → SMS fallback (no wwjs), token + invite row inserted', async () => {
        const pool = makeFakePool();
        pool.query
            .mockResolvedValueOnce([[{                              // SELECT existing lead
                id: 4, assigned_to: 10, full_name: 'Ramu',
                phone: '9876543210', status: 'interested', branch_id: 1,
            }]])
            .mockResolvedValueOnce([{ insertId: 800 }])               // INSERT painter_lead_invites (tx)
            .mockResolvedValueOnce([{ affectedRows: 1 }])             // UPDATE painter_leads (tx)

            .mockResolvedValueOnce([[{                              // SELECT lead (response — not strictly used)
                id: 4, status: 'invited',
            }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/4/send-invite',
            user: STAFF_OWNER,
            body: {},
        });
        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.channel).toBe('sms');
        expect(res.body.data.delivery_status).toBe('sent');
        expect(res.body.data.invite_token).toMatch(/^[0-9a-f]{64}$/);
        expect(res.body.data.invite_url).toContain('act.qcpaintshop.com/painter-register.html?token=');

        // SMS service must have been called (since wwjs isn't loaded in test env).
        expect(smsService.sendSms).toHaveBeenCalledTimes(1);
        const smsCall = smsService.sendSms.mock.calls[0][0];
        expect(smsCall.number).toBe('919876543210'); // 91 + last 10 digits
        expect(smsCall.text).toContain(res.body.data.invite_token);

        // painter_lead_invites INSERT
        const inviteInsert = pool.calls.find(c => /^INSERT INTO painter_lead_invites/.test(c.sql));
        expect(inviteInsert).toBeDefined();
        // params: painter_lead_id, sent_by, channel, message, invite_token, status
        expect(inviteInsert.params[0]).toBe(4);
        expect(inviteInsert.params[1]).toBe(STAFF_OWNER.id);
        expect(inviteInsert.params[2]).toBe('sms');
        expect(inviteInsert.params[4]).toBe(res.body.data.invite_token);

        // Lead UPDATE sets invite_token, invited_by, status='invited'
        const leadUpdate = pool.calls.find(c =>
            /UPDATE painter_leads/i.test(c.sql) && /invite_token/i.test(c.sql)
        );
        expect(leadUpdate).toBeDefined();
        expect(leadUpdate.params).toContain('invited'); // status
        expect(leadUpdate.params).toContain(4);          // id
    });

    test('staff sending invite for someone else\'s lead → 403', async () => {
        const pool = makeFakePool();
        pool.query.mockResolvedValueOnce([[{                          // SELECT existing
            id: 4, assigned_to: 99, full_name: 'Other',
            phone: '9876543210', status: 'new', branch_id: 1,
        }]]);

        const app = makeApp(pool);
        const res = await httpCall(app, {
            method: 'POST', path: '/api/painter-leads/4/send-invite',
            user: STAFF_OWNER,
            body: {},
        });
        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);

        expect(smsService.sendSms).not.toHaveBeenCalled();
    });
});
