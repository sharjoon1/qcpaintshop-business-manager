/**
 * API Rate Limiting Middleware
 * Uses express-rate-limit for per-IP / per-key throttling
 */

const rateLimit = require('express-rate-limit');

// ─── Shared Handler ──────────────────────────────────────────

function rateLimitHandler(req, res) {
    res.status(429).json({
        success: false,
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please try again later.'
        }
    });
}

// ─── Global API Limiter (100 req/min per IP) ─────────────────

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    validate: { xForwardedForHeader: false }
});

// ─── Auth Limiter (10 req/min per IP) ────────────────────────

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    validate: { xForwardedForHeader: false }
});

// ─── OTP Limiter (5 req/min per phone or IP) ─────────────────

const otpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use phone number as key if available, otherwise fall back to default IP-based key
        if (req.body?.phone) return String(req.body.phone);
        // Return undefined to let express-rate-limit use its default IP key generator
        return undefined;
    },
    handler: rateLimitHandler,
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false }
});

module.exports = { globalLimiter, authLimiter, otpLimiter };
