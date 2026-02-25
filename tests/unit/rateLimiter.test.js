/**
 * Unit tests for Rate Limiter middleware exports
 */
const { globalLimiter, authLimiter, otpLimiter } = require('../../middleware/rateLimiter');

describe('Rate Limiter', () => {
    it('should export globalLimiter as a function', () => {
        expect(typeof globalLimiter).toBe('function');
    });

    it('should export authLimiter as a function', () => {
        expect(typeof authLimiter).toBe('function');
    });

    it('should export otpLimiter as a function', () => {
        expect(typeof otpLimiter).toBe('function');
    });
});
