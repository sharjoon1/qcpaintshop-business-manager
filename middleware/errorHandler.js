/**
 * Comprehensive Error Handler Middleware
 * Logging to DB, categorization, severity assessment, validation, deduplication, and prevention
 */

let pool = null;
let errorAnalysisService = null;

function setPool(p) { pool = p; }
function setErrorAnalysisService(svc) { errorAnalysisService = svc; }

// ─── Error Severity Assessment ────────────────────────────────

function assessSeverity(error, req) {
    if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ER_CON_COUNT_ERROR') return 'critical';
    if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') return 'critical';
    if (error.message && error.message.includes('ECONNREFUSED')) return 'critical';

    const url = req?.originalUrl || '';
    if (url.includes('/auth') || url.includes('/payment') || url.includes('/zoho')) return 'high';
    if (error.statusCode >= 500 || error.status >= 500) return 'high';
    if (error.statusCode === 400 || error.statusCode === 404 || error.statusCode === 403) return 'low';

    return 'medium';
}

// ─── Error Type Classification ────────────────────────────────

function classifyError(error, req) {
    if (error.code && (error.code.startsWith('ER_') || error.code.startsWith('PROTOCOL_'))) return 'database';
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') return 'integration';

    const url = req?.originalUrl || '';
    if (url.includes('/auth') || error.message?.includes('token') || error.message?.includes('session')) return 'authentication';
    if (error.statusCode === 403 || error.message?.includes('permission')) return 'authorization';
    if (error.statusCode === 400 || error.name === 'ValidationError') return 'validation';

    return 'api';
}

// ─── Log Error to Database ────────────────────────────────────

async function logError(error, req, context = {}) {
    if (!pool) return null;

    try {
        // Sanitize request body
        let sanitizedBody = null;
        if (req?.body && Object.keys(req.body).length > 0) {
            const clone = { ...req.body };
            const sensitiveKeys = ['password', 'token', 'secret', 'api_key', 'otp', 'pin', 'new_password', 'current_password'];
            for (const key of sensitiveKeys) {
                if (clone[key]) clone[key] = '[REDACTED]';
            }
            sanitizedBody = JSON.stringify(clone);
        }

        const errorType = context.type || classifyError(error, req);
        const errorMessage = (error.message || 'Unknown error').substring(0, 2000);
        const requestUrl = (req?.originalUrl || context.url || '').substring(0, 500);

        // Parse stack trace for file/line info
        let filePath = null, lineNumber = null, functionName = null;
        if (errorAnalysisService) {
            const parsed = errorAnalysisService.parseStackTrace(error.stack);
            filePath = parsed.file_path;
            lineNumber = parsed.line_number;
            functionName = parsed.function_name;
        }

        // Compute error hash for deduplication
        let errorHash = null;
        if (errorAnalysisService) {
            errorHash = errorAnalysisService.computeErrorHash(errorMessage, errorType, requestUrl, filePath);

            // Try to deduplicate
            const dedupResult = await errorAnalysisService.deduplicateError({ error_hash: errorHash });
            if (dedupResult && dedupResult.deduplicated) {
                // Auto-create bug when chronic error crosses threshold (20 or 50 occurrences)
                if (dedupResult.newCount === 20 || dedupResult.newCount === 50) {
                    triggerAutoBugCreation(dedupResult.existingId);
                }
                return dedupResult.existingId;
            }
        }

        const severity = context.severity || assessSeverity(error, req);

        const [result] = await pool.query(`
            INSERT INTO error_logs
            (error_type, error_code, error_message, stack_trace, request_url, request_method,
             request_body, user_id, session_id, ip_address, user_agent, severity,
             error_hash, file_path, line_number, function_name, branch_id, last_occurrence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            errorType,
            error.code || String(error.statusCode || '') || null,
            errorMessage,
            (error.stack || '').substring(0, 5000),
            requestUrl,
            req?.method || context.method || null,
            sanitizedBody,
            req?.user?.id || context.userId || null,
            req?.headers?.['x-session-id'] || null,
            req?.ip || req?.connection?.remoteAddress || null,
            (req?.headers?.['user-agent'] || '').substring(0, 500),
            severity,
            errorHash,
            filePath,
            lineNumber,
            functionName,
            req?.user?.branch_id || null,
            null // last_occurrence set by NOW() above
        ]);

        const errorId = result.insertId;

        // Auto-create bug report for critical/high severity errors
        if (errorId && errorAnalysisService && (severity === 'critical' || severity === 'high')) {
            triggerAutoBugCreation(errorId);
        }

        return errorId;
    } catch (logErr) {
        // Never let error logging break the app
        console.error('[ErrorHandler] Failed to log to DB:', logErr.message);
        return null;
    }
}

// ─── Auto Bug Creation (fire-and-forget) ─────────────────────

function triggerAutoBugCreation(errorId) {
    // Run async — never block error logging
    setImmediate(async () => {
        try {
            // Check if bug tracking is enabled
            const [configRows] = await pool.query(
                "SELECT config_key, config_value FROM ai_config WHERE config_key IN ('bug_tracking_enabled', 'auto_fix_suggestions')"
            );
            const config = {};
            for (const row of configRows) config[row.config_key] = row.config_value;

            if (config.bug_tracking_enabled !== '1' && config.bug_tracking_enabled !== 'true') return;

            const bugId = await errorAnalysisService.autoCreateBugFromError(errorId);
            if (bugId) {
                console.log(`[ErrorHandler] Auto-created bug #${bugId} from error #${errorId}`);
                // Also trigger AI fix suggestion if enabled
                if (config.auto_fix_suggestions === '1' || config.auto_fix_suggestions === 'true') {
                    errorAnalysisService.generateFixSuggestion(errorId).then(suggestions => {
                        if (suggestions && suggestions.length > 0) {
                            console.log(`[ErrorHandler] Generated ${suggestions.length} AI fix suggestion(s) for error #${errorId}`);
                        }
                    }).catch(() => {}); // silent fail for AI suggestions
                }
            }
        } catch (err) {
            console.error('[ErrorHandler] Auto bug creation failed:', err.message);
        }
    });
}

