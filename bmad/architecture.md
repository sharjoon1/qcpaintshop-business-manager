# Architecture Document

> **Product**: Quality Colours Business Manager
> **Method**: BMAD (Breakthrough Method for Agile AI-Driven Development)
> **Date**: 2026-02-25
> **Role**: Architect Persona

---

## 1. Current Architecture (As-Is)

### 1.1 System Context Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    EXTERNAL SYSTEMS                      │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Zoho     │ WhatsApp │ Google   │ Clawdbot │ NettyFish   │
│ Books    │ Web.js   │ Gemini   │ (Sonnet) │ SMS Gateway │
│ (Acctg)  │ (Chat)   │ (AI)     │ (AI)     │ (OTP/SMS)   │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬──────┘
     │          │          │          │            │
┌────┴──────────┴──────────┴──────────┴────────────┴──────┐
│                                                          │
│              EXPRESS.JS SERVER (Node.js)                  │
│              ─────────────────────────                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │                   server.js (3,499 lines)         │   │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────────────┐  │   │
│  │  │ Auth &  │ │ 31 Route │ │ 7 Background      │  │   │
│  │  │ Uploads │ │ Modules  │ │ Services          │  │   │
│  │  └─────────┘ └──────────┘ └───────────────────┘  │   │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────────────┐  │   │
│  │  │ Socket  │ │ 27       │ │ 3 Middleware      │  │   │
│  │  │ .io     │ │ Services │ │ (auth,err,log)    │  │   │
│  │  └─────────┘ └──────────┘ └───────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│                    ┌─────┴─────┐                         │
│                    │  MySQL 8  │                          │
│                    │  (Single) │                          │
│                    └───────────┘                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
          │                              │
   ┌──────┴──────┐               ┌───────┴───────┐
   │ Android App │               │ Web Browser   │
   │ (WebView)   │               │ (PWA)         │
   └─────────────┘               └───────────────┘
```

### 1.2 Current Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 18+ |
| Framework | Express.js | 5.2 |
| Database | MySQL | 8.x |
| ORM/Query | mysql2/promise | 3.16 |
| Real-time | Socket.io | 4.8 |
| Frontend | Vanilla HTML/JS | - |
| CSS | Tailwind (CDN) + Custom design-system.css | 3.x |
| Process Mgr | PM2 | Latest |
| Reverse Proxy | Nginx | - |
| OS | Ubuntu Linux | 22.04 |

### 1.3 Current Module Inventory

```
routes/              (31 files)  →  API endpoint handlers
services/            (27 files)  →  Business logic & integrations
middleware/          (3 files)   →  Auth, errors, logging
migrations/          (37 files)  →  Database schema changes
public/              (54 admin + 13 staff + shared pages)
public/components/   (header, sidebars, subnavs)
public/css/          (design-system.css)
public/js/           (auth-helper, error-prevention, socket-helper)
public/icons/        (PWA icons)
```

### 1.4 Current Pain Points

| Area | Problem | Impact |
|------|---------|--------|
| **server.js** | 3,499 lines, mixes auth/uploads/sockets/services | Hard to maintain, risky changes |
| **Caching** | In-memory Map, no eviction | Memory leaks over time |
| **Testing** | Zero automated tests | Every deploy is a risk |
| **Validation** | Manual/inconsistent across routes | Data integrity issues |
| **Deployment** | Manual SSH + git pull | Human error, no rollback |
| **Monitoring** | Basic PM2 + custom health checks | No APM, no alerting |
| **Frontend** | Tailwind via CDN, duplicated styles | Large page sizes, inconsistency |
| **Database** | Single instance, no read replica | Performance bottleneck |

---

## 2. Target Architecture (To-Be)

### 2.1 Proposed Architecture (v4.0)

```
┌─────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                        │
├───────┬─────────┬────────┬──────────┬─────────┬─────────────┤
│ Zoho  │WhatsApp │Gemini  │Clawdbot  │NettyFish│ Push (FCM)  │
│ Books │ Web.js  │  AI    │(Sonnet)  │  SMS    │ Web Push    │
└───┬───┴────┬────┴───┬────┴────┬─────┴────┬────┴──────┬──────┘
    │        │        │         │          │           │
