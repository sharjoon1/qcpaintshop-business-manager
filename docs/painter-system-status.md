# Painter System Status

**Date:** 2026-02-26
**Decision:** KEEP — Feature is active, configured, and intentionally deployed. Empty tables are expected for a newly launched module with limited onboarding.

## Current State

- **painter_system_enabled:** `true` (ai_config)
- **painter_estimate_enabled:** `true`
- **painter_referral_enabled:** `true`
- **Registered painters:** 1 (test user "syed", status: approved)
- **Painter sessions:** 5 (user has logged in multiple times)
- **Routes:** Loaded in server.js at `/api/painters` (~40 endpoints)
- **Scheduler:** Running (monthly slabs, quarterly slabs, daily credit check)
- **Pages:** painter-register.html, painter-login.html, painter-dashboard.html, admin tab

## Why Tables Are Empty

The painter loyalty system was built Feb 23, 2026 — 3 days ago. Only 1 test painter has registered. The empty tables will populate when:

| Table | Populates When |
|-------|---------------|
| painter_point_transactions | Painter invoices are processed through Zoho |
| painter_product_point_rates | Admin configures per-product point rates |
| painter_value_slabs | Admin sets up value-based slab tiers |
| painter_slab_evaluations | Monthly/quarterly slab scheduler runs with active painters |
| painter_referrals | A painter refers another painter who registers |
| painter_invoices_processed | A Zoho invoice is linked to a painter |
| painter_withdrawals | A painter requests point withdrawal |
| painter_attendance | A painter checks in at a branch |
| painter_estimates | A painter creates an estimate |
| painter_estimate_items | Line items for painter estimates |

## Setup Checklist (For Go-Live)

1. **Configure point rates:** Admin > Painters > Settings tab — set per-product point rates or use default value slabs
2. **Set value slabs:** Define earning tiers (e.g., 0-10K = 1%, 10K-50K = 1.5%, 50K+ = 2%)
3. **Onboard painters:** Share registration link (`/painter-register.html`) with painters
4. **Link invoices:** When creating Zoho invoices for painters, the system auto-processes points
5. **Monitor:** Admin > Painters tab shows all registered painters, points, referrals

## Architecture

- **Service:** `services/painter-points-engine.js` (processInvoice, slabs, credit, withdrawals)
- **Routes:** `routes/painters.js` (~40 endpoints)
- **Scheduler:** `services/painter-scheduler.js` (monthly/quarterly/daily jobs)
- **Auth:** OTP-based via WhatsApp, separate from staff auth (`X-Painter-Token` header)
- **Tables:** 10 tables prefixed with `painter_`
- **Config:** `ai_config` table with `painter_` prefix keys
