# User Stories & Backlog

> **Product**: Quality Colours Business Manager
> **Method**: BMAD (Breakthrough Method for Agile AI-Driven Development)
> **Date**: 2026-02-25
> **Prioritization**: MoSCoW (Must/Should/Could/Won't) + Business Value (1-5)

---

## Story Format

```
ID: EPIC-NNN
Title: [Action-oriented title]
As a [persona], I want [goal], so that [benefit].
Priority: Must | Should | Could
Business Value: 1 (low) - 5 (critical)
Effort: S (1-2 days) | M (3-5 days) | L (1-2 weeks) | XL (2+ weeks)
Acceptance Criteria:
  - [ ] AC1
  - [ ] AC2
Dependencies: [story IDs]
```

---

## Epic 1: Technical Foundation & Code Quality

> **Goal**: Eliminate technical debt, establish testing, improve reliability
> **Owner**: Architect + Developer

### FOUND-001: Refactor server.js into modular structure
**As a** developer, **I want** server.js broken into logical modules, **so that** I can work on features independently without merge conflicts.
- **Priority**: Must | **Value**: 5 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Auth endpoints extracted to `routes/auth.js`
  - [ ] File upload config extracted to `config/uploads.js`
  - [ ] Socket.io setup extracted to `config/socket.js`
  - [ ] Background service initialization extracted to `config/services.js`
  - [ ] server.js reduced to <200 lines (boot + wiring only)
  - [ ] All existing functionality preserved (no regressions)
  - [ ] Server starts and all routes respond correctly

### FOUND-002: Add API input validation with Zod
**As a** developer, **I want** request validation on all API endpoints, **so that** invalid data is rejected before reaching business logic.
- **Priority**: Must | **Value**: 5 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Zod schema defined for all POST/PUT endpoints
  - [ ] Validation middleware applied to all route files
  - [ ] Invalid requests return 400 with clear error messages
  - [ ] SQL injection vectors eliminated via parameterized queries audit
  - [ ] No breaking changes to existing valid requests

### FOUND-003: Implement API rate limiting
**As an** admin, **I want** API endpoints rate-limited, **so that** the system is protected from abuse and DDoS.
- **Priority**: Must | **Value**: 5 | **Effort**: S
- **Acceptance Criteria**:
  - [ ] express-rate-limit applied globally (100 req/min per IP)
  - [ ] Auth endpoints stricter limit (10 req/min per IP)
  - [ ] OTP endpoints stricter limit (5 req/min per phone)
  - [ ] Admin can whitelist IPs in settings
  - [ ] Rate limit headers returned (X-RateLimit-*)

### FOUND-004: Set up automated test suite
**As a** developer, **I want** an automated test suite, **so that** I can deploy with confidence that nothing is broken.
- **Priority**: Must | **Value**: 5 | **Effort**: XL
- **Acceptance Criteria**:
  - [ ] Jest or Vitest configured with test database
  - [ ] Auth endpoints: 10+ tests (login, register, verify, permissions)
  - [ ] Attendance endpoints: 10+ tests (clock-in, clock-out, history)
  - [ ] Salary endpoints: 8+ tests (config, calculate, advances)
  - [ ] Test coverage report generated on each run
  - [ ] Tests run in <60 seconds
- **Dependencies**: FOUND-001

### FOUND-005: Implement CI/CD pipeline
**As a** developer, **I want** automated deployment, **so that** code goes from commit to production safely and quickly.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] GitHub Actions workflow: lint → test → build → deploy
  - [ ] Deploy only on master merge (development branch = staging)
  - [ ] Automated rollback on health check failure
  - [ ] Deployment notification via WhatsApp/Slack
  - [ ] No more manual SSH deployments needed
- **Dependencies**: FOUND-004

### FOUND-006: Fix in-memory cache with proper eviction
**As a** developer, **I want** the API cache to have TTL-based eviction, **so that** memory doesn't leak in production.
- **Priority**: Must | **Value**: 4 | **Effort**: S
- **Acceptance Criteria**:
  - [ ] Replace `_apiCache` Map with node-cache or lru-cache
  - [ ] Default TTL: 5 minutes (configurable per key prefix)
  - [ ] Max cache size: 500 entries
  - [ ] Cache hit/miss metrics logged
  - [ ] Zoho sync clears relevant cache keys

