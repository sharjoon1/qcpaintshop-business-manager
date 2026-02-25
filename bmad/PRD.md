# Product Requirements Document (PRD)

> **Product**: Quality Colours Business Manager
> **Version**: 3.3.0 (current) → 4.0 (target)
> **Date**: 2026-02-25
> **Owner**: Quality Colours Pvt Ltd
> **Platform**: act.qcpaintshop.com + Android App

---

## 1. Executive Summary

Quality Colours Business Manager is a **multi-branch paint retail management platform** serving Quality Colours' paint shop operations across multiple branches in India. The platform manages the complete business lifecycle — from customer walk-ins, estimate generation, and Zoho Books accounting integration, through staff attendance tracking with geo-fencing, salary management, WhatsApp communication, AI business intelligence, and a painter loyalty program.

### Current State (v3.3.0)
- **54 admin pages**, **13 staff pages**, **200+ API endpoints**
- **31 route modules**, **27 service files**, **3,499-line server.js**
- **15 npm dependencies**, **37 database migrations**
- **7 background schedulers**, **3+ real-time Socket.io rooms**
- Integrated with Zoho Books, WhatsApp Web, Google Gemini AI, Clawdbot (Sonnet 4.5)
- Android app (Kotlin WebView hybrid) published on Play Store

### Target State (v4.0)
Consolidate technical debt, improve mobile UX, add missing automation, enhance AI capabilities, and scale for multi-city operations.

---

## 2. Problem Statement

### Business Problems
1. **Manual processes**: Many tasks (salary calculation, stock reconciliation, follow-ups) still require admin intervention
2. **Data silos**: Business intelligence is fragmented across Zoho, WhatsApp, attendance, and stock systems
3. **Mobile UX gaps**: Staff mobile app has navigation inconsistencies and missing workflows
4. **Scalability limits**: Monolithic server.js (3,499 lines) and in-memory caching limit scaling
5. **Customer engagement**: No self-service customer portal; all interactions go through staff

### Technical Problems
1. **Monolithic architecture**: Single server.js file handles auth, uploads, routes, sockets, and background jobs
2. **No automated testing**: Zero test coverage; all validation is manual
3. **Cache management**: In-memory `_apiCache` with no eviction strategy (memory leak risk)
4. **Error recovery**: Some background services fail silently; no circuit breaker pattern
5. **Database performance**: Missing indexes on frequently queried columns; no read replicas
6. **Security gaps**: No rate limiting on API endpoints; CSRF protection absent

---

## 3. User Personas

### P1: Business Owner (Admin)
- **Goals**: Real-time business visibility, P&L tracking, staff oversight, customer retention
- **Pain Points**: Too many screens to check; wants single-dashboard decisions
- **Usage**: Desktop primarily, mobile for quick checks
- **Permissions**: Full system access

### P2: Branch Manager
- **Goals**: Branch performance, staff management, customer satisfaction, target achievement
- **Pain Points**: Can't compare branch metrics easily; manual reporting
- **Usage**: 60% desktop, 40% mobile
- **Permissions**: Branch-scoped data, staff management, reports

### P3: Staff Member
- **Goals**: Clock in/out quickly, view tasks, check salary, submit stock counts
- **Pain Points**: Mobile navigation confusion, slow page loads, unclear task priorities
- **Usage**: 95% mobile (Android app)
- **Permissions**: Personal data, assigned tasks, branch stock

### P4: Accountant
- **Goals**: Salary processing, advance management, Zoho reconciliation
- **Pain Points**: Manual salary calculations, advance tracking spreadsheets
- **Usage**: 90% desktop
- **Permissions**: Salary module, payment tracking, reports

### P5: Painter (External)
- **Goals**: Earn loyalty points, get estimates, track referral bonuses
- **Pain Points**: Unclear point balance, slow estimate turnaround
- **Usage**: 100% mobile (dedicated painter app section)
- **Permissions**: Own profile, estimates, points, referrals

### P6: Customer (Future)
- **Goals**: Get paint estimates, track orders, view invoices, request color visualization
- **Pain Points**: No self-service portal; must call/visit shop
- **Usage**: Mobile primarily
- **Permissions**: Own estimates, invoices, communication history

---

## 4. Feature Inventory (Current State)

### 4.1 Core Business Modules

| Module | Status | Pages | Endpoints | Priority |
|--------|--------|-------|-----------|----------|
| Authentication & RBAC | Stable | 3 | 12 | Critical |
| Staff Attendance & Geo-fence | Stable | 6 | 15+ | Critical |
| Salary & Payroll | Stable | 6 | 20+ | Critical |
| Zoho Books Integration | Stable | 12 | 30+ | Critical |
| Estimates & Sales | Stable | 5 | 15+ | High |
| Stock Management | Stable | 4 | 20+ | High |
| Lead Management & CRM | Stable | 3 | 15+ | High |
| WhatsApp Communication | Stable | 3 | 15+ | High |
| AI Business Intelligence | Active Dev | 1 (6 tabs) | 22+ | High |
| Painter Loyalty Program | Stable | 4 | 40+ | Medium |
| Credit Limit Management | Stable | 1 | 13 | Medium |
| Chat & Notifications | Stable | 2 | 10+ | Medium |
| System Health & Errors | Stable | 2 | 12+ | Low |
| Guides & Knowledge Base | Stable | 2 | 8+ | Low |
| Website CMS | Stable | 1 | 6+ | Low |

