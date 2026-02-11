# 🛡️ ENDPOINT FAILURE PREVENTION CHECKLIST

## ✅ Before Deploying Any Changes

### 1. Code Quality Checks
- [ ] Run `npm test` (if tests exist)
- [ ] Check for typos in function names (like `toLocaleLString`)
- [ ] Verify all `require()` statements have correct paths
- [ ] Check for missing commas, brackets, parentheses
- [ ] Run ESLint or code formatter

### 2. Database Changes
- [ ] Test queries in MySQL console first
- [ ] Verify table/column names exist
- [ ] Check for proper escaping of special characters
- [ ] Ensure foreign key constraints are valid
- [ ] Backup database before schema changes

### 3. API Endpoint Changes
- [ ] Test endpoint with curl or Postman before deploying
- [ ] Verify authentication middleware is applied correctly
- [ ] Check that required parameters are validated
- [ ] Test both success and error cases
- [ ] Document any new query parameters or body fields

### 4. Frontend Changes
- [ ] Verify all API endpoints called still exist
- [ ] Check that correct HTTP methods are used (GET/POST/PUT/DELETE)
- [ ] Ensure authentication headers are sent
- [ ] Test loading states and error messages
- [ ] Check browser console for JavaScript errors

### 5. Server Restart Procedure
```bash
# 1. Test configuration
pm2 describe business-manager

# 2. Watch logs in separate terminal
pm2 logs business-manager --lines 50

# 3. Restart
pm2 restart business-manager

# 4. Verify no errors in first 10 seconds
pm2 logs business-manager --lines 20 --nostream | grep -i error

# 5. Test critical endpoints
node test-all-endpoints.js
```

### 6. Post-Deploy Verification
- [ ] Open browser console and check for errors
- [ ] Test login/logout flow
- [ ] Navigate to main dashboard - verify data loads
- [ ] Click hamburger menu - verify it opens
- [ ] Test 2-3 critical actions (create estimate, view products, etc.)
- [ ] Check PM2 logs for any new errors

---

## 🚨 Common Causes of Endpoint Failures

### 1. Typos in Code
**Example:** `toLocaleLString` instead of `toLocaleString`
**Prevention:** Use IDE with autocomplete, enable spell checking

### 2. Missing Authentication
**Example:** Endpoint requires token but frontend doesn't send it
**Prevention:** Always include `getAuthHeaders()` in fetch calls

### 3. Database Connection Issues
**Example:** Connection pool exhausted, timeout
**Prevention:** Use connection pooling, set proper limits, monitor connections

### 4. Incorrect Table/Column Names
**Example:** Query references `user_name` but column is `username`
**Prevention:** Check schema before writing queries, use migrations

### 5. Unhandled Promise Rejections
**Example:** `async` function throws error but no `.catch()`
**Prevention:** Use try-catch blocks, implement error middleware

### 6. CORS Issues
**Example:** Frontend on different domain can't access API
**Prevention:** Configure CORS properly in server.js

---

## 📊 Monitoring & Alerts

### Health Check Endpoint
```bash
curl http://localhost:3001/api/test
# Should return: {"status":"Database connected","result":{"test":1}}
```

### Log Monitoring
```bash
# Watch for errors in real-time
pm2 logs business-manager | grep -i error

# Count errors in last 100 lines
pm2 logs business-manager --lines 100 --nostream | grep -i error | wc -l
```

### Database Connection Test
```bash
cd /www/wwwroot/act.qcpaintshop.com/business-manager
node -e "require('dotenv').config(); const mysql = require('mysql2/promise'); mysql.createPool({host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME}).query('SELECT 1').then(() => console.log('✅ DB OK')).catch(e => console.log('❌ DB Error:', e.message));"
```

---

## 🔧 Quick Fixes for Common Issues

### Issue: "Authentication required" on every endpoint
**Fix:** Check that localStorage has `auth_token`, verify token hasn't expired

### Issue: 500 Internal Server Error
**Fix:** Check PM2 logs for stack trace, fix the underlying error

### Issue: Endpoint returns 404
**Fix:** Verify route exists in server.js, check URL spelling

### Issue: Database connection lost
**Fix:** Restart MySQL service, check .env credentials, verify firewall rules

### Issue: Slow response times (>2s)
**Fix:** Add database indexes, optimize queries, check connection pool settings

---

## 📝 Staging Environment Recommendation

### Ideal Setup:
1. **Production:** act.qcpaintshop.com
2. **Staging:** staging.qcpaintshop.com (copy of production)
3. **Development:** localhost:3001

### Benefits:
- Test all changes on staging before production
- Catch breaking changes early
- Roll back easily if issues found
- No downtime for testing

### Quick Staging Setup:
```bash
# 1. Clone production database
mysqldump business_manager > staging_backup.sql
mysql business_manager_staging < staging_backup.sql

# 2. Copy application files
cp -r /www/wwwroot/act.qcpaintshop.com/business-manager /www/wwwroot/staging.qcpaintshop.com/business-manager

# 3. Update .env with staging database
# 4. Run on different port (3002)
# 5. Test changes on staging first!
```

---

## ✅ Success Criteria

An endpoint deployment is successful when:
1. All automated tests pass (if available)
2. Manual testing shows no errors
3. PM2 logs clean for 5 minutes after restart
4. Health check endpoint returns 200 OK
5. Frontend console shows no errors
6. Critical user flows work end-to-end

---

**Last Updated:** 2026-02-08  
**Maintainer:** Business Manager Development Team
