// Create Admin User with proper password hash
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function createAdminUser() {
    // Generate bcrypt hash for password "admin123"
    const password = 'admin123';
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    console.log('Generated password hash:', passwordHash);
    
    // Connect to database
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    
    try {
        // Insert or update admin user
        const [result] = await connection.execute(`
            INSERT INTO users (username, email, password_hash, full_name, phone, role, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                password_hash = VALUES(password_hash),
                role = VALUES(role),
                status = VALUES(status)
        `, [
            'sharjoon',
            'sharjoon@qcpaintshop.com',
            passwordHash,
            'Sharjoon',
            '+917418831122',
            'admin',
            'active'
        ]);
        
        console.log('✅ Admin user created/updated successfully!');
        console.log('Username: sharjoon');
        console.log('Password: admin123');
        console.log('⚠️  IMPORTANT: Change password after first login!');
        
        // Verify user was created
        const [users] = await connection.execute(
            'SELECT id, username, email, role, status, created_at FROM users WHERE username = ?',
            ['sharjoon']
        );
        
        console.log('\nAdmin user details:', users[0]);
        
    } catch (error) {
        console.error('❌ Error creating admin user:', error.message);
    } finally {
        await connection.end();
    }
}

createAdminUser();
