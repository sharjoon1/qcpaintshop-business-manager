# Project File Analysis
**Date:** 2026-02-10
**Total Files Analyzed:** ~100 files

---

## 🟢 CORE APPLICATION FILES (Keep - Essential)

### Server & Configuration (3 files)
```
✅ server.js                    - Main Express server
✅ package.json                 - Dependencies
✅ package-lock.json            - Dependency lock
```

### Middleware (3 files)
```
✅ middleware/errorHandler.js          - Error handling
✅ middleware/permissionMiddleware.js  - Authorization
✅ middleware/requestLogger.js         - Request logging
```

### Backend Routes (8 files)
```
✅ routes/attendance.js                - Clock-in/out, breaks
✅ routes/activities.js                - Daily activity tracking
✅ routes/branches.js                  - Branch management
✅ routes/estimate-requests.js         - Customer estimate requests
✅ routes/leads.js                     - Lead management
✅ routes/product-pricing-helpers.js   - Price calculations
✅ routes/roles.js                     - Role management
✅ routes/salary.js                    - Salary calculations
✅ routes/tasks.js                     - Task management
```

### Utilities (1 file)
```
✅ utils/dbHealthCheck.js              - Database health monitoring
```

### Frontend - Public Entry (2 files)
```
✅ index.html                          - Landing page
✅ public/index.html                   - Public entry point
```

### Frontend - Authentication (4 files)
```
✅ public/login.html                   - Login page
✅ public/register.html                - Registration
✅ public/forgot-password.html         - Password recovery
✅ public/customer-login.html          - Customer portal login
```

### Frontend - Admin Pages (20 files)
```
✅ public/admin-dashboard.html         - Admin dashboard
✅ public/admin-branches.html          - Branch management
✅ public/admin-brands.html            - Brand management
✅ public/admin-categories.html        - Category management
✅ public/admin-customers.html         - Customer management
✅ public/admin-customer-types.html    - Customer types
✅ public/admin-estimate-requests.html - Estimate requests
✅ public/admin-leads.html             - Lead management
✅ public/admin-products.html          - Product catalog
✅ public/admin-profile.html           - Admin profile
✅ public/admin-reports.html           - Reports
✅ public/admin-role-permissions.html  - Permission management
✅ public/admin-roles.html             - Role management
✅ public/admin-salary-config.html     - Salary configuration
✅ public/admin-salary-monthly.html    - Monthly salary
✅ public/admin-salary-payments.html   - Salary payments
✅ public/admin-salary-reports.html    - Salary reports
✅ public/admin-settings.html          - System settings
✅ public/admin-staff.html             - Staff management
✅ public/admin-tasks.html             - Task assignment
```

### Frontend - Estimates (8 files)
```
✅ public/estimates.html               - Estimate list
✅ public/estimates.js                 - Estimate logic
✅ public/estimate-create-new.html     - Create estimate
✅ public/estimate-edit.html           - Edit estimate
✅ public/estimate-view.html           - View estimate
✅ public/estimate-actions.html        - Estimate actions
✅ public/estimate-settings.html       - Estimate settings
✅ public/staff-estimates.html         - Staff estimate view
```

### Frontend - Staff Portal (7 files)
```
✅ public/staff/dashboard.html         - Staff dashboard
✅ public/staff/clock-in.html          - Clock in
✅ public/staff/clock-out.html         - Clock out
✅ public/staff/activities.html        - Activity logging
✅ public/staff/tasks.html             - Assigned tasks
✅ public/staff/history.html           - Attendance history
✅ public/staff/permission-request.html - Permission requests
```

### Frontend - Customer Portal (3 files)
```
✅ public/customer-dashboard.html      - Customer dashboard
✅ public/customer-requests.html       - Customer requests
✅ public/request-estimate.html        - Request estimate (current version)
```

### Frontend - Components (4 files)
```
✅ public/components/header-v2.html           - Universal header
✅ public/components/sidebar-complete.html    - Admin sidebar
✅ public/components/staff-sidebar.html       - Staff sidebar
✅ public/universal-nav-loader.js             - Navigation loader
```

### Frontend - Shared JavaScript (2 files)
```
✅ public/js/auth-helper.js            - Authentication helpers
✅ public/js/permissions.js            - Permission checks
```

### CSS/Design (1 file)
```
✅ public/css/design-system.css        - Design system styles
```

---

## 🟡 MIGRATION/SETUP SCRIPTS (Archive After Use)

### Database Setup (4 files)
```
⚠️ create-settings-table.js           - Creates settings table
⚠️ fix-attendance-tables.js           - Creates attendance tables
⚠️ fix-branches-table.js              - Creates branches table
⚠️ fix-attendance-columns.js          - Adds missing columns
```

### Database Schema Files (5 files)
```
📦 database-complete-schema.sql       - Full schema (future features)
📦 database-working-schema.sql        - Current working schema ⭐
📦 database-salary-module.sql         - Salary module schema
📦 database-updates-phase1.sql        - Old update script
📦 database-upgrade.sql               - Old upgrade script
📦 add-settings-table.sql             - SQL version of settings
📦 setup_database.sql                 - Old setup script
```

### Sample Data Scripts (2 files)
```
⚠️ create-admin-user.js               - Creates default admin
⚠️ create-sample-data.js              - Sample data for testing
⚠️ setup-database.js                  - Old setup script
⚠️ run-db-updates.js                  - Run database updates
```

---

## 🔵 DEVELOPMENT TOOLS (Keep for Debugging)

### Verification Scripts (3 files)
```
🔧 check-all-tables.js                - Verify all tables exist
🔧 check-attendance-columns.js        - Verify attendance structure
🔧 verify-attendance-setup.js         - Verify attendance setup
🔧 test-roles-route.js                - Test roles endpoint
```

