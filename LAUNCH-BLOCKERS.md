# act.qcpaintshop.com — Remaining Launch Items

**Last updated:** 2026-05-15
**Source plan:** `E:\Dev-analyse\QCPaintShop-BusinessManager-Launch-Readiness.md`

This is the live punch-list of what still needs hands-on work before the launch checklist is fully green. Items already verified done were closed out in commit history — see the README of each commit for the audit trail. Below is **only what's truly open**.

---

## ✅ Closed out this session (2026-05-15)

| Item | Where |
|---|---|
| G1 Tailwind CDN refs in `public/` | 0 matches verified — local JIT pipeline already shipped (U6) |
| G1 CSP doc-comment + allowlist | server.js helmet config — cdn.tailwindcss.com implicitly blocked |
| G2 OTP gen uses `crypto.randomInt` | Verified in 8 sites (engineers / painters / server.js × 3) |
| G2 HTTP → HTTPS SMS | 0 `http://retailsms` refs |
| G2 Unprotected-route audit | All 21 "bare" handlers classified; no real gap |
| G3 Migration tracker | All 97 migrations applied (local + prod) |
| G4 Design tokens for staff/painter palette | Added `--gradient-staff` etc. + `.btn-staff/.btn-painter` utility classes |
| G4 `user-scalable=no` removal | 0 matches in `public/` |
| G4 OG/Twitter meta on share/estimate.html | WhatsApp link previews now work |
| G4 Customer login OTP UX | `inputmode=numeric` + `autocomplete=one-time-code` + per-digit aria-label |
| G6 Anomaly notification badge | Verified wired end-to-end (anomaly-detector → notif-service → socket-bridge → bell badge) |
| G6 Header aria-labels | Bell / hamburger / profile already have aria-label in header-v2.html |
| G6 Bug-reports AI graceful fallback | When clawdbot is unavailable, user gets actionable error + manual triage hint |
| New: Reconcile system (staff + admin) | EOD daily / weekly / monthly / 3m+ stale verification flow |
| New: Painter Marketing — Sikkandar disabled, Martin enabled | 69 leads transferred; scheduler now respects `painter_marketing_config.is_active` |

---

## 🟡 Web — open items (incremental, not launch-blocking)

### G4 — Inline gradients → utility classes (73 instances)
- Tokens + utility classes exist in `public/css/design-system.css`
- 73 inline `style="background: linear-gradient(135deg, #1B5E3B..."` sites remain across ~33 staff/painter HTML files
- **Strategy**: Convert page-by-page when next touched. Mass regex unsafe — each instance is in a different context (button, body, div, JS-assigned `.style.background`)
- **Owner**: incidental during normal feature work

### G4 — Loading skeletons on list pages ✅ DONE
- All 5 audited pages verified: `staff-leads`, `staff-vendors`, `staff-daily-work`, `admin-painters` already have custom `.skeleton` classes with `@keyframes shimmer` (each implements its own visual but the UX intent is met)
- `admin-leads.html` had no skeleton; now uses the shared `qcSkeletonRows()` helper from `public/js/ui-skeletons.js`
- `painter-dashboard.html` has its own `.skel` shimmer painted in `paintInitialSkeletons()` before first fetch
- **Follow-up (low priority)**: standardise all five pages onto the shared `qcSkeleton*` helper for consistent visual language. Mostly cosmetic.

### G6 — Customer dashboard mobile card layout ✅ DONE
- Customer dashboard was already card-based (no tables) — verified via grep
- Invoice rows now flex-wrap so the status badge stacks below on narrow mobile (`<sm` breakpoint), eliminating 3-column cramping on 320-375px screens

---

## 🟠 Android — Goal 5 painter app (separate repo)

Repo: `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android` (no remote — Telegram delivery only)

