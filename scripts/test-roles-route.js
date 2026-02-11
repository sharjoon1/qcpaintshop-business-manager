// Test script to verify roles route loading
require('dotenv').config();

try {
  console.log('Testing roles route loading...');
  const rolesRouter = require('./routes/roles');
  console.log('✅ Roles router loaded successfully');
  console.log('Router type:', typeof rolesRouter);
  console.log('Is function:', typeof rolesRouter === 'function');
} catch (error) {
  console.error('❌ Error loading roles router:', error.message);
  console.error('Stack:', error.stack);
}
