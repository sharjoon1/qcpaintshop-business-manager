/**
 * Database Health Check Utility
 * Monitors database connectivity
 */

let lastHealthCheck = null;
let isHealthy = false;

/**
 * Check database health
 */
async function checkDatabaseHealth(pool) {
    try {
        const [result] = await pool.query('SELECT 1 as health');
        isHealthy = result.length > 0;
        lastHealthCheck = new Date();
        return isHealthy;
    } catch (error) {
        console.error('❌ Database health check failed:', error.message);
        isHealthy = false;
        lastHealthCheck = new Date();
        return false;
    }
}

/**
 * Start periodic health checks
 */
function startHealthChecks(pool, intervalMs = 60000) {
    // Initial check
    checkDatabaseHealth(pool);
    
    // Periodic checks
    setInterval(() => {
        checkDatabaseHealth(pool);
    }, intervalMs);
    
    console.log(`✅ Database health checks started (every ${intervalMs/1000}s)`);
}

/**
 * Get current health status
 */
function getHealthStatus() {
    return {
        healthy: isHealthy,
        lastCheck: lastHealthCheck,
        uptime: process.uptime()
    };
}

module.exports = {
    checkDatabaseHealth,
    startHealthChecks,
    getHealthStatus
};