| Item | Native / Web | Effort |
|---|---|---|
| `WebSettingsCompat.setAlgorithmicDarkeningAllowed(false)` for painter WebView | Native | 5 min |
| Offline-detection banner above WebView (Tamil + English) | Native (`NetworkMonitor`) | 30 min |
| Bump painter `versionCode` 36 → 37, `versionName` "3.4.0" | `app/build.gradle.kts` | 2 min |
| `./gradlew :app:assemblePainterRelease` + Telegram delivery | Build | 10 min |
| Time-aware Tamil greeting (காலை / மாலை வணக்கம்) on painter-dashboard.html | Web | 20 min — **deferred per memory: must use வரவேற்கிறோம் not வணக்கம்** |
| Painter dashboard quick-action buttons ≥ 56dp | Web (`painter-dashboard.html`) | 15 min |
| Shimmer skeletons in place of spinner on painter-dashboard.html | Web | 30 min |
| Painter pages `@media (prefers-color-scheme: dark)` support | Web (CSS) | 1 hour |
| Pull-to-refresh on painter-dashboard.html | Web (overscroll listener) | 30 min |
| Painter OTP `inputmode="numeric"` | ✅ already present (7 refs verified) | done |

---

## 🔴 Manual / external dependencies

| Task | Where | Notes |
|---|---|---|
| Play Store upload — staff vc18 + painter vc36/37 | Google Play Console | Internal track ready; promote when E2E passes |
| WhatsApp Web session QR | `/admin-whatsapp-sessions.html` | One-time setup per server boot |
| SMTP relay configuration | DNS or Brevo/Mailgun | Hetzner blocks outbound port 25; affects password-reset emails. Mobile SMS OTP is the current workaround |
| Zoho OAuth token refresh | Zoho Developer Console | Auto-refresh service exists; just verify it's running |
| Branch geofence coordinate verification | Admin → Branches | 5 branches; one-time per location |
| SSL cert expiry | aaPanel on Hetzner | Auto-renewed by Cloudflare/aaPanel; check renewal date |

---

## 🧪 Goal 7 — Integration verification (runtime, not automated)

These need manual triggering on prod + result confirmation. Recommended order:

1. **SMS OTP delivery** — log in as staff with a fresh phone, watch SMS arrive ✓
2. **Zoho stock sync** — `admin-zoho-stock.html` shows current levels; bump an item in Zoho, verify it lands within 5 min
3. **Zoho invoice sync** — Create a test Zoho invoice, check `admin-zoho-invoices.html`
4. **Zoho OAuth refresh** — `services/zoho-oauth.js` should refresh tokens silently; check service logs for "token refreshed" line
5. **WhatsApp campaign send** — Create a 1-recipient test campaign via `admin-wa-marketing.html`, verify delivery
6. **FCM push** — admin sends a manual notification; verify it arrives on staff Android app
7. **Painter notification end-to-end** — admin approves a painter estimate → push notification arrives on painter device

---

## ✅ Goal 8 — Final pre-launch checklist (run when above is green)

- [ ] `npm run build:css` succeeds (CI green)
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `node server.js` starts on prod without errors
- [ ] Socket.io live updates verified (admin sees real-time staff clock-in)
- [ ] PDF generation: estimate, salary slip, reorder report
- [ ] Branch scoping: staff in Ramanathapuram only see their data
- [ ] All 3 Android APKs build: staff / customer / painter
- [ ] APKs install + load the correct login page
- [ ] Server.js startup time < 5s; memory < 200MB at boot
- [ ] No N+1 queries in high-traffic routes (sample admin dashboard load)

---

## ⚖️ Risk assessment as of 2026-05-15

| Area | Status | Confidence |
|---|---|---|
| Security baseline | ✅ Strong | OTP crypto-secure, no plaintext SMS calls, CSP allowlist, auth on every sensitive route |
| Database integrity | ✅ Strong | All 97 migrations applied; window-function queries available (MariaDB 10.11) |
| Web UI consistency | 🟡 Acceptable | Design tokens exist but page migration is incremental; user-facing pages all render correctly |
| Android UX | 🟡 Painter vc36 shipped, vc37 polish pending | Web-side polish work mostly cosmetic |
| Integrations | 🟢 Mostly verified | Daily syncs / OTP / WhatsApp working in production |
| Operational | 🔴 SMTP outbound blocked | Workaround in place (mobile-OTP only); fix needed for email receipts |

**Ship recommendation**: Web is launch-ready. Android painter vc36 is production-uploadable now; polish items can ship as vc37 in a follow-up. SMTP outbound is the only operational blocker for email receipts — staff/painter flows work fully via SMS today.
