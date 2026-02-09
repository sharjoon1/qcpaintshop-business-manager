/**
 * Request Logger Middleware
 * Logs all incoming requests for debugging
 */

const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    // Log when response finishes
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 400 ? 'ERROR' : 'INFO';
        
        console.log(`[${logLevel}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        
        // Log slow requests (>2 seconds)
        if (duration > 2000) {
            console.warn(`⚠️  SLOW REQUEST: ${req.method} ${req.path} took ${duration}ms`);
        }
    });
    
    next();
};

module.exports = requestLogger;