### FOUND-007: Add database migration runner
**As a** developer, **I want** an automated migration system, **so that** schema changes are applied consistently across environments.
- **Priority**: Should | **Value**: 3 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] `migrations` table tracks applied migrations
  - [ ] `npm run migrate` applies pending migrations in order
  - [ ] `npm run migrate:status` shows current state
  - [ ] Each migration runs in a transaction (rollback on failure)
  - [ ] All 37 existing migrations registered as "already applied"

---

## Epic 2: Mobile Experience & Staff UX

> **Goal**: Make the mobile app fast, intuitive, and reliable for staff
> **Owner**: Product Manager + Developer

### MOBILE-001: Implement offline clock-in/out (PWA)
**As a** staff member, **I want** to clock in even without internet, **so that** my attendance is recorded reliably.
- **Priority**: Should | **Value**: 5 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Service worker caches clock-in/out pages and JS
  - [ ] Offline clock-in stored in IndexedDB with timestamp + GPS
  - [ ] Auto-sync when connection restored (background sync API)
  - [ ] Visual indicator showing offline/online status
  - [ ] Conflict resolution: server time wins for attendance disputes
  - [ ] Works on Android WebView (app) and mobile browser

### MOBILE-002: Optimize staff dashboard page load
**As a** staff member, **I want** the dashboard to load in <2 seconds, **so that** I can quickly check my tasks.
- **Priority**: Must | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Dashboard API consolidated to single endpoint (reduce from 6+ calls)
  - [ ] Skeleton loading states while data fetches
  - [ ] Images lazy-loaded
  - [ ] Tailwind CSS purged (remove unused classes)
  - [ ] Lighthouse mobile score >70

### MOBILE-003: Add pull-to-refresh on all staff pages
**As a** staff member, **I want** to pull down to refresh data, **so that** I don't have to navigate away and back.
- **Priority**: Should | **Value**: 3 | **Effort**: S
- **Acceptance Criteria**:
  - [ ] Pull-to-refresh gesture on dashboard, history, tasks, salary
  - [ ] Visual spinner during refresh
  - [ ] Data re-fetched from API (not cache)
  - [ ] Works in Android WebView

### MOBILE-004: Push notification deep linking
**As a** staff member, **I want** tapping a notification to open the relevant page, **so that** I can act immediately.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Stock check notification → stock-check.html
  - [ ] Task assigned notification → tasks.html with task highlighted
  - [ ] Salary notification → salary.html
  - [ ] Permission approved/rejected → permission-request.html
  - [ ] Chat message → chat.html with conversation open
  - [ ] Works on both web push and FCM (Android)

### MOBILE-005: Quick actions from notification panel
**As a** staff member, **I want** to approve/reject requests directly from notifications, **so that** I don't have to open the full page.
- **Priority**: Could | **Value**: 3 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Notification panel shows action buttons (Approve/Reject) where applicable
  - [ ] API call made inline; notification updates in-place
  - [ ] Success/error feedback shown in notification panel

---

## Epic 3: Automated Workflows

> **Goal**: Reduce manual admin work through automation
> **Owner**: Analyst + Developer

### AUTO-001: Automated salary calculation with approval workflow
**As an** admin, **I want** salaries auto-calculated monthly, **so that** I only need to review and approve.
- **Priority**: Must | **Value**: 5 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Cron job calculates all staff salaries on 1st of month at 7 AM
  - [ ] Calculation uses attendance data, OT approvals, allowances, deductions
  - [ ] Admin receives notification with summary (total payroll, exceptions)
  - [ ] Approval workflow: calculated → admin_review → approved → paid
  - [ ] Exceptions flagged: missing attendance days, unusual OT, advance balances
  - [ ] Bulk approve/reject from admin salary page