┌───┴────────┴────────┴─────────┴──────────┴───────────┴──────┐
│                    NGINX (Reverse Proxy + SSL)                │
│                    Static file serving + gzip                 │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                    APPLICATION SERVER                          │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ app.js      │  │ config/      │  │ Background Workers  │ │
│  │ (boot only) │  │ ├─ db.js     │  │ ├─ sync-worker.js   │ │
│  │ <100 lines  │  │ ├─ socket.js │  │ ├─ ai-worker.js     │ │
│  │             │  │ ├─ uploads.js│  │ ├─ notify-worker.js │ │
│  └──────┬──────┘  │ ├─ services  │  │ └─ cron-worker.js   │ │
│         │         │ └─ cache.js  │  └─────────────────────┘ │
│  ┌──────┴──────┐  └──────────────┘                           │
│  │ routes/     │                                              │
│  │ ├─ auth.js  │  ┌──────────────┐  ┌─────────────────────┐ │
│  │ ├─ staff.js │  │ middleware/  │  │ services/            │ │
│  │ ├─ admin.js │  │ ├─ auth      │  │ ├─ zoho/             │ │
│  │ ├─ zoho.js  │  │ ├─ validate  │  │ ├─ ai/               │ │
│  │ ├─ ai.js    │  │ ├─ rateLimit │  │ ├─ whatsapp/         │ │
│  │ └─ ...31    │  │ ├─ error     │  │ ├─ notification/     │ │
│  └─────────────┘  │ └─ csrf      │  │ └─ painter/          │ │
│                    └──────────────┘  └─────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    CACHE LAYER                          │  │
│  │              LRU Cache (in-process)                     │  │
│  │              TTL: 5min default, configurable            │  │
│  │              Max: 500 entries, auto-eviction            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                    DATABASE LAYER                              │
│                                                               │
│  ┌─────────────────────┐  ┌────────────────────────────────┐ │
│  │ MySQL 8 (Primary)   │  │ Migration Runner               │ │
│  │ ├─ 80+ tables       │  │ ├─ migrations table            │ │
│  │ ├─ Connection pool  │  │ ├─ npm run migrate             │ │
│  │ │   (max: 20)       │  │ └─ Transaction per migration   │ │
│  │ └─ utf8mb4_unicode  │  └────────────────────────────────┘ │
│  └─────────────────────┘                                      │
│                                                               │
│  ┌─────────────────────┐  ┌────────────────────────────────┐ │
│  │ Automated Backups   │  │ Indexes & Performance          │ │
│  │ ├─ Daily 2 AM IST   │  │ ├─ Composite indexes           │ │
│  │ ├─ 30-day retention │  │ ├─ Covering indexes for lists  │ │
│  │ └─ Offsite storage  │  │ └─ Query explain audit         │ │
│  └─────────────────────┘  └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
          │                              │
   ┌──────┴──────┐               ┌───────┴───────┐
   │ Android App │               │ Web Browser   │
   │ (WebView)   │               │ (PWA)         │
   │ + Offline   │               │ + Offline     │
   │ + Deep Link │               │ + Push Notif  │
   └─────────────┘               └───────────────┘
```

### 2.2 Key Architectural Decisions

#### ADR-001: Keep Monolith (Enhanced)
**Decision**: Stay with enhanced monolith, NOT migrate to microservices.
**Rationale**:
- Small team (1-2 devs) cannot maintain microservices overhead
- Current scale (single server, <1000 concurrent users) doesn't require distribution
- Focus on modular monolith: clear boundaries between modules, shared database
- Can extract services later if scale demands it

#### ADR-002: Server.js Refactoring Strategy
**Decision**: Extract server.js into config modules, keep single process.
**Target structure**:
```
app.js                    (<100 lines - boot + wire)
config/
  ├── database.js         (pool creation + setPool injection)
  ├── socket.js           (Socket.io setup + room handlers)
  ├── uploads.js          (multer configs + directories)
  ├── services.js         (background service initialization)
  └── cache.js            (LRU cache with TTL)
routes/
  └── auth.js             (extracted from server.js auth endpoints)
