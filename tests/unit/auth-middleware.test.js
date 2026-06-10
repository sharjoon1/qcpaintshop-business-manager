/**
 * Auth stack characterization tests (T3) — first coverage of the four auth
 * systems' middleware/service layer. Locks:
 *   - the EXACT token-hash forms (staff/painter: SQL LOWER(SHA2(?,256));
 *     customer: JS sha256 hex) — CLAUDE.md §4 says keep these forms;
 *   - full-admin bypass (admin/administrator/super_admin, case-insensitive);
 *   - status codes + bodies for missing/expired/denied paths;
 *   - req.user / req.customer / req.painter population contracts.
 *
 * These run against the REAL modules with a mocked pool — they must keep
 * passing unchanged through the A2 session-cache refactor.
 */
jest.mock('../../services/audit-log', () => ({ record: jest.fn() }));

const crypto = require('crypto');
const audit = require('../../services/audit-log');
const pm = require('../../middleware/permissionMiddleware');
const { requireCustomerAuth } = require('../../middleware/customerAuth');
const customerAuth = require('../../services/customer-auth');

function makeRes() {
    const res = { statusCode: 200, body: null };
    res.status = jest.fn(c => { res.statusCode = c; return res; });
    res.json = jest.fn(b => { res.body = b; return res; });
    return res;
}

const staffReq = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

function makeStaffPool({ session = null, rolePerms = [], roleRow = [{ id: 9 }] } = {}) {
    const calls = [];
    return {
        calls,
        query: jest.fn(async (sql, params) => {
            calls.push([sql, params]);
            if (/FROM user_sessions s/i.test(sql)) return [session ? [session] : []];
            if (/FROM role_permissions rp/i.test(sql)) return [rolePerms];
            if (/FROM roles WHERE name/i.test(sql)) return [roleRow];
            return [[]];
        }),
    };
}

const STAFF_SESSION = {
    user_id: 7, username: 'ravi', role: 'staff', full_name: 'Ravi K',
    email: 'r@x.com', branch_id: 2,
};

beforeEach(() => {
    jest.clearAllMocks();
    pm.clearAuthCache(); // A2 cache is module-global — isolate tests
});

describe('isFullAdmin / FULL_ADMIN_ROLES', () => {
    it.each([
        ['admin', true], ['administrator', true], ['super_admin', true],
        ['ADMIN', true], ['Super_Admin', true],
        ['staff', false], ['manager', false], ['', false], [null, false], [undefined, false],
    ])('%s → %s', (role, expected) => {
        expect(pm.isFullAdmin(role)).toBe(expected);
    });
});

describe('requireAuth (staff)', () => {
    it('401 AUTH_REQUIRED without a Bearer token', async () => {
        pm.initPool(makeStaffPool());
        const res = makeRes(); const next = jest.fn();
        await pm.requireAuth(staffReq(null), res, next);
        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('AUTH_REQUIRED');
        expect(next).not.toHaveBeenCalled();
    });

    it('401 SESSION_EXPIRED when no session row matches', async () => {
        pm.initPool(makeStaffPool({ session: null }));
        const res = makeRes(); const next = jest.fn();
        await pm.requireAuth(staffReq('tok'), res, next);
        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe('SESSION_EXPIRED');
    });

    it('valid session → req.user populated, lookup uses LOWER(SHA2(?,256)) with active-user + expiry guards', async () => {
        const pool = makeStaffPool({ session: STAFF_SESSION });
        pm.initPool(pool);
        const req = staffReq('tok'); const res = makeRes(); const next = jest.fn();
        await pm.requireAuth(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toEqual({
            id: 7, username: 'ravi', role: 'staff', branch_id: 2,
            full_name: 'Ravi K', email: 'r@x.com',
        });
        const [sql, params] = pool.calls[0];
        expect(sql).toMatch(/token_hash = LOWER\(SHA2\(\?, 256\)\)/);
        expect(sql).toMatch(/expires_at > NOW\(\)/);
        expect(sql).toMatch(/u\.status = 'active'/);
        expect(params).toEqual(['tok']);
    });

    it('500 AUTH_CHECK_ERROR when the pool throws', async () => {
        pm.initPool({ query: jest.fn(async () => { throw new Error('db down'); }) });
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = makeRes(); const next = jest.fn();
        await pm.requireAuth(staffReq('tok'), res, next);
        errSpy.mockRestore();
        expect(res.statusCode).toBe(500);
        expect(res.body.code).toBe('AUTH_CHECK_ERROR');
        expect(next).not.toHaveBeenCalled();
    });
});

describe('requirePermission', () => {
    it('full admin bypasses the role_permissions lookup entirely', async () => {
        const pool = makeStaffPool({ session: { ...STAFF_SESSION, role: 'super_admin' } });
        pm.initPool(pool);
        const req = staffReq('tok'); const res = makeRes(); const next = jest.fn();
        await pm.requirePermission('estimates', 'view')(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(pool.calls.some(c => /FROM role_permissions/i.test(c[0]))).toBe(false);
    });

    it('non-admin with a matching role permission passes', async () => {
        const pool = makeStaffPool({ session: STAFF_SESSION, rolePerms: [{ id: 1 }] });
        pm.initPool(pool);
        const res = makeRes(); const next = jest.fn();
        await pm.requirePermission('estimates', 'view')(staffReq('tok'), res, next);
        expect(next).toHaveBeenCalled();
        const permCall = pool.calls.find(c => /FROM role_permissions/i.test(c[0]));
        expect(permCall[1]).toEqual(['staff', 'estimates', 'view']);
    });

    it('non-admin without the permission → 403 PERMISSION_DENIED and the denial is audited (SYS-009)', async () => {
        pm.initPool(makeStaffPool({ session: STAFF_SESSION, rolePerms: [] }));
        const res = makeRes(); const next = jest.fn();
        await pm.requirePermission('salary', 'manage')(staffReq('tok'), res, next);
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('PERMISSION_DENIED');
        expect(res.body.required_permission).toEqual({ module: 'salary', action: 'manage' });
        expect(next).not.toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            action: 'PERMISSION_DENIED', entity_id: 'salary.manage',
        }));
    });
});

