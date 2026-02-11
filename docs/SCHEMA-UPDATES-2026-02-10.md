# Database Schema Updates - February 10, 2026

## Summary
This document details all database schema changes made to fix critical attendance system bugs.

---

## ✅ Critical Fixes Applied

### 1. **shop_hours_config Table - Day Matching Bug**

**Problem:** The `day_of_week` column was using `ENUM('monday','tuesday',...)` which caused SQL comparison failures when matching against `DAYOFWEEK(date)`.

**Fix Applied:**
```sql
-- BEFORE (WRONG):
day_of_week ENUM('monday','tuesday','wednesday','thursday','friday','saturday','sunday')

-- AFTER (CORRECT):
day_of_week TINYINT NOT NULL COMMENT '0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday'
```

**Why This Matters:**
- Backend attendance queries use: `WHERE shc.day_of_week = DAYOFWEEK(a.date) - 1`
- ENUM comparison with number always fails → clock-out/break features fail
- TINYINT comparison works correctly → all features work

**Affected Queries:**
- Clock-out endpoint (`routes/attendance.js` line 368)
- Get today's attendance (`routes/attendance.js` line 484)
- Break-end endpoint (`routes/attendance.js` line 646)

---

### 2. **staff_attendance Table - Missing Columns**

**Problem:** 5 required columns were missing, causing UPDATE queries to fail.

**Columns Added:**
```sql
-- Break tracking
break_start_time DATETIME NULL,
break_end_time DATETIME NULL,
break_duration_minutes INT DEFAULT 0,

-- Working time calculation
total_working_minutes INT DEFAULT 0,

-- Early checkout tracking
is_early_checkout BOOLEAN DEFAULT 0
```

**Impact:**
- Without these: Clock-out fails with "Unknown column" error
- With these: Full attendance tracking works (clock-in, break, clock-out)

---

### 3. **branches Table - Standardized Structure**

**Changes:**
```sql
-- Updated columns:
code VARCHAR(50) UNIQUE,              -- was VARCHAR(20)
geo_fence_radius INT DEFAULT 500,     -- was geo_fence_radius_meters
opening_time TIME,                    -- was open_time
closing_time TIME,                    -- was close_time
is_active BOOLEAN,                    -- was status ENUM('active','inactive')
manager_id INT NULL,                  -- was manager_user_id

-- Added columns:
country VARCHAR(100) DEFAULT 'India',
```

---

### 4. **settings Table - Complete Configuration**

**Added Settings:**
```sql
-- Business settings
business_type, business_logo

-- Tax settings
gst_number, pan_number, enable_gst, cgst_rate, sgst_rate, igst_rate

-- Estimate settings
estimate_prefix, estimate_validity, estimate_terms, show_brand_logo

-- Added description column for all settings
description TEXT
```

---

## 📊 Migration Scripts Created

All fixes were applied through these scripts:

1. **fix-attendance-tables.js**
   - Created: staff_attendance, attendance_photos, attendance_permissions, shop_hours_config
   - Status: ✅ Successfully executed

2. **fix-branches-table.js**
   - Created: branches table with default branch
   - Created: default shop hours (Mon-Sat: 9 AM - 6 PM)
   - Updated: users.branch_id to link to default branch
   - Status: ✅ Successfully executed

3. **fix-attendance-columns.js**
   - Added: 5 missing columns to staff_attendance
   - Status: ✅ Successfully executed

4. **create-settings-table.js**
   - Created: settings table with 16 default settings
   - Status: ✅ Successfully executed

---

## 🔧 Backend Code Fixes

### routes/attendance.js - SQL Query Fixes

**3 occurrences fixed:**

```javascript
// BEFORE (BROKEN):
JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
  AND shc.day_of_week = LOWER(DAYNAME(a.date))

// AFTER (FIXED):
JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
  AND shc.day_of_week = DAYOFWEEK(a.date) - 1
```

**Locations:**
- Line 368: Clock-out endpoint
- Line 484: Get today's attendance
- Line 646: Break-end endpoint

### Enhanced Error Logging

Added detailed error logging to both clock-in and clock-out endpoints:
```javascript
console.error('❌ Clock in/out error:', error);
console.error('Error details:', {
    message: error.message,
    code: error.code,
    errno: error.errno,
    sqlMessage: error.sqlMessage
});

res.status(500).json({
    success: false,
    message: error.sqlMessage || error.message,
    error_code: error.code,
    error_type: error.name
});
```

---

## 🗂️ Updated Schema File

**File:** `database-complete-schema.sql`

**Key Updates:**
1. ✅ shop_hours_config uses TINYINT day_of_week
2. ✅ staff_attendance has all required columns
3. ✅ branches table matches implementation
4. ✅ settings table has complete defaults
5. ✅ Includes detailed comments explaining critical design choices

**Date Updated:** 2026-02-10

---

## ✨ Features Now Working

After all fixes:

1. ✅ **Clock-In**
   - Photo capture with GPS
   - Geo-fence validation (disabled for testing)
   - Late arrival detection
   - Auto-creates permission request if late

2. ✅ **Break Management**
   - Start/end break tracking
   - Duration calculation
   - Break time excluded from working hours

3. ✅ **Clock-Out**
   - Photo capture with GPS
   - Working hours calculation
   - Early checkout detection
   - Shortage calculation vs expected hours

4. ✅ **Dashboard**
   - Real-time work timer
   - Break button prominently displayed
   - Clock-out hidden to prevent accidents
   - Status tracking

---

## 🔐 Security Enhancements

**Clock-Out Protection:**
- Hidden by default (requires "Show Clock Out" click)
- Confirmation dialog with checklist
- 3 intentional actions required to clock out

---

## 📝 Notes for Future Developers

### Critical Schema Rules

1. **NEVER change shop_hours_config.day_of_week to ENUM**
   - Must remain TINYINT (0-6)
   - Required for DAYOFWEEK() - 1 matching
   - Changing this will break ALL attendance features

2. **Day of Week Mapping:**
   ```
   0 = Sunday
   1 = Monday
   2 = Tuesday
   3 = Wednesday
   4 = Thursday
   5 = Friday
   6 = Saturday
   ```

3. **MySQL DAYOFWEEK() Returns:**
   ```
   1 = Sunday
   2 = Monday
   ...
   7 = Saturday
   ```
   Hence the conversion: `DAYOFWEEK(date) - 1`

---

## 🧪 Testing Completed

- ✅ Clock-in with photo and GPS
- ✅ Clock-out with working hours calculation
- ✅ Break start/end functionality
- ✅ Database table structure verification
- ✅ All SQL queries return correct results
- ✅ Shop hours matching on all weekdays

---

## 📞 Support

If you encounter any issues after these updates:

1. Check server logs for detailed error messages
2. Verify database migrations completed successfully
3. Run `node check-attendance-columns.js` to verify table structure
4. Check that server was restarted after schema changes

---

**Last Updated:** February 10, 2026
**Status:** All fixes verified and working ✅
