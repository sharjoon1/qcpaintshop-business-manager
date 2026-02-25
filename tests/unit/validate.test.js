/**
 * Unit tests for Zod validation middleware
 */
const { z } = require('zod');
const { validate, validateQuery, paginationSchema, idParamSchema, dateRangeSchema } = require('../../middleware/validate');

describe('Validation Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = { body: {}, query: {}, params: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    describe('validate()', () => {
        it('should call next() for valid body', () => {
            const schema = z.object({ name: z.string() });
            req.body = { name: 'Test' };
            validate(schema)(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should return 400 for invalid body', () => {
            const schema = z.object({ name: z.string() });
            req.body = { name: 123 };
            validate(schema)(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({
                        code: 'VALIDATION_ERROR'
                    })
                })
            );
        });

        it('should return 400 for missing required fields', () => {
            const schema = z.object({ name: z.string(), age: z.number() });
            req.body = {};
            validate(schema)(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            const errorResponse = res.json.mock.calls[0][0];
            expect(errorResponse.error.details.length).toBeGreaterThanOrEqual(2);
        });

        it('should coerce and set parsed data on req.body', () => {
            const schema = z.object({ count: z.coerce.number() });
            req.body = { count: '5' };
            validate(schema)(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(req.body.count).toBe(5);
        });
    });

    describe('validateQuery()', () => {
        it('should validate query params', () => {
            const schema = z.object({ page: z.string().optional() });
            req.query = { page: '1' };
            validateQuery(schema)(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should return 400 for invalid query', () => {
            const schema = z.object({ page: z.coerce.number().positive() });
            req.query = { page: '-1' };
            validateQuery(schema)(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('Common Schemas', () => {
        it('paginationSchema should coerce and accept valid pagination', () => {
            const result = paginationSchema.safeParse({ page: '1', limit: '25' });
            expect(result.success).toBe(true);
            expect(result.data.page).toBe(1);
            expect(result.data.limit).toBe(25);
        });

        it('paginationSchema should use defaults for empty object', () => {
            const result = paginationSchema.safeParse({});
            expect(result.success).toBe(true);
            expect(result.data.page).toBe(1);
            expect(result.data.limit).toBe(20);
        });

        it('idParamSchema should accept numeric string id', () => {
            const result = idParamSchema.safeParse({ id: '123' });
            expect(result.success).toBe(true);
            expect(result.data.id).toBe(123);
        });

        it('idParamSchema should reject non-positive id', () => {
            const result = idParamSchema.safeParse({ id: '0' });
            expect(result.success).toBe(false);
        });

        it('dateRangeSchema should accept YYYY-MM-DD dates', () => {
            const result = dateRangeSchema.safeParse({ start_date: '2026-01-01', end_date: '2026-01-31' });
            expect(result.success).toBe(true);
        });

        it('dateRangeSchema should accept empty object', () => {
            const result = dateRangeSchema.safeParse({});
            expect(result.success).toBe(true);
        });
    });
});
