/**
 * Zod Validation Middleware
 * Validates request body, query params, and URL params against Zod schemas.
 */

const { z } = require('zod');

// ─── Helper: Format Zod errors into field-level details ──────

function formatZodErrors(zodError) {
    return zodError.errors.map(err => ({
        field: err.path.join('.') || '_root',
        message: err.message
    }));
}

// ─── Helper: Send validation error response ──────────────────

function sendValidationError(res, details) {
    return res.status(400).json({
        success: false,
        error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details
        }
    });
}

// ─── Middleware: validate req.body ────────────────────────────

function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return sendValidationError(res, formatZodErrors(result.error));
        }
        req.body = result.data;
        next();
    };
}

// ─── Middleware: validate req.query ───────────────────────────

function validateQuery(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            return sendValidationError(res, formatZodErrors(result.error));
        }
        req.query = result.data;
        next();
    };
}

// ─── Middleware: validate req.params ──────────────────────────

function validateParams(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.params);
        if (!result.success) {
            return sendValidationError(res, formatZodErrors(result.error));
        }
        req.params = result.data;
        next();
    };
}

// ─── Common Reusable Schemas ─────────────────────────────────

const paginationSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(500).default(20)
});

const idParamSchema = z.object({
    id: z.coerce.number().int().positive({ message: 'id must be a positive integer' })
});

const dateRangeSchema = z.object({
    start_date: z.string().datetime({ offset: true }).optional()
        .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD or ISO 8601').optional()),
    end_date: z.string().datetime({ offset: true }).optional()
        .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD or ISO 8601').optional())
});

const branchFilterSchema = z.object({
    branch_id: z.coerce.number().int().positive().optional()
});

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
    validate,
    validateQuery,
    validateParams,
    paginationSchema,
    idParamSchema,
    dateRangeSchema,
    branchFilterSchema
};