### AUTO-002: Smart stock reorder alerts
**As an** admin, **I want** automatic alerts when stock falls below reorder point, **so that** I can prevent stockouts.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Reorder point configurable per product per branch
  - [ ] Daily stock level check against reorder points (8 AM)
  - [ ] WhatsApp alert to branch manager when stock below threshold
  - [ ] Admin dashboard widget showing items below reorder point
  - [ ] Suggested reorder quantity based on 30-day moving average

### AUTO-003: Automated collection follow-up reminders
**As an** admin, **I want** automatic follow-up reminders for overdue invoices, **so that** collections happen without manual tracking.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Auto-reminder via WhatsApp at 7, 14, 30 days overdue
  - [ ] Escalation: 30+ days sends alert to admin
  - [ ] Customer payment promise tracking (date + amount)
  - [ ] Reminder templates configurable in settings
  - [ ] Skip customers with active disputes/credit hold

### AUTO-004: Lead follow-up automation
**As a** manager, **I want** automatic follow-up scheduling for leads, **so that** no lead falls through the cracks.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] New lead auto-assigned to staff based on branch + round-robin
  - [ ] Follow-up reminders: Day 1, Day 3, Day 7, Day 14
  - [ ] WhatsApp template sent for each follow-up stage
  - [ ] Lead status auto-updated if no response after 30 days
  - [ ] Manager dashboard: leads without follow-up in 7+ days

### AUTO-005: Daily business report generation
**As an** admin, **I want** a daily business report delivered via WhatsApp, **so that** I start each day with a performance snapshot.
- **Priority**: Could | **Value**: 3 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Report generated at 8 AM IST daily
  - [ ] Includes: yesterday's revenue, collections, attendance, stock alerts
  - [ ] Sent via WhatsApp to configured admin numbers
  - [ ] AI summary of key insights and action items
  - [ ] Branch-wise breakdown

---

## Epic 4: AI Enhancement

> **Goal**: Make AI more useful for daily decision-making
> **Owner**: Architect + Developer

### AI-001: AI-powered estimate generation
**As a** staff member, **I want** AI to suggest products and quantities for estimates, **so that** I can create accurate estimates faster.
- **Priority**: Should | **Value**: 4 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Staff inputs: room dimensions + surface type + desired finish
  - [ ] AI calculates: paint quantity, primer, putty, tools needed
  - [ ] Product suggestions from Zoho item catalog with current prices
  - [ ] One-click to populate estimate form with AI suggestions
  - [ ] Historical accuracy tracking (actual vs estimated)

### AI-002: Customer behavior predictions
**As an** admin, **I want** AI to predict which customers will reorder, **so that** I can proactively engage them.
- **Priority**: Could | **Value**: 3 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Model trained on invoice history (frequency, recency, monetary)
  - [ ] "Likely to reorder" list generated weekly
  - [ ] Trigger WhatsApp outreach for top-50 predicted customers
  - [ ] Track prediction accuracy over time

### AI-003: Natural language report queries
**As an** admin, **I want** to ask questions in plain English and get data answers, **so that** I don't need to navigate multiple pages.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Chat interface accepts: "What was last month's revenue?"
  - [ ] AI generates SQL safely (read-only, parameterized)
  - [ ] Results formatted as tables, charts, or summary text
  - [ ] Supports: revenue, collections, attendance, stock, leads
  - [ ] Response time <10 seconds
- **Note**: Partially implemented in AI Chat (Tab 2). Enhance with SQL generation.

### AI-004: Anomaly detection and proactive alerts
**As an** admin, **I want** AI to detect unusual patterns and alert me, **so that** I can address issues before they escalate.
- **Priority**: Could | **Value**: 4 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Detect: revenue drop >20%, attendance anomalies, stock discrepancies
  - [ ] Alert via WhatsApp with context and suggested action
  - [ ] Weekly anomaly report in AI dashboard
  - [ ] Configurable sensitivity thresholds
  - [ ] False positive feedback loop (admin marks alerts as relevant/irrelevant)

---

## Epic 5: Customer Experience

> **Goal**: Enable customer self-service and engagement
> **Owner**: Product Manager + Developer

