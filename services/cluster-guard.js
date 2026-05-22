/**
 * Cluster primary detection.
 *
 * When run under PM2 (or any process manager that sets NODE_APP_INSTANCE
 * per worker), only the first worker — instance "0" — should register
 * background schedulers. Otherwise N workers each fire every cron tick,
 * which doubles FCM pushes, doubles WhatsApp sends, and double-awards
 * painter points.
 *
 * Today the app runs as a single Node process (NODE_APP_INSTANCE is
 * undefined), so this returns true. The check is defensive: the day
 * someone switches the start command to `pm2 start ecosystem.json --instances N`
 * the schedulers do not silently triple-fire.
 *
 * Returns true if the current process should run background work.
 */
function isClusterPrimary() {
    const instance = process.env.NODE_APP_INSTANCE;
    return instance === undefined || instance === '' || instance === '0';
}

module.exports = { isClusterPrimary };
