# Database Schema Documentation

## 📂 Schema Files

### 1. **database-working-schema.sql** ⭐ USE THIS
**Current Status:** ✅ Matches your actual database
**Tables:** 17 working tables
**Purpose:** Ready-to-use schema for fresh installations

**Use this file when:**
- Setting up a new installation
- Recreating the database
- Understanding current database structure

**Includes:**
```
✅ Users & Authentication (users, user_sessions)
✅ Business Setup (branches, settings)
✅ Products (brands, categories, products)
✅ Customers (customers)
✅ Estimates (estimates, estimate_items, estimate_settings, estimate_status_history)
✅ Attendance (shop_hours_config, staff_attendance, attendance_photos, attendance_permissions)
✅ Audit (audit_log)
```

---

### 2. **database-complete-schema.sql** 📋 PLANNED FEATURES
**Current Status:** ⏳ Future roadmap
**Tables:** 28 planned tables
**Purpose:** Complete system with all planned features

**Additional tables planned:**
```
⏳ Roles & Permissions (roles, permissions, role_permissions)
⏳ OTP Verification (otp_verifications)
⏳ Customer Types (customer_types)
⏳ Leads (leads, lead_followups)
⏳ Pack Sizes (pack_sizes)
⏳ Estimate Requests (estimate_requests + 3 related tables)
⏳ Staff Activities (staff_activities)
⏳ Task Management (staff_tasks, task_updates)
⏳ Salary Management (4 tables)
⏳ Leave Balance (staff_leave_balance)
```

---

## 🗄️ Current Database Structure (17 Tables)

### Authentication & Users (2 tables)
| Table | Records | Purpose |
|-------|---------|---------|
| **users** | 1 | Staff/admin user accounts |
| **user_sessions** | 6 | Active login sessions |

### Business Configuration (2 tables)
| Table | Records | Purpose |
|-------|---------|---------|
| **branches** | 1 | Branch/store locations |
| **settings** | 16 | System configuration |

### Product Catalog (3 tables)
| Table | Records | Purpose |
|-------|---------|---------|
| **brands** | 3 | Paint brands (Asian Paints, etc.) |
| **categories** | 2 | Product categories |
| **products** | 5 | Paint products |

### Customer Management (1 table)
| Table | Records | Purpose |
|-------|---------|---------|
| **customers** | 5 | Customer database |

### Estimates & Quotations (4 tables)
| Table | Records | Purpose |
|-------|---------|---------|
| **estimates** | 3 | Price quotations |
| **estimate_items** | 5 | Line items in estimates |
| **estimate_settings** | 0 | Estimate configuration |
| **estimate_status_history** | 0 | Status change tracking |

### Staff Attendance (4 tables)
| Table | Records | Purpose |
|-------|---------|---------|
| **shop_hours_config** | 7 | Working hours per day |
| **staff_attendance** | 1 | Daily clock-in/out records |
| **attendance_photos** | 2 | Selfie verification |
| **attendance_permissions** | 1 | Late arrival/early leave requests |

### System (1 table)
| Table | Records | Purpose |
|-------|---------|---------|
| **audit_log** | 0 | Activity tracking |

---

## 🔧 Critical Schema Notes

### ⚠️ IMPORTANT: shop_hours_config

**MUST use TINYINT for day_of_week:**
```sql
day_of_week TINYINT NOT NULL COMMENT '0=Sunday, 1=Monday, ..., 6=Saturday'
```

**❌ NEVER use ENUM:**
```sql
-- WRONG - This breaks attendance features!
day_of_week ENUM('monday','tuesday',...)
```

**Why:** Backend queries use `DAYOFWEEK(date) - 1` which requires numeric comparison.

---

## 📊 Database Statistics

```
Total Tables: 17
Total Records: ~50
Database Size: ~272 KB (data) + ~784 KB (indexes)
Engine: InnoDB
Charset: utf8mb4_unicode_ci
```

---

## 🚀 Setup Instructions

### Fresh Installation

1. **Create database:**
   ```sql
   CREATE DATABASE qc_business_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. **Run working schema:**
   ```bash
   mysql -u qc_admin -p qc_business_manager < database-working-schema.sql
   ```

3. **Verify installation:**
   ```bash
   node check-all-tables.js
   ```

### Existing Database - Add Missing Tables

If you have an existing database with some tables missing:

1. **Check current state:**
   ```bash
   node check-all-tables.js
   ```

2. **Add specific tables:**
   Use individual migration scripts:
   - `fix-attendance-tables.js` - Attendance system
   - `fix-branches-table.js` - Branches & shop hours
   - `fix-attendance-columns.js` - Missing columns
   - `create-settings-table.js` - Settings table

3. **Verify:**
   ```bash
   node check-attendance-columns.js
   ```

---

## 📝 Migration History

| Date | Script | Changes |
|------|--------|---------|
| 2026-02-10 | fix-attendance-tables.js | Created 4 attendance tables |
| 2026-02-10 | fix-branches-table.js | Created branches + shop_hours |
| 2026-02-10 | fix-attendance-columns.js | Added 5 missing columns |
| 2026-02-10 | create-settings-table.js | Created settings with 16 defaults |
| 2026-02-10 | routes/attendance.js | Fixed DAYOFWEEK SQL bug (3 places) |

---

## 🔐 Database Credentials

**Configuration file:** `.env`

```env
DB_HOST=localhost
DB_USER=qc_admin
DB_PASSWORD=QC@dm1n2026!Secure
DB_NAME=qc_business_manager
```

**Root access:**
```bash
mysql -u root -p
```

---

## 🧪 Testing & Verification

### Check All Tables
```bash
node check-all-tables.js
```

### Check Attendance Structure
```bash
node check-attendance-columns.js
```

### Verify Shop Hours
```bash
mysql -u qc_admin -p -e "SELECT * FROM qc_business_manager.shop_hours_config;"
```

### Check Settings
```bash
mysql -u qc_admin -p -e "SELECT setting_key, category FROM qc_business_manager.settings;"
```

---

## 📞 Troubleshooting

### "Table doesn't exist" errors

1. Run verification: `node check-all-tables.js`
2. Check which tables are missing
3. Run appropriate migration script
4. Restart server

### Attendance features not working

1. Verify shop_hours_config uses TINYINT:
   ```sql
   DESCRIBE shop_hours_config;
   ```
2. Check if day_of_week is TINYINT (not ENUM)
3. If ENUM, recreate table using fix-branches-table.js

### Clock-in/out fails

1. Check server logs for SQL errors
2. Verify all attendance columns exist: `node check-attendance-columns.js`
3. Check routes/attendance.js uses `DAYOFWEEK(date) - 1`

---

## 📚 Related Documentation

- `SCHEMA-UPDATES-2026-02-10.md` - Detailed fix documentation
- `database-complete-schema.sql` - Future planned features
- `database-working-schema.sql` - Current working schema

---

**Last Updated:** February 10, 2026
**Database Version:** 1.0 (Working)
**Status:** ✅ All core features operational
