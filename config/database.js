/**
 * Database Configuration
 * Creates and exports the MySQL connection pool
 */

const mysql = require('mysql2/promise');

function createPool() {
    return mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0
    });
}

module.exports = { createPool };