---

## 📚 DOCUMENTATION FILES (Keep for Reference)

### Documentation (5 files)
```
📖 DATABASE-README.md                 - Database documentation ⭐
📖 SCHEMA-UPDATES-2026-02-10.md      - Update log
📖 ADMIN_DASHBOARD_FIX_PLAN.md       - Old fix plan
📖 ENDPOINT_PREVENTION_CHECKLIST.md  - Security checklist
📖 PROJECT-STATUS.md                 - Project status
📖 FILE-ANALYSIS.md                  - This file
```

---

## 🔴 BACKUP/OLD FILES (Can Delete)

### Duplicate/Backup Files (7 files)
```
❌ public/admin-estimate-requests-backup.html  - Backup (delete)
❌ public/request-estimate-old.html            - Old version (delete)
❌ public/request-estimate-v2.html             - Old version (delete)
❌ public/universal-nav-loader-backup.js       - Backup (delete)
❌ public/universal-nav-loader-v3.js           - Old version (delete)
❌ register.html                               - Duplicate (use public/register.html)
❌ public/dashboard.html                       - Duplicate? (check if used)
❌ public/staff-requests.html                  - Unused? (verify)
❌ public/test-logo.html                       - Test file (delete)
❌ public/header-loader.js                     - Old version (delete)
❌ public/app.js                               - Unused? (verify)
```

### Unused Components (2 files)
```
❌ public/components/dashboard-quick-actions.html  - Unused? (verify)
❌ public/components/staff-quick-actions.html      - Unused? (verify)
❌ public/components/logo-loader.js                - Old? (verify)
```

---

## 📊 SUMMARY

| Category | Count | Status |
|----------|-------|--------|
| **Core Application Files** | 63 | ✅ Keep - Essential |
| **Migration Scripts** | 11 | ⚠️ Archive after setup |
| **Development Tools** | 4 | 🔧 Keep for debugging |
| **Documentation** | 6 | 📖 Keep for reference |
| **Backup/Old Files** | 13 | ❌ Can delete |
| **Total Files** | ~97 | |

---

## 🎯 RECOMMENDED ACTIONS

### 1. Keep These (63 core + 10 tools/docs = 73 files)
```
✅ All server files (server.js, routes/, middleware/, utils/)
✅ All public/*.html admin pages
✅ All public/staff/*.html pages
✅ All public/components/ (except duplicates)
✅ All public/js/ helper files
✅ Documentation files (*.md)
✅ Development tools (check-*.js, verify-*.js)
✅ package.json, package-lock.json
```

### 2. Archive These (Move to `/archive` folder)
```
📦 All database migration scripts (create-*.js, fix-*.js)
📦 Old SQL files (database-*.sql except database-working-schema.sql)
📦 setup-database.js, run-db-updates.js
```

### 3. Delete These (13 files)
```
❌ *-backup.html files
❌ *-old.html files
❌ *-v2.html, *-v3.js files
❌ test-*.html files
❌ Duplicate files (register.html in root)
```

---

## 🗂️ SUGGESTED FOLDER STRUCTURE

```
qcpaintshop.com/
├── server.js                     ✅ Core
├── package.json                  ✅ Core
├── middleware/                   ✅ Core (3 files)
├── routes/                       ✅ Core (9 files)
├── utils/                        ✅ Core (1 file)
├── public/                       ✅ Core (60+ files)
│   ├── admin-*.html             (20 files)
│   ├── staff/                   (7 files)
│   ├── components/              (4 files)
│   ├── js/                      (2 files)
│   └── css/                     (1 file)
├── docs/                         📖 New folder
│   ├── DATABASE-README.md
│   ├── SCHEMA-UPDATES-2026-02-10.md
│   ├── FILE-ANALYSIS.md
│   └── PROJECT-STATUS.md
├── scripts/                      🔧 New folder
│   ├── check-all-tables.js
│   ├── check-attendance-columns.js
│   └── verify-attendance-setup.js
├── archive/                      📦 New folder
│   ├── migrations/
│   │   ├── create-settings-table.js
│   │   ├── fix-attendance-tables.js
│   │   └── fix-*.js (all migration scripts)
│   └── old-schemas/
│       ├── database-updates-phase1.sql
│       └── database-upgrade.sql
└── .claude/                      ⚙️ Claude settings
```

---

## 🚀 CLEANUP SCRIPT

Run these commands to organize your project:

```bash
# 1. Create new folders
mkdir -p docs scripts archive/migrations archive/old-schemas

# 2. Move documentation
mv *.md docs/

# 3. Move development tools
mv check-*.js verify-*.js test-*.js scripts/

# 4. Move migration scripts
mv create-*.js fix-*.js archive/migrations/
mv database-*-phase*.sql database-upgrade.sql archive/old-schemas/

# 5. Delete backup/old files
rm public/admin-estimate-requests-backup.html
rm public/request-estimate-old.html
rm public/request-estimate-v2.html
rm public/universal-nav-loader-backup.js
rm public/universal-nav-loader-v3.js
rm public/test-logo.html
rm public/header-loader.js
rm register.html

# 6. Keep only working schema in root
mv database-working-schema.sql ./
mv database-complete-schema.sql docs/
```

---

## ✅ FINAL CORE FILE COUNT

After cleanup, you'll have approximately:

```
📂 Root Level: 2 files (server.js, package.json)
📂 Middleware: 3 files
📂 Routes: 9 files
📂 Utils: 1 file
📂 Public (Frontend): ~60 files
📂 Docs: 6 files
📂 Scripts: 4 files
────────────────────────────
Total Working Files: ~85 files ✅
```

This is a healthy, maintainable project size!

---

**Status:** Ready for cleanup ✅
**Next Step:** Review and run cleanup commands