```

#### ADR-003: Frontend Strategy
**Decision**: Keep vanilla HTML/JS, add build step for production.
**Rationale**:
- Team familiar with current stack; React/Vue migration too costly
- Add: Tailwind build (purge unused CSS), JS minification, HTML compression
- Serve built assets from Nginx (not Express static)
- Progressive enhancement: add offline support via service worker

#### ADR-004: Testing Strategy
**Decision**: API integration tests with Jest + supertest, no unit tests initially.
**Rationale**:
- API tests give highest coverage-to-effort ratio
- Test against real database (test schema, seeded data)
- Start with critical paths: auth, attendance, salary, stock
- Add unit tests for complex business logic (points engine, salary calc)

#### ADR-005: Cache Strategy
**Decision**: Replace in-memory Map with lru-cache package.
**Rationale**:
- Built-in TTL and max-size eviction
- No external dependency (Redis) needed at current scale
- Can swap to Redis later with same interface if needed
- Cache keys namespaced by module (zoho:*, ai:*, stock:*)

#### ADR-006: Validation Strategy
**Decision**: Zod for request validation, applied at route level.
**Rationale**:
- TypeScript-first but works great in JS
- Composable schemas (reuse common patterns: pagination, dates, IDs)
- Better error messages than Joi
- Can generate OpenAPI docs from schemas later

---

## 3. Module Architecture

### 3.1 Module Dependency Map

```
                    ┌────────────┐
                    │   Auth     │
                    │ Middleware │
                    └─────┬──────┘
                          │ (all modules depend on auth)
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────┴─────┐  ┌──────┴──────┐  ┌────┴──────┐
    │ Attendance │  │   Salary    │  │   Stock   │
    │ Module     │  │   Module    │  │   Module  │
    └─────┬──────┘  └──────┬──────┘  └────┬──────┘
          │               │               │
          │         ┌─────┴─────┐         │
          └─────────┤  Reports  ├─────────┘
                    │  Module   │
                    └─────┬─────┘
                          │
                    ┌─────┴─────┐
                    │    AI     │
                    │  Module   │
                    └───────────┘

    ┌───────────┐  ┌───────────┐  ┌───────────┐
    │   Zoho    │  │ WhatsApp  │  │ Painters  │
    │ Module    │  │ Module    │  │ Module    │
    └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
          │               │               │
    ┌─────┴───────────────┴───────────────┴─────┐
    │           Notification Service             │
    └────────────────────────────────────────────┘
```

### 3.2 Module Boundaries

| Module | Routes | Services | Tables | External Deps |
|--------|--------|----------|--------|---------------|
| **Auth** | auth.js, roles.js | - | users, roles, roles_permissions, user_sessions | - |
| **Attendance** | attendance.js | auto-clockout.js, attendance-report.js | staff_attendance, prayer_time_entries, overtime_requests | - |
| **Salary** | salary.js | - | salary_config, salary_monthly, salary_advances, salary_payments | - |
| **Stock** | stock-check.js, stock-migration.js | - | stock_check_*, zoho_location_stock | Zoho (stock) |
| **Zoho** | zoho.js, collections.js | zoho-api.js, zoho-oauth.js, zoho-rate-limiter.js, sync-scheduler.js | zoho_* (12+ tables) | Zoho Books API |
| **WhatsApp** | whatsapp-*.js (3), wa-marketing.js | whatsapp-session-manager.js, whatsapp-processor.js, wa-campaign-engine.js | whatsapp_*, wa_campaigns | whatsapp-web.js |
| **AI** | ai.js | ai-engine.js, ai-context-builder.js, ai-analyzer.js, ai-staff-analyzer.js, ai-lead-manager.js, ai-marketing.js, ai-scheduler.js | ai_* (7 tables) | Gemini, Clawdbot |
| **Painters** | painters.js | painter-points-engine.js, painter-scheduler.js | painter_* (10 tables) | Zoho (invoices) |
| **Leads** | leads.js | ai-lead-manager.js | leads, lead_conversion_predictions | - |
| **Estimates** | estimate-requests.js, estimate-pdf.js, share.js | estimate-pdf-generator.js | estimates, estimate_items, estimate_requests | PDFKit |
| **System** | system.js, admin-dashboard.js | system-health-service.js, error-prevention-service.js, error-analysis-service.js, automation-registry.js | error_logs, system_health_checks, bug_reports | - |
| **Chat** | chat.js | - | chat_conversations, chat_messages | Socket.io |
| **Notifications** | notifications.js | notification-service.js, email-service.js | notifications | Web Push, FCM, SMTP |
| **Credit** | credit-limits.js | - | customer_credit_history, credit_limit_requests, credit_limit_violations | Zoho (contacts) |

---

## 4. Data Architecture

### 4.1 Database Schema Overview

```
┌──────────────────────────────────────────────────────────┐
│                     CORE ENTITIES                         │
│                                                          │
│  users ──┬── user_sessions                               │
│          ├── staff_attendance ── prayer_time_entries      │
│          ├── overtime_requests                            │
│          └── salary_config ── salary_monthly              │
│                                  └── salary_payments     │
│                                  └── salary_advances     │
│                                                          │
│  roles ── roles_permissions                              │
│  branches ── (branch_id on most tables)                  │
├──────────────────────────────────────────────────────────┤
│                    BUSINESS ENTITIES                      │
│                                                          │
│  leads ── lead_conversion_predictions                    │
│  customers ── estimates ── estimate_items                │
│  estimate_requests                                       │
│  zoho_customers_map ── customer_credit_history           │
│                     └── credit_limit_requests            │
│                     └── credit_limit_violations          │
├──────────────────────────────────────────────────────────┤
│                    ZOHO SYNC TABLES                       │
│                                                          │
│  zoho_invoices                                           │
│  zoho_payments                                           │
│  zoho_items_map                                          │
│  zoho_locations_map                                      │
│  zoho_location_stock                                     │
│  zoho_daily_transactions                                 │
│  zoho_sync_status                                        │
│  zoho_api_usage                                          │
├──────────────────────────────────────────────────────────┤
│                    STOCK MANAGEMENT                       │
│                                                          │
│  stock_check_assignments ── stock_check_items            │
├──────────────────────────────────────────────────────────┤
│                    PAINTER LOYALTY                        │
│                                                          │
│  painters ──┬── painter_sessions                         │
│             ├── painter_point_transactions                │
│             ├── painter_referrals                         │
│             ├── painter_product_point_rates               │
│             ├── painter_value_slabs                       │
│             ├── painter_withdrawals                       │
│             ├── painter_attendance                        │
│             ├── painter_invoices_processed                │
│             ├── painter_slab_evaluations                  │
│             └── painter_estimates ── painter_est_items    │
├──────────────────────────────────────────────────────────┤
│                    AI & INTELLIGENCE                      │
│                                                          │
│  ai_conversations ── ai_messages                         │
│  ai_analysis_runs                                        │
│  ai_insights                                             │
│  ai_config                                               │
│  ai_business_context                                     │
│  ai_suggestions                                          │
├──────────────────────────────────────────────────────────┤
│                    COMMUNICATION                          │
│                                                          │
│  chat_conversations ── chat_messages                     │
│  whatsapp_sessions                                       │
│  whatsapp_chat_messages                                  │
│  wa_campaigns                                            │
│  notifications                                           │
├──────────────────────────────────────────────────────────┤
│                    SYSTEM                                 │
│                                                          │
│  error_logs                                              │
│  system_health_checks                                    │
│  bug_reports ── fix_suggestions                          │
│  code_quality_metrics                                    │
│  guides ── guide_categories                              │
│  otp_verifications                                       │
│  settings                                                │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Key Data Relationships

