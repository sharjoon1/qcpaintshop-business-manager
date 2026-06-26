# QC Painter Android — Premium Redesign (v5.0)

**Date:** 2026-06-26
**App:** `qcpaintshop-android` (painter flavor) — v4.1.2 vc43 → **v5.0 vc44** (target)
**Direction:** Quiet-Luxury Loyalty-Premium (Approach 1)
**Status:** Design approved by owner 2026-06-26. Implementation plan to follow (writing-plans).
**Live preview artifacts:** `.superpowers/brainstorm/15512-1782433170/content/` (design-preview-v2.html, estimate-modes-v2.html, all-screens.html) — gitignored.

---

## 1. Goals

Lift the painter app from its current v4.x green/gold Material-3 redesign to a **world-class, top-tier** loyalty app that a painter opens **3–4× per day**. Without removing any existing feature.

Three pillars (owner brief):
1. **Premium visual identity** — modern, high-contrast (outdoor-readable on sunny job sites), trustworthy.
2. **High-frequency daily engagement** — hooks/dashboards that pull the painter back morning / midday / evening.
3. **Screen-by-screen simplification** — minimal typing, quick-tap, on-the-field friendly.

## 2. Direction & constraints

**Direction: "Quiet-Luxury Loyalty-Premium"** (Amex/Cred premium-loyalty feel, in the brand green/gold). Refined whitespace, rich green gradient heroes, real product/room photography in hero + empty states, soft elevated cards, restrained gold (earnings only), confident spring motion. Selective reward-forward energy (streaks, bonuses, celebrations) in the engagement layer.

Rejected alternatives: B) Reward-Forward (promo-y), C) Trade-Pro (utilitarian/flat).

**Locked constraints:**
- Brand colours kept: `QCGreen #1B5E3B`, `QCGold #D4A24E` (gold = earnings only, never decorative).
- **Outdoor high-contrast**: depth comes from gradients + soft shadows + layered cards — **no glassmorphism/blur** (blur reduces contrast outdoors).
- Tamil type support preserved (Noto Sans Tamil).
- **No existing feature removed.** All 32 screens retained.
- Light-only (no dark mode) — `android:forceDarkAllowed=false` stays.

## 3. Design tokens (additions/refinements only — nothing removed)

Source: `app/src/painter/java/com/qcpaintshop/painter/ui/theme/` (Color.kt, Type.kt, Theme.kt).

**Colour**
- Add `QCHeroGradient` (QCGreen→QCGreenDarkest, multi-stop 160°, with gold + green radial glows) + `QCGoldGradient`.
- Add photography scrims: `QCScrimGreen`, `QCScrimDark` (20→60%) for text legibility over hero photography.
- Add depth tints: `QCSurfaceRaised` (#FFF card) vs `QCSurfaceSunken` (#F1F4EF behind) for layered depth.
- Add AP accent: **Apricot `#E65100`** used for Attendance Points (AP) and AP-related UI **only** — visually separates AP from gold (regular/annual) points.

**Typography** (Inter stays; Tamil via Noto Sans Tamil)
- **Tabular figures** (`fontFeatureSettings = "tnum"`) for all money/points/AP numbers — vertical alignment = premium.
- Hero numbers: Bold + tight tracking. No serif body; Fraunces serif reserved for premium hero headlines (H1/points total) on Home/Points.

**Shape:** cards 12→16dp, sheets 20→28dp top, pills 999dp.

**Elevation:** add `heroElevation` — larger soft shadow + green-tinted ambient (green CTA casts faint green shadow). No blur.

**Motion (confident, less bouncy):** add staggered list reveal (60ms/item), hero entrance (fade+rise 300ms), shared-element transitions to detail screens, tap-scale 0.96 on press, haptics on primary actions. Existing springs tuned less bouncy.

**Imagery system:** hero photography (product/room/work) with gradient scrim + subject crop; empty states → real photography or refined branded illustration (SVGs swapped in as designer delivers); aspect ratios locked (hero 16:9, card thumb 1:1, gallery 4:5). Paint products rendered as **real colour swatches** (the product IS a colour) — reliable offline, on-brand.

## 4. Engagement framework — the daily hook

**Surface: "Daily Briefing" hero on Home** (owner-approved option A). A single time-aware card at the top of Home that changes through the day:
- **Morning:** "Check in to extend your streak" + today's bonus product.
- **Midday:** "Bonus X ends in 4h" urgency.
- **Evening:** "Today you earned ₹X / +Y pts" recap.

Pull-to-refresh updates it. Powered by the **existing backend Briefing Module** (`message`, `dailyBonus` + `hoursLeft`, `tips`, `estimateUpdates`, `withdrawalUpdates`) — **no new backend needed.**

Secondary hooks (contextual, light): bonus-product badge on Catalog, payment-update nudge on Work, AP-claim-window open push (FCM).

## 5. Points & AP — precise rules (verified against code 2026-06-26)

Three points tallies, visually distinct: **Regular** (gold, withdrawable), **Annual** (gold, yearly pool), **AP** (apricot, attendance — separate).

**Regular / Annual points** — `services/painter-points-engine.js`:
- Customer-billing estimates earn **regular + annual**.
- **⚠️ RULE CHANGE (money-path, test-first per CLAUDE.md §6):** Owner rule — only **Ask-QC** customer billing earns regular+annual; **I'll-Price-It** earns **annual only** (it's a painter cost-purchase like self-billing). Current code awards regular+annual to *all* `billing_type='customer'`. **Fix:** in `_awardInvoicePoints`, gate the regular-points branch on `pricing_mode === 'request_qc_price'` (not just `billing_type`). Annual still applies to all eligible. Add a characterization test locking both modes before changing.

