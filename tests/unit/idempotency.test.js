/**
 * Unit tests for middleware/idempotency.js (U17)
 */

const { idempotent, setPool } = require('../../middleware/idempotency');

function makeReq({ headers = {}, user = { id: 7 } } = {}) {
    return {
        headers,
        user,
        originalUrl: '/api/billing/estimates',
        method: 'POST',
    };
}

function makeRes() {
    const res = {
        statusCode: 200,
        _body: null,
        _headers: {},
        status(code) { this.statusCode = code; return this; },
        setHeader(k, v) { this._headers[k] = v; },
        json(body) { this._body = body; return this; },
    };
    return res;
}

describe('idempotent(scope) middleware', () => {
    it('passes through when no Idempotency-Key header is present', async () => {
        const fakePool = {
            query: jest.fn(),
        };
        setPool(fakePool);
        const mw = idempotent('test.scope');

        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();

        await mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(fakePool.query).not.toHaveBeenCalled();
    });

    it('rejects malformed Idempotency-Key headers (non-printable)', async () => {
        setPool({ query: jest.fn() });
        const mw = idempotent('test.scope');
        const req = makeReq({ headers: { 'idempotency-key': 'bad\nkey' } });
        const res = makeRes();
        const next = jest.fn();

        await mw(req, res, next);
        expect(res.statusCode).toBe(400);
        expect(res._body.success).toBe(false);
        expect(next).not.toHaveBeenCalled();
    });

    it('replays stored response when key matches an unexpired record', async () => {
        const stored = {
            response_status: 201,
            response_body: JSON.stringify({ success: true, id: 42 }),
        };
        const fakePool = {
            query: jest.fn().mockResolvedValueOnce([[stored]]),
        };
        setPool(fakePool);
        const mw = idempotent('test.scope');

        const req = makeReq({ headers: { 'idempotency-key': 'abc-123' } });
        const res = makeRes();
        const next = jest.fn();

        await mw(req, res, next);

        expect(fakePool.query).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(201);
        expect(res._body).toEqual({ success: true, id: 42 });
        expect(res._headers['Idempotent-Replay']).toBe('true');
        expect(next).not.toHaveBeenCalled();
    });

    it('stores response on first call when key has no record', async () => {
        const fakePool = {
            query: jest.fn()
                .mockResolvedValueOnce([[]])      // SELECT misses
                .mockResolvedValueOnce([{ insertId: 1 }]), // INSERT
        };
        setPool(fakePool);
        const mw = idempotent('test.scope');

        const req = makeReq({ headers: { 'idempotency-key': 'fresh-1' } });
        const res = makeRes();
        const next = jest.fn();

        await mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);

        // Simulate handler producing a 201 success response
        res.status(201).json({ success: true, id: 99 });

        // The wrapped json() fires the INSERT asynchronously; let it settle.
        await new Promise(r => setImmediate(r));

        expect(fakePool.query).toHaveBeenCalledTimes(2);
        const insertCall = fakePool.query.mock.calls[1];
        expect(insertCall[0]).toMatch(/INSERT INTO idempotency_records/);
        const params = insertCall[1];
        // params: [keyHash, scope, userId, actorType, status, body, url, expiresAt]
        expect(params[1]).toBe('test.scope');
        expect(params[2]).toBe(7);
        expect(params[3]).toBe('user');
        expect(params[4]).toBe(201);
        expect(params[5]).toBe(JSON.stringify({ success: true, id: 99 }));
    });

    it('does NOT store 5xx error responses (so transient failures can retry)', async () => {
        const fakePool = {
            query: jest.fn().mockResolvedValueOnce([[]]),
        };
        setPool(fakePool);
        const mw = idempotent('test.scope');

        const req = makeReq({ headers: { 'idempotency-key': 'fresh-2' } });
        const res = makeRes();
        const next = jest.fn();

        await mw(req, res, next);
        res.status(500).json({ success: false, message: 'transient' });
        await new Promise(r => setImmediate(r));

        // Only the SELECT, no INSERT
        expect(fakePool.query).toHaveBeenCalledTimes(1);
    });

    it('different scopes with the same client key do NOT collide', async () => {
        const seen = new Set();
        const fakePool = {
            query: jest.fn(async (sql, params) => {
                if (sql.startsWith('SELECT')) {
                    seen.add(params[0]); // keyHash
                    return [[]];
                }
                return [{ insertId: 1 }];
            }),
        };
        setPool(fakePool);

        const mwA = idempotent('billing.estimate.create');
        const mwB = idempotent('painter.estimate.create');
        const k = { 'idempotency-key': 'shared-uuid' };

        await mwA(makeReq({ headers: k }), makeRes(), jest.fn());
        await mwB(makeReq({ headers: k }), makeRes(), jest.fn());

        expect(seen.size).toBe(2);
    });
});