// ─── Async Route Wrapper ──────────────────────────────────────
// Backward-compatible alias: asyncHandler = asyncWrapper

function asyncWrapper(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// ─── Request Validation Middleware ─────────────────────────────

function validateRequest(schema) {
    return (req, res, next) => {
        const errors = [];

        if (schema.body) {
            for (const [field, rules] of Object.entries(schema.body)) {
                const value = req.body?.[field];

                if (rules.required && (value === undefined || value === null || value === '')) {
                    errors.push({ field, message: `${field} is required` });
                    continue;
                }

                if (value !== undefined && value !== null && value !== '') {
                    if (rules.type === 'number' && isNaN(Number(value))) {
                        errors.push({ field, message: `${field} must be a number` });
                    }
                    if (rules.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                        errors.push({ field, message: `${field} must be a valid email` });
                    }
                    if (rules.minLength && String(value).length < rules.minLength) {
                        errors.push({ field, message: `${field} must be at least ${rules.minLength} characters` });
                    }
                    if (rules.maxLength && String(value).length > rules.maxLength) {
                        errors.push({ field, message: `${field} must be at most ${rules.maxLength} characters` });
                    }
                    if (rules.enum && !rules.enum.includes(value)) {
                        errors.push({ field, message: `${field} must be one of: ${rules.enum.join(', ')}` });
                    }
                    if (rules.pattern && !rules.pattern.test(String(value))) {
                        errors.push({ field, message: `${field} has invalid format` });
                    }
                }
            }
        }

        if (schema.params) {
            for (const [field, rules] of Object.entries(schema.params)) {
                const value = req.params?.[field];
                if (rules.required && !value) {
                    errors.push({ field: `params.${field}`, message: `${field} parameter is required` });
                }
                if (rules.type === 'number' && value && isNaN(Number(value))) {
                    errors.push({ field: `params.${field}`, message: `${field} must be a number` });
                }
            }
        }

        if (errors.length > 0) {
            logError(new Error(`Validation failed: ${errors.map(e => e.message).join(', ')}`), req, {
                type: 'validation', severity: 'low'
            }).catch(() => {});

            return res.status(400).json({ success: false, message: 'Validation failed', errors });
        }

        next();
    };
}

// ─── Global Error Handler Middleware ──────────────────────────

function globalErrorHandler(err, req, res, _next) {
    console.error(`[${new Date().toISOString()}] Error in ${req.method} ${req.originalUrl}:`, err.message);

    // Log to database asynchronously
    logError(err, req).catch(() => {});

    // Determine HTTP status from known error types
    let statusCode = err.statusCode || err.status || 500;
    let message = err.message || 'Internal Server Error';

    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = Object.values(err.errors || {}).map(e => e.message).join(', ') || message;
    }
    if (err.name === 'CastError') { statusCode = 400; message = 'Invalid ID format'; }
    if (err.code === 'ER_DUP_ENTRY') { statusCode = 409; message = 'Duplicate entry - record already exists'; }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') { statusCode = 400; message = 'Referenced record does not exist'; }
    if (err.code === 'ECONNREFUSED') { statusCode = 503; message = 'Service temporarily unavailable'; }
    if (err.code === 'ER_ACCESS_DENIED_ERROR') { statusCode = 503; message = 'Database access denied'; }
    if (err.name === 'JsonWebTokenError') { statusCode = 401; message = 'Invalid token'; }
    if (err.name === 'TokenExpiredError') { statusCode = 401; message = 'Token expired'; }

    const isProduction = process.env.NODE_ENV === 'production';
    res.status(statusCode).json({
        success: false,
        message: (isProduction && statusCode >= 500) ? 'Internal server error' : message,
        code: err.code || 'ERROR',
        ...(isProduction ? {} : { stack: err.stack })
    });
}

// ─── 404 Handler ──────────────────────────────────────────────

function notFound(req, res, next) {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.statusCode = 404;
    next(error);
}

// ─── Client Error Logging Endpoint Handler ────────────────────

async function logClientError(req, res) {
    try {
        const { error_message, stack_trace, url, severity } = req.body;
        if (!error_message) {
            return res.status(400).json({ success: false, message: 'error_message is required' });
        }

        await logError(
            { message: error_message, stack: stack_trace || '' },
            req,
            { type: 'frontend', severity: severity || 'medium', url: url || req.headers?.referer }
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to log error' });
    }
}

module.exports = {
    setPool,
    setErrorAnalysisService,
    logError,
    globalErrorHandler,
    asyncWrapper,
    asyncHandler: asyncWrapper, // backward compat alias
    errorHandler: globalErrorHandler, // backward compat alias
    validateRequest,
    logClientError,
    classifyError,
    assessSeverity,
    notFound
};