### CUST-001: Customer self-service portal
**As a** customer, **I want** to view my estimates and invoices online, **so that** I don't have to call the shop.
- **Priority**: Should | **Value**: 5 | **Effort**: XL
- **Acceptance Criteria**:
  - [ ] Customer login via OTP (existing system)
  - [ ] Dashboard: active estimates, invoices, payment history
  - [ ] View estimate details with product images
  - [ ] Download invoice PDF
  - [ ] Contact branch via WhatsApp from portal
  - [ ] Mobile-responsive design

### CUST-002: Online estimate request form
**As a** customer, **I want** to request a paint estimate online, **so that** I can get a quote without visiting the shop.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Public form: room details, surface type, color preferences, photos
  - [ ] Auto-creates lead + estimate request in system
  - [ ] Customer receives WhatsApp confirmation with tracking number
  - [ ] Staff notified to follow up within 2 hours
  - [ ] Estimate shared via WhatsApp link when ready

### CUST-003: WhatsApp chatbot for common queries
**As a** customer, **I want** to check order status via WhatsApp, **so that** I get instant answers 24/7.
- **Priority**: Could | **Value**: 4 | **Effort**: XL
- **Acceptance Criteria**:
  - [ ] Customer sends "status" + invoice number → gets payment status
  - [ ] Customer sends "estimate" → starts estimate request flow
  - [ ] Customer sends "hours" → gets branch working hours
  - [ ] Fallback to human agent for complex queries
  - [ ] Multi-language support (English, Hindi, Tamil)

---

## Epic 6: Reporting & Analytics

> **Goal**: Provide actionable business insights
> **Owner**: Analyst + Developer

### REPORT-001: Unified business dashboard
**As an** admin, **I want** a single dashboard showing all key metrics, **so that** I can make decisions without clicking through 10 pages.
- **Priority**: Must | **Value**: 5 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] Top KPIs: revenue (today/MTD), collections, outstanding, staff present
  - [ ] Branch comparison chart (revenue, collection rate)
  - [ ] Trend lines: 7-day, 30-day revenue + collections
  - [ ] Action items: overdue invoices, pending approvals, stock alerts
  - [ ] Auto-refresh every 60 seconds
  - [ ] Mobile-optimized layout
- **Note**: Partially exists in admin-dashboard and live-dashboard. Consolidate.

### REPORT-002: Branch P&L report
**As an** admin, **I want** a profit & loss report per branch, **so that** I can evaluate branch profitability.
- **Priority**: Should | **Value**: 4 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Revenue from Zoho invoices (branch-filtered)
  - [ ] Costs: salary (from salary module), rent (manual entry), overhead
  - [ ] Monthly comparison (current vs previous month vs same month last year)
  - [ ] Export to PDF / Excel
  - [ ] Drill-down to individual invoice/expense level

### REPORT-003: Staff performance scorecard
**As a** manager, **I want** a performance scorecard for each staff member, **so that** I can identify top performers and training needs.
- **Priority**: Should | **Value**: 3 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Metrics: attendance %, punctuality, task completion rate, estimate conversion
  - [ ] Monthly trend for each metric
  - [ ] Comparison against branch average
  - [ ] Configurable weightage for composite score
  - [ ] Exportable report for HR review

### REPORT-004: Inventory analytics
**As an** admin, **I want** to see slow-moving and fast-moving products, **so that** I can optimize stock levels.
- **Priority**: Should | **Value**: 3 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Top 20 fast-moving products (by quantity and revenue)
  - [ ] Top 20 slow-moving products (no sales in 30/60/90 days)
  - [ ] Stock turnover ratio per product category
  - [ ] Branch-wise comparison
  - [ ] Seasonal trend overlay

---

## Epic 7: Security & Compliance

> **Goal**: Harden the application against threats
> **Owner**: Architect + Developer