**AP (Attendance Points)** — `services/painter-attendance-service.js`:
- **+100 AP per check-in day** (`pointsPerDay`, default 100).
- **Monthly claim % = ⌊ customer billing ÷ ₹1,000 ⌋**, capped 100% (`rupeesPerPct=1000`, `maxPct=100`). Only `billing_type='customer'` estimates with status `pushed_to_zoho`/`payment_recorded` count.
- **Claimable AP = ⌊ total AP × claim% ÷ 100 ⌋** → on claim, converts to **regular points 1:1**.
- **7-day claim window** (`claimWindowDays`); unclaimed AP forfeits.
- Example: 1,200 AP earned · ₹48,000 billed → 48% → **576 AP claimable**.

## 6. Screen designs

All screens share: continuous green header (no seam), uniform monochrome bottom-nav icons (active green + top indicator, inactive gray), FAB, soft elevated cards on #F1F4EF.

### 6.1 Home (the daily hub)
Continuous green header: status bar + app bar (logo + 🔔 with badge) + hero. Hero shows **three point tiles**: Regular, Annual, AP (apricot) + lifetime caption + level progress bar + chips (streak / referrals / pending).
Below header: **AP-claim card** (apricot, monthly — shows ₹billed → claim% → claimable AP + Claim button), search bar, **Daily Briefing card**, **Offers carousel** (paint-swatch cards, 2×-pts/discount badges, today's points), **Shop Catalog carousel** (cards with **variant chips + selected price**, interactive), quick actions, recent activity. Bottom nav + FAB.

### 6.2 Catalog + Product Detail
Catalog: search + brand chips (Asian/Berger/Nerolac/Birla Opus) + 2-col grid of **product cards each with variant chips (1L/4L/10L/20L) → selected price only**, rating, discount, points. Product Detail: Fraunces hero name, rating, price/discount, pack-size cards, shade selector (colour circles), about, sticky `+points / Add to cart`.

### 6.3 Work / Estimates
Estimates list with tabs (Estimates/Quotations) + status timeline per row (Draft→Submitted→Approved→Sent→Payment→Done) + amount + "pts on payment". Estimate Detail: timeline, line items, sticky status-driven CTA.

### 6.4 Estimate Create — THREE billing modes ⭐ (owner-verified)
Mode picker → Self vs Customer (Customer → Ask-QC / I'll-Price-It).

| Mode | Code | Painter pays | Earns | Customer | PDF |
|---|---|---|---|---|---|
| **1. Self Billing** | `billing_type=self` | **cost (direct) price to QC** | **annual only** | — (own use) | QC branded |
| **2. Customer · Ask QC** | `customer` + `pricing_mode=request_qc_price` | nothing (customer pays QC) | **regular + annual** *(after full payment)* | pays QC's quoted price (admin marks up) | QC branded |
| **3. Customer · I'll Price It** | `customer` + `pricing_mode=direct` + `hide_qc_branding=1` | **cost price to QC** | **annual only** | **pays painter's own price** (painter keeps margin) | **Painter name** (QC hidden) |

- **Self**: items at cost (MRP struck-through, "direct cost price" tag), "Annual only" badge, QC PDF, Save (direct).
- **Ask QC**: cart at base rate, "admin will quote", "regular + annual after full payment" badge, QC PDF, Send to QC (`pending_admin`).
- **I'll Price It**: per-item markup slider (0..max, **MRP-capped**, "you keep ₹X/u margin" tag) + labour field, "Annual only" badge, **Settlement card** (You pay QC cost / You collect from customer / Your margin), "estimate in YOUR name, QC branding hidden" notice, Create (direct). PDF generator (`painter-estimate-pdf-generator.js:56-60`) swaps QC logo/GST/UPI/footer for painter name+phone+city when `hide_qc_branding=1`.

### 6.5 Check-in + Attendance (AP)
Selfie capture ring + GPS chip + streak card (12-day, personal best). "+100 AP/day". Monthly AP mini (earned / claimable @ % / window). Attendance Calendar: month grid (green=checked-in, today=gold ring) + streak. Attendance History: monthly AP claim window.

### 6.6 Points
Header: lifetime total (Fraunces). Three counters (Regular / Annual / AP-apricot). Tier track. **AP-claim card** with the exact calculation (AP earned · customer billing · claim% = ⌊billed÷₹1000⌋ · claimable AP = AP×%) + rule note + 7-day window + Claim button → +regular points. Transactions list (regular/annual/AP colour-coded, filter).

### 6.7 Profile
Green header (avatar + name + Gold tier) + stats row (lifetime pts / referrals / earned) + 9-tile menu grid (Points History, Leaderboard, Achievements, Cards, Refer & Earn, Gallery, Visualizations, Training, Settings). Sub-screens retain premium styling; the known broken aadhar-`<img>` preview (auth-header bug) is out of scope, untouched.

### 6.8 Auth / Onboarding / Notifications
Login (phone+OTP, green hero, gold logo). 3-page Onboarding (value pitch). Awaiting Approval (pulsing ring + timeline). Notifications list with deep-links (FCM).

## 7. Component library upgrades
- **Bottom nav**: uniform monochrome SVG line icons (replace emoji), active = green + top indicator.
- **Quick actions / section icons**: same uniform line-icon set.
- Cards: 16dp, soft green-tinted shadows.
- Variant selector: chip row → single selected price (used in Catalog grid, Home carousel, Product Detail).
- AP components: apricot AP tile, AP-claim card, monthly-claim calculator.

## 8. Phasing (implementation — to be sequenced by writing-plans)
- **Phase 1:** Design-system tokens + Home + premium shell (header/nav/FAB) + Daily Briefing + Offers/Catalog carousels. (The approved hero.)
- **Phase 2:** Catalog + Product Detail + variant-selector component.
- **Phase 3:** Estimate Create — 3 billing modes + Work list/detail + **backend points-engine rule change** (test-first).
- **Phase 4:** Check-in/Attendance (AP) + Points (AP claim card) + Profile deep + Auth/Onboarding + Notifications + component-library sweep.

## 9. Open questions / out of scope
- **Q-AP1:** AP→regular conversion is 1:1 today — confirm stays 1:1 in v5. (Assume yes.)
- **Q-EC1:** Discount-request flow on estimates — keep current behaviour (out of redesign scope, just restyle).
- Real photography assets (product/room/work) — need sourcing; until then, colour-swatch + gradient placeholders.
- Staff/customer flavors not in scope (painter only).

## 10. Verified code references
- Points engine: `services/painter-points-engine.js` (`_awardInvoicePoints` ~L240-273) — regular gated by billing_type today (needs pricing_mode gate).
- AP: `services/painter-attendance-service.js` (`computeClaimPct` L38, `computeClaimableAp` L44, `claimMonth` L120, `openMonthlyClaim` L226).
- Estimate pricing/submit: `routes/painters/painter.js` (L1013 validation, L1069-1084 pricing+MRP cap).
- PDF branding: `services/painter-estimate-pdf-generator.js` (L56-60 hide_qc_branding branch).
- Android: `EstimateCreateScreen.kt` (Self/Customer picker), `CustomerEstimateScreen.kt` (Ask-QC / I'll-Price-It tabs), `CustomerEstimateViewModel.kt` (markup slider, MRP cap, hide_qc_branding).