describe('requireRole', () => {
    it("listing 'admin' auto-accepts administrator and super_admin", async () => {
        for (const role of ['admin', 'administrator', 'super_admin']) {
            const pool = makeStaffPool({ session: { ...STAFF_SESSION, role } });
            pm.initPool(pool);
            const res = makeRes(); const next = jest.fn();
            await pm.requireRole('admin')(staffReq('tok'), res, next);
            expect(next).toHaveBeenCalled();
        }
    });

    it('role outside the list → 403 ROLE_DENIED', async () => {
        pm.initPool(makeStaffPool({ session: STAFF_SESSION })); // role: staff
        const res = makeRes(); const next = jest.fn();
        await pm.requireRole('admin', 'manager')(staffReq('tok'), res, next);
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('ROLE_DENIED');
    });
});

describe('A2 session/permission cache', () => {
    it('caches the session ≤45s: second request with the same token skips the DB', async () => {
        const pool = makeStaffPool({ session: STAFF_SESSION });
        pm.initPool(pool);
        await pm.requireAuth(staffReq('tok'), makeRes(), jest.fn());
        const req2 = staffReq('tok'); const next2 = jest.fn();
        await pm.requireAuth(req2, makeRes(), next2);
        expect(next2).toHaveBeenCalled();
        expect(req2.user.id).toBe(7);
        const sessionQueries = pool.calls.filter(c => /FROM user_sessions s/i.test(c[0]));
        expect(sessionQueries).toHaveLength(1); // one DB hit, second served from cache
    });

    it('does NOT cache misses — an invalid token re-hits the DB each time', async () => {
        const pool = makeStaffPool({ session: null });
        pm.initPool(pool);
        await pm.requireAuth(staffReq('bad'), makeRes(), jest.fn());
        await pm.requireAuth(staffReq('bad'), makeRes(), jest.fn());
        expect(pool.calls.filter(c => /FROM user_sessions s/i.test(c[0]))).toHaveLength(2);
    });

    it('expires by TTL (45s)', async () => {
        const pool = makeStaffPool({ session: STAFF_SESSION });
        pm.initPool(pool);
        const t0 = Date.now();
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
        await pm.requireAuth(staffReq('tok'), makeRes(), jest.fn());
        nowSpy.mockReturnValue(t0 + 46 * 1000); // past TTL
        await pm.requireAuth(staffReq('tok'), makeRes(), jest.fn());
        nowSpy.mockRestore();
        expect(pool.calls.filter(c => /FROM user_sessions s/i.test(c[0]))).toHaveLength(2);
    });

    it('invalidateSessionToken drops the entry immediately (logout)', async () => {
        const pool = makeStaffPool({ session: STAFF_SESSION });
        pm.initPool(pool);
        await pm.requireAuth(staffReq('tok'), makeRes(), jest.fn());
        pm.invalidateSessionToken('tok');
        await pm.requireAuth(staffReq('tok'), makeRes(), jest.fn());
        expect(pool.calls.filter(c => /FROM user_sessions s/i.test(c[0]))).toHaveLength(2);
    });

    it('invalidateUser drops every cached session of that user', async () => {
        const pool = makeStaffPool({ session: STAFF_SESSION });
        pm.initPool(pool);
        await pm.requireAuth(staffReq('tokA'), makeRes(), jest.fn());
        await pm.requireAuth(staffReq('tokB'), makeRes(), jest.fn()); // same user_id 7
        pm.invalidateUser(7);
        await pm.requireAuth(staffReq('tokA'), makeRes(), jest.fn());
        await pm.requireAuth(staffReq('tokB'), makeRes(), jest.fn());
        expect(pool.calls.filter(c => /FROM user_sessions s/i.test(c[0]))).toHaveLength(4);
    });

    it('caches permission verdicts per (role, module, action); clearPermissionCache resets', async () => {
        const pool = makeStaffPool({ session: STAFF_SESSION, rolePerms: [{ id: 1 }] });
        pm.initPool(pool);
        const mw = pm.requirePermission('estimates', 'view');
        await mw(staffReq('tok'), makeRes(), jest.fn());
        await mw(staffReq('tok'), makeRes(), jest.fn());
        expect(pool.calls.filter(c => /FROM role_permissions/i.test(c[0]))).toHaveLength(1);
        pm.clearPermissionCache();
        await mw(staffReq('tok'), makeRes(), jest.fn());
        expect(pool.calls.filter(c => /FROM role_permissions/i.test(c[0]))).toHaveLength(2);
    });
});