### SEC-001: Implement CSRF protection
**As a** developer, **I want** CSRF tokens on all state-changing requests, **so that** the app is protected from cross-site request forgery.
- **Priority**: Must | **Value**: 5 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] CSRF token generated per session
  - [ ] Token validated on all POST/PUT/DELETE requests
  - [ ] API endpoints exempt (token-based auth is sufficient)
  - [ ] Token rotation on sensitive operations (password change, admin actions)

### SEC-002: Security audit and penetration test
**As an** admin, **I want** a security audit of the application, **so that** customer and business data is protected.
- **Priority**: Must | **Value**: 5 | **Effort**: L
- **Acceptance Criteria**:
  - [ ] All SQL queries audited for injection vulnerabilities
  - [ ] XSS vectors identified and fixed (especially in chat, estimates, guides)
  - [ ] Authentication flow reviewed (token storage, expiry, rotation)
  - [ ] File upload validation (type, size, content scanning)
  - [ ] OWASP Top 10 checklist completed
  - [ ] Findings documented with severity ratings

### SEC-003: Data backup and recovery
**As an** admin, **I want** automated daily backups, **so that** business data can be recovered in case of failure.
- **Priority**: Must | **Value**: 5 | **Effort**: M
- **Acceptance Criteria**:
  - [ ] Automated MySQL dump daily at 2 AM IST
  - [ ] Backups stored offsite (S3 or similar)
  - [ ] 30-day retention policy
  - [ ] Backup verification (restore test monthly)
  - [ ] Upload file backup (attendance photos, documents)
  - [ ] Recovery procedure documented and tested

---

## Backlog Priority Matrix

### Sprint 1 (Must-Have, High Value)
| Story | Effort | Value |
|-------|--------|-------|
| FOUND-003 (Rate Limiting) | S | 5 |
| FOUND-006 (Cache Fix) | S | 4 |
| SEC-003 (Backups) | M | 5 |
| MOBILE-002 (Dashboard Speed) | M | 4 |

### Sprint 2 (Must-Have, Foundation)
| Story | Effort | Value |
|-------|--------|-------|
| FOUND-001 (Refactor server.js) | L | 5 |
| FOUND-002 (Input Validation) | L | 5 |
| FOUND-007 (Migration Runner) | M | 3 |

### Sprint 3 (Must-Have, Security)
| Story | Effort | Value |
|-------|--------|-------|
| SEC-001 (CSRF) | M | 5 |
| SEC-002 (Security Audit) | L | 5 |
| FOUND-004 (Test Suite) | XL | 5 |

### Sprint 4 (Should-Have, Automation)
| Story | Effort | Value |
|-------|--------|-------|
| AUTO-001 (Auto Salary) | L | 5 |
| AUTO-002 (Stock Alerts) | M | 4 |
| AUTO-003 (Collection Follow-up) | M | 4 |

### Sprint 5 (Should-Have, UX + Reports)
| Story | Effort | Value |
|-------|--------|-------|
| REPORT-001 (Unified Dashboard) | L | 5 |
| MOBILE-001 (Offline Clock-in) | L | 5 |
| MOBILE-004 (Deep Linking) | M | 4 |

### Sprint 6+ (Should/Could, Growth)
| Story | Effort | Value |
|-------|--------|-------|
| CUST-001 (Customer Portal) | XL | 5 |
| AI-001 (AI Estimates) | L | 4 |
| AI-003 (NL Queries) | M | 4 |
| FOUND-005 (CI/CD) | M | 4 |
| AUTO-004 (Lead Automation) | M | 4 |
| AUTO-005 (Daily Report) | M | 3 |

---

## Story Count Summary

| Epic | Must | Should | Could | Total |
|------|------|--------|-------|-------|
| Foundation & Code Quality | 5 | 2 | 0 | 7 |
| Mobile Experience | 1 | 3 | 1 | 5 |
| Automated Workflows | 1 | 3 | 1 | 5 |
| AI Enhancement | 0 | 2 | 2 | 4 |
| Customer Experience | 0 | 2 | 1 | 3 |
| Reporting & Analytics | 1 | 3 | 0 | 4 |
| Security & Compliance | 3 | 0 | 0 | 3 |
| **Total** | **11** | **15** | **5** | **31** |