### 4.2 Background Services

| Service | Schedule | Status |
|---------|----------|--------|
| Zoho Books Sync | Configurable interval + daily full | Active |
| Auto Clock-out | 10:00 PM IST daily | Active |
| Attendance Report | 10:05 PM IST daily | Active |
| AI Zoho Analysis | 9:00 PM IST daily | Active |
| AI Staff Analysis | 10:30 PM IST daily | Active |
| AI Lead Scoring | Every 6 hours | Active |
| AI Daily Snapshots | 6AM / 12PM / 6PM IST | Active |
| AI Marketing Analysis | Monday 9:00 AM IST | Active |
| Painter Slab Evaluation | 1st of month 6:00 AM | Active |
| Painter Quarterly Slabs | Quarter start 6:30 AM | Active |
| Painter Daily Credit Check | 8:00 AM daily | Active |
| WhatsApp Message Processing | Continuous | Active |
| WA Campaign Engine | On-demand | Active |
| System Health Checks | Every 5 minutes | Active |

---

## 5. Gap Analysis & Improvement Areas

### 5.1 Critical Gaps

| ID | Gap | Impact | Effort |
|----|-----|--------|--------|
| G1 | No automated test suite | High risk of regressions on every change | Large |
| G2 | No API rate limiting | Vulnerable to abuse/DDoS | Medium |
| G3 | Monolithic server.js | Hard to maintain, deploy, debug | Large |
| G4 | No customer self-service portal | Missed engagement, higher staff workload | Large |
| G5 | No CI/CD pipeline | Manual deployments, human error risk | Medium |

### 5.2 High-Priority Improvements

| ID | Improvement | Impact | Effort |
|----|-------------|--------|--------|
| I1 | Mobile app offline support (PWA) | Staff can clock in without network | Medium |
| I2 | Dashboard consolidation (single pane of glass) | Faster admin decisions | Medium |
| I3 | Automated salary calculation & approval workflow | Eliminate manual processing | Medium |
| I4 | Smart stock reorder alerts | Prevent stockouts automatically | Small |
| I5 | Customer WhatsApp bot | 24/7 estimate requests, order status | Large |
| I6 | Multi-language support (Tamil, Hindi, English) | Wider staff/customer adoption | Medium |

### 5.3 Technical Debt

| ID | Debt | Risk | Effort |
|----|------|------|--------|
| TD1 | In-memory cache without eviction | Memory leaks in production | Small |
| TD2 | No database connection pooling limits tuning | Connection exhaustion under load | Small |
| TD3 | Hardcoded IST timezone assumptions | Breaks if expanding to other zones | Medium |
| TD4 | No request validation middleware (Joi/Zod) | SQL injection, bad data | Medium |
| TD5 | Console.log-based debugging in production | Performance impact, log noise | Small |
| TD6 | No database migration runner (manual execution) | Schema drift between environments | Medium |
| TD7 | Socket.io rooms not cleaned up on disconnect edge cases | Memory leaks | Small |

---

## 6. Success Metrics

### Business KPIs
- **Staff adoption**: >95% daily active usage (clock-in compliance)
- **Estimate conversion**: Track estimate→invoice conversion rate (target: 40%)
- **Collection efficiency**: Days Sales Outstanding (DSO) reduction by 15%
- **Stock accuracy**: Stock check variance <2% per branch
- **Painter retention**: Monthly active painters >80% of registered

### Technical KPIs
- **API response time**: P95 < 500ms for all endpoints
- **Uptime**: 99.5% availability (currently no SLA)
- **Error rate**: <0.5% of API requests result in 5xx errors
- **Test coverage**: >60% line coverage (from 0% current)
- **Deploy frequency**: Multiple times per week with confidence (CI/CD)
- **Page load time**: <3s on 3G mobile network

---

## 7. Constraints & Assumptions

### Constraints
- **Budget**: Small team (1-2 developers), limited infrastructure spend
- **Stack**: Must remain Node.js/Express/MySQL (team expertise)
- **Integration**: Zoho Books is the accounting system of record (cannot replace)
- **Mobile**: Android-first market (India), must support low-end devices
- **Compliance**: Indian DLT regulations for SMS, GST for invoicing

### Assumptions
- Business will expand to 3-5 branches within 12 months
- Painter program will grow to 200+ registered painters
- WhatsApp remains primary customer communication channel
- AI costs (Clawdbot/Gemini) are acceptable for the value provided
- Staff will primarily use Android app (not mobile browser)

---

## 8. Out of Scope (v4.0)

- iOS native app development
- Multi-tenant SaaS offering for other paint shops
- E-commerce / online ordering for end consumers
- Integration with paint manufacturer systems (Asian Paints, Berger)
- Warehouse management system (WMS) beyond basic stock check
- HR modules beyond attendance and salary (leave management, performance reviews)

---

## 9. Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Zoho API rate limit changes | Medium | High | Implement aggressive caching, sync throttling |
| WhatsApp Web.js library breaks | High | Medium | Abstract messaging layer, consider official API |
| Single server failure | Medium | Critical | Implement health checks, auto-restart, backup strategy |
| AI provider cost increases | Medium | Medium | Multi-provider fallback already in place |
| Data breach via missing auth checks | Low | Critical | Security audit, rate limiting, input validation |

---

## 10. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-25 | BMAD Analysis | Initial PRD from codebase analysis |