describe('customer auth (service + middleware)', () => {
    const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

    function makeCustomerPool({ session = null } = {}) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                calls.push([sql, params]);
                if (/FROM customer_sessions/i.test(sql)) return [session ? [session] : []];
                return [{ affectedRows: 1 }];
            }),
        };
    }

    it('requireCustomerAuth: 401 without token; 401 when session unresolvable', async () => {
        customerAuth.setPool(makeCustomerPool({ session: null }));
        let res = makeRes(); let next = jest.fn();
        await requireCustomerAuth({ headers: {} }, res, next);
        expect(res.statusCode).toBe(401);

        res = makeRes(); next = jest.fn();
        await requireCustomerAuth({ headers: { authorization: 'Bearer nope' } }, res, next);
        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('valid token → req.customer populated; lookup compares JS sha256(token) and excludes revoked/expired', async () => {
        const pool = makeCustomerPool({ session: { customer_id: 11, phone: '9876543210', expires_at: new Date() } });
        customerAuth.setPool(pool);
        const req = { headers: { authorization: 'Bearer rawtok' } };
        const res = makeRes(); const next = jest.fn();
        await requireCustomerAuth(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.customer).toEqual({ id: 11, phone: '9876543210' });
        const [sql, params] = pool.calls[0];
        expect(sql).toMatch(/revoked_at IS NULL/);
        expect(sql).toMatch(/expires_at > NOW\(\)/);
        expect(params).toEqual([sha256('rawtok')]);
    });

    it('createSession stores ONLY the sha256 hash and a ~30-day expiry; returns the 64-hex raw token', async () => {
        const pool = makeCustomerPool();
        customerAuth.setPool(pool);
        const raw = await customerAuth.createSession({ customerId: 5, phone: '9876543210', ip: '1.2.3.4', userAgent: 'jest' });
        expect(raw).toMatch(/^[0-9a-f]{64}$/);
        const ins = pool.calls.find(c => /INSERT INTO customer_sessions/i.test(c[0]));
        expect(ins[1][0]).toBe(sha256(raw));          // token_hash, never the raw token
        expect(ins[1]).not.toContain(raw);
        const expiresAt = ins[1][3];
        const days = (expiresAt - Date.now()) / 86400000;
        expect(days).toBeGreaterThan(29.9);
        expect(days).toBeLessThan(30.1);
    });
});

describe('painter session middleware', () => {
    // routes/painters.js is heavy but require-safe; we only exercise the
    // exported middlewares with a mocked pool.
    const painters = require('../../routes/painters');

    function makePainterPool({ session = null } = {}) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                calls.push([sql, params]);
                if (/FROM painter_sessions ps/i.test(sql)) return [session ? [session] : []];
                return [[]];
            }),
        };
    }

    const painterReq = (token) => ({ headers: token ? { 'x-painter-token': token } : {} });

    it('requirePainterAuth: 401 without token / unknown token; SQL uses LOWER(SHA2(?,256))', async () => {
        const pool = makePainterPool({ session: null });
        painters.setPool(pool);
        let res = makeRes(); let next = jest.fn();
        await painters.requirePainterAuth(painterReq(null), res, next);
        expect(res.statusCode).toBe(401);

        res = makeRes(); next = jest.fn();
        await painters.requirePainterAuth(painterReq('tok'), res, next);
        expect(res.statusCode).toBe(401);
        const [sql] = pool.calls[0];
        expect(sql).toMatch(/token_hash = LOWER\(SHA2\(\?, 256\)\)/);
        expect(sql).toMatch(/expires_at > NOW\(\)/);
    });

    it('requirePainterAuth rejects non-approved painters with 403, approved pass with req.painter', async () => {
        painters.setPool(makePainterPool({ session: { painter_id: 3, status: 'pending', full_name: 'Mani' } }));
        let res = makeRes(); let next = jest.fn();
        await painters.requirePainterAuth(painterReq('tok'), res, next);
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toBe('Account is pending');
        expect(next).not.toHaveBeenCalled();

        painters.setPool(makePainterPool({ session: { painter_id: 3, status: 'approved', full_name: 'Mani' } }));
        const req = painterReq('tok'); res = makeRes(); next = jest.fn();
        await painters.requirePainterAuth(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.painter).toEqual({ id: 3, name: 'Mani' });
    });

    it('requirePainterSession accepts pending painters and exposes status', async () => {
        painters.setPool(makePainterPool({ session: { painter_id: 3, status: 'pending', full_name: 'Mani' } }));
        const req = painterReq('tok'); const res = makeRes(); const next = jest.fn();
        await painters.requirePainterSession(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.painter).toEqual({ id: 3, name: 'Mani', status: 'pending' });
    });
});