- **Branch scoping**: Most tables have `branch_id` FK → enables branch-level data isolation
- **User FK**: `created_by`, `assigned_to`, `paid_by` reference `users.id`
- **Zoho mapping**: `zoho_*_map` tables link local entities to Zoho IDs
- **Soft delete**: Most entities use `status` column (active/inactive) instead of DELETE
- **Audit trail**: `created_at` + `updated_at` on all tables (added via migrations)

### 4.3 Performance Considerations

| Table | Estimated Rows | Hot Columns | Index Strategy |
|-------|---------------|-------------|----------------|
| staff_attendance | 50K/year | date, user_id, branch_id | Composite (user_id, date) |
| zoho_invoices | 100K+ | location_id, date, status | Composite (location_id, date) |
| zoho_payments | 50K+ | date, location_id | Composite (date, location_id) |
| zoho_location_stock | 10K | item_id, location_id | Composite (location_id, item_id) |
| ai_messages | 10K+ | conversation_id, created_at | Index on conversation_id |
| error_logs | 50K+ | error_hash, created_at | Index on (error_hash, created_at) |
| notifications | 100K+ | user_id, is_read, created_at | Composite (user_id, is_read) |

---

## 5. API Architecture

### 5.1 API Design Principles (Current)

- RESTful endpoints at `/api/{module}/{action}`
- Auth via `Authorization: Bearer {token}` header
- Responses: `{ success: true/false, data: ..., message: "..." }`
- Pagination: `?page=1&limit=20`
- Filtering: query params (e.g., `?branch_id=1&month=2026-02`)

### 5.2 Proposed API Improvements

#### Standardized Response Envelope
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "hasMore": true
  },
  "message": "Records fetched successfully"
}
```

#### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      { "field": "email", "message": "Must be a valid email" }
    ]
  }
}
```

