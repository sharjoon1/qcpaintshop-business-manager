/**
 * Database Configuration
 * Creates and exports the MySQL connection pool
 */

const mysql = require('mysql2/promise');

function createPool() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0,
        // mysql2 uses this to parse/serialize JS Date ↔ MySQL date strings correctly.
        // Must match what MySQL actually stores (UTC after the session SET below).
        timezone: '+00:00',
    });

    // /etc/localtime is Asia/Kolkata, so MySQL SYSTEM timezone = IST.
    // mysql2's `timezone` option only affects JS Date serialization, NOT MySQL's NOW().
    // Without this, NOW() returns IST and all DATETIME inserts are 5h30m off.
    pool.on('connection', (connection) => {
        connection.query("SET SESSION time_zone = '+00:00'", (err) => {
            if (err) console.error('[DB] Failed to set session time_zone:', err.message);
        });
    });

    return pool;
}

module.exports = { createPool };