#### Rate Limit Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1708920000
```

### 5.3 Endpoint Consolidation Opportunities

| Current (Multiple Calls) | Proposed (Single Call) | Benefit |
|--------------------------|----------------------|---------|
| 6 calls on staff dashboard load | `GET /api/staff/dashboard` (aggregated) | Faster load, fewer connections |
| Separate config + monthly + history on salary page | `GET /api/salary/my-summary` | Single page load |
| Multiple Zoho dashboard widgets | `GET /api/zoho/dashboard?range=7d` (cached) | Already exists, optimize caching |

---

## 6. Security Architecture

### 6.1 Current Security Model

```
┌─────────────────────────────────────────────┐
│                 REQUEST FLOW                  │
│                                               │
│  Client → Nginx (SSL) → Express              │
│                            │                  │
│                     ┌──────┴──────┐           │
│                     │ requireAuth │           │
│                     │ middleware  │           │
│                     └──────┬──────┘           │
│                            │                  │
│                     ┌──────┴──────┐           │
│                     │requireRole/ │           │
│                     │Permission   │           │
│                     └──────┬──────┘           │
│                            │                  │
│                     ┌──────┴──────┐           │
│                     │  Route      │           │
│                     │  Handler    │           │
│                     └─────────────┘           │
└─────────────────────────────────────────────┘
```

### 6.2 Proposed Security Enhancements

| Layer | Enhancement | Priority |
|-------|------------|----------|
| **Network** | Rate limiting (express-rate-limit) | Critical |
| **Transport** | HSTS headers, CSP headers | High |
| **Application** | Zod input validation on all endpoints | Critical |
| **Application** | CSRF tokens for browser-based forms | High |
| **Data** | Parameterized queries audit (100% coverage) | Critical |
| **Data** | PII encryption at rest (Aadhar, bank details) | High |
| **Auth** | Token rotation on sensitive operations | Medium |
| **Auth** | Account lockout after 5 failed attempts | Medium |
| **Monitoring** | Failed auth attempt alerting | Medium |
| **Backup** | Automated daily backups, offsite storage | Critical |

---

## 7. Deployment Architecture

### 7.1 Current Deployment

```
Developer Machine
      │
      ├── git push origin development
      │
      ├── git merge development → master
      │
      └── SSH to server
            ├── git pull origin master
            ├── npm install
            └── pm2 restart business-manager
```

### 7.2 Proposed CI/CD Pipeline

```
Developer Machine
      │
      └── git push origin development
            │
      ┌─────┴──────────────────────────────────────┐
      │          GitHub Actions                      │
      │                                              │
      │  1. Lint (eslint)                           │
      │  2. Test (jest --coverage)                  │
      │  3. Security scan (npm audit)               │
      │  4. Build (tailwind purge, minify)          │
      │                                              │
      │  On merge to master:                        │
      │  5. Deploy to production                    │
      │     ├── SSH: git pull                       │
      │     ├── npm install --production            │
      │     ├── npm run migrate                     │
      │     ├── pm2 reload business-manager         │
      │     └── Health check (GET /api/test)        │
      │  6. Notify via WhatsApp                     │
      │                                              │
      │  On failure:                                │
      │  7. Rollback (git checkout previous tag)    │
      │  8. Alert admin                             │
      └────────────────────────────────────────────┘
```

---

## 8. Monitoring & Observability

### 8.1 Current State
- PM2 process monitoring (restart on crash)
- Custom `system-health-service.js` (DB, memory, disk checks every 5 min)
- `error_logs` table with dedup and severity
- `automation-registry.js` tracks background service status

### 8.2 Proposed Improvements

| Layer | Tool/Approach | Purpose |
|-------|--------------|---------|
| **APM** | Custom metrics endpoint + Uptime Kuma | Response times, error rates |
| **Logs** | Structured JSON logging (pino) | Replace console.log, enable log search |
| **Alerts** | WhatsApp alerts for critical errors | Instant notification on failures |
| **Uptime** | External uptime monitor (UptimeRobot/Uptime Kuma) | Detect server outages |
| **DB** | Slow query log → weekly review | Performance optimization |

---

## 9. Implementation Roadmap

### Phase 1: Stabilize (Sprints 1-3, ~6 weeks)
- Rate limiting + cache fix (quick wins)
- Server.js refactoring
- Input validation (Zod)
- Database backups
- Security audit

### Phase 2: Quality (Sprints 4-5, ~4 weeks)
- Test suite (critical paths)
- CI/CD pipeline
- Migration runner
- Structured logging

### Phase 3: Automate (Sprints 6-7, ~4 weeks)
- Automated salary workflow
- Stock reorder alerts
- Collection follow-ups
- Daily business reports

### Phase 4: Grow (Sprints 8+, ongoing)
- Customer self-service portal
- AI enhancements (estimates, NL queries)
- Offline PWA support
- Multi-language support

---

## 10. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-25 | BMAD Architect | Initial architecture from codebase analysis |
