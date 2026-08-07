# Business Manager — Full IA & UI/UX Re-architecture Plan

**Date:** 2026-08-07
**Scope:** Admin + Staff panels end-to-end (162 HTML files, 14 nav components, ~50 route modules)
**Author:** Muse Code (deep read-only audit, ~15 discovery queries)
**Decides:** What to consolidate, what to delete, new IA, new design-system rules, execution order.

---

## Goal

Admin-um Staff-um panel-la ippo `162` HTML pages (~70 admin-*, 14 staff/*) 15 collapsible sidebar sections-la kurambip poy irukku. Ovvொru module-kku 4–12 duplicate pages irukku, landing header/style vera vera, subnav horizontal scroll-la 20 tabs. Itha **8 unified Module Hubs**-a maathi, duplicate pages-a archive panni, ore design-system (tokens, header, cards, empty-states, toasts) vechu — **kuraiva sollamudiyatha azhagana UX** kodukanum. Money-critical logic (estimate, salary, painter-points, DPL, Zoho sync) mathama, look & navigation mattum.

---

## Success Criteria (outcome, not tasks)

1. Admin sidebar 8 primary modules + 2 system groups-ku mela pogathu; oru click-la current module theriyum, oru hub-kulla thaan depth irukkum.
2. Stock, Salary, Leads, Zoho Books, WhatsApp, HR/Attendance, Products, System maathiri duplicate-heavy domains Hub-la consolidate — oru feature-kku oru canonical page mattum.
3. Staff panel 6–7 items-ku sari, admin page-a kaamikathu.
4. Header / page-title / card / table / empty-state / toast ellame `design-system.css` tokens-la irunthu — Inter-only hierarchy, `gray-400` body avoid, purple gradient hero avoid (anti-slop).
5. Mobile: sidebar + quickbar + subnav 3 navs overlap pannathu — single responsive nav.
6. Lighthouse-ish: no 404, no broken `data-page → subnav` mapping, no orphan pages beyond IA.
7. Feature parity: existing API routes, permissions, `data-roles`/`data-requires` gates mathathu — nav mattum maathu.

---

## Context And Current Facts

**Inventory (verified 2026-08-07, `ls public/**/*.html = 162`):**

- **Admin:** ~72 `admin-*.html` + root `dashboard.html`, `estimates.html`, `chat.html`, `estimates*`, etc.
- **Staff:** 14 files `staff/{activities,advance-request,agreement,clock-in,clock-out,collections,daily-tasks,dashboard,guides,history,permission-request,salary,stock-check,tasks}.html`
- **Sidebar:** `public/components/sidebar-complete.html` **1211 LOC**, 15 collapsed sections, ~82 links. `public/components/staff-sidebar.html` **877 LOC**, 12+ sections, still exposes admin pages via `data-requires` filter at runtime.
- **Subnavs:** 12 components (`components/*.html`) + loader `public/universal-nav-loader.js` **521 LOC**, `SUBNAV_MAP` 30+ `data-page → subnav` entries, `COMPONENT_JS` 15 entries externalized (`/js/nav/*.js`). Zoho subnav alone (`zoho-subnav.js` + `zoho-subnav.html`) lists **20 tabs** (Dashboard…Settings) — horizontal scroll `overflow-x: auto; scrollIntoView`.
- **Header:** `public/components/header-v2.html` + `/js/nav/header-v2.js` pinned 56px.
- **CSS fragmentation:** `public/css/{tailwind.css, design-system.css (tokens), qc-ui.css (toast/modal), qc-corporate.css, skeletons.css, zoho-common.css, stock-filters.css, painter-dark.css, engineer-portal.css, mobile.css}` — `design-system.css` exists (tokens `--color-primary: #6366f1` etc.) but pages bypass it with inline Tailwind `bg-[#667eea]` or per-page `<style>`.
- **Design tokens conflict:** `CLAUDE.md` says Admin `#667eea→#764ba2`, Staff/Painter `#1B5E3B + #D4A24E`. `design-system.css` tokens use `--color-primary: #6366f1` (indigo) + sidebar active `#eff6ff / #2563eb` (blue #3b82f6). `sidebar-complete.html` actually renders `linear-gradient(135deg, #3b82f6, #2563eb)` brand icon — neither admin purple nor correct per CLAUDE.
- **Anti-slop status:** `grep bg-[#667eea]` → **1** file (low), `bg-[#1B5E3B]` → **0** files (good) but new Hub just introduced `#667eea→#764ba2` gradient locally — inconsistency seeded.
- **Duplicate matrix (load-bearing overlaps):**

| Domain | Pages today | True overlap | Candidate canonical Hub |
|---|---|---|---|
| **Stock & Zoho Books** | `admin-zoho-dashboard/items/items-edit/dpl/price-list/stock/stock-adjust/stock-check/stock-migration/stock-hub / locations/reorder/purchase-suggestions/transactions/collections/bulk-jobs/reports/gst-reports/item-master` (18) | `Stock Hub` already merges stock+locations+reorder+stock-check+migration+valuation+dead; old `zoho-stock + stock-check + stock-migration + item-master + dpl + price-list` still separately reachable | `Stock Hub` (already built) + `Zoho Books Hub` (invoices/txn/collections only) |
| **Salary & Payroll** | `admin-salary-{config,monthly,payments,advances,incentives,reports}` (6) + `staff/salary + advance-request` | 6 admin pages are slices of one monthly cycle; incentives duplicates `painter-points` | `Salary Hub` (Config · Monthly · Payments · Advances · Incentives · Reports as tabs) |
| **Leads & Customers** | `admin-leads/lead-scoring/design-requests/painter-leads / customers/customer-types/credit-limits` (7) + `staff-leads` | Leads vs Customers split artificial; credit-limits is a sub-feature of customers | `CRM Hub` (Leads · Customers · Credit · Design Requests) |
| **Products & Catalog** | `admin-products/brands/categories/painter-catalog/engineer-catalog/photos/item-master` (6) + `products-subnav` | Brands/Categories are taxonomy, not modules; painter/engineer catalogs duplicate product list | `Catalog Hub` (Products · Brands · Categories) |
| **HR / Attendance / Tasks** | `staff/{clock-in,clock-out,history,permission-request,activities,agreement,tasks,daily-tasks} / admin-{tasks,daily-tasks,attendance,activity-monitor,geofence-logs}` (12) | `tasks` vs `daily-tasks` is same DB `daily_tasks` with different view | `Work Hub` (Clock · History · Tasks · Daily Tasks) — admin vs staff as role-filtered view, not duplicate pages |
| **WhatsApp** | `admin-wa-{dashboard,contacts,marketing,templates,settings,admin-login} + whatsapp-{chat,sessions}` (8) | 8 pages for one integration | `WhatsApp Hub` (Inbox · Contacts · Campaigns · Templates · Sessions) |
| **Painters & Engineers** | `admin-painters + 6 query-tab deep-links (points/rates/withdrawals/reports) / painter-catalog/painter-leads / admin-engineers + engineer-catalog` | Tab deep-links (`admin-painters.html?tab=points`) create ghost nav entries | `Painters Hub` + `Engineers Hub` (each single page with internal tabs, not 7 sidebar links) |
| **System / Ops** | `admin-{reports,settings,profile,website,guides,ai,system-health,bug-reports,anomalies,monitoring,photos,activity-monitor}` + `dashboard/live-dashboard` (14) | Reports is Zoho-reports duplicate; ai/bug/anomalies/monitoring are observability slices | `System Hub` (Settings · Health · Logs · Guides) collapsed |

- **Mobile nav:** Sidebar (320px drawer) + bottom quickbar (4 items) + subnav tabs (horizontal) = 3 levels competing. Staff quickbar duplicates sidebar links.
- **Orphan / legacy risk:** `birla-opus-report.html`, `admin-agreements.html` (agreements domain), `admin-gst-reports.html` vs `zoho-reports`, `admin-branches.html` semantics (branch = org unit) vs `zoho-locations` (Zoho org location) — naming confusion noted.
- **Plans history:** `.agents/plans/2026-08-07-stock-smart-manager.md` (prior stock hub). `docs/plans/` has template for future plans — reuse that convention for sub-plans if needed.

---

## Constraints And Non-goals

**Constraints (must not break):**

- `CLAUDE.md §6` money paths locked (estimate single-round R10, salary Sunday×2 only on `/260*10h`, painter-points pools, DPL `ceil(dpl*1.18*1.10)`, Zoho `custom_fields` wrapper). Nav/IA changes must NOT touch `routes/estimates.js`, `routes/salary.js`, `services/painter-points-engine.js`, `services/dpl-catalog.js`, `services/zoho-api.js` business logic.
- Single `mysql2/promise` pool injected via `route.setPool(pool)` (`server.js:~284-393`); new hubs must reuse pool, not spawn.
- Four auth systems separated (`user_sessions`, `customer_sessions`, `painter_sessions`, `engineer_sessions`; token `LOWER(SHA2(token,256))` compare). Do not unify auth.
- `config/database.js` `+00:00 UTC` session timezone — cosmetic date formatting only, not programmatic offset changes.
- Maintain `universal-nav-loader.js` contract (loads header+sidebar+subnav, respects `data-page`, `data-roles`, `data-requires`). Evolution, not rewrite, to keep rollout safe.
- Brand colors: admin purple `#667eea→#764ba2`, staff/painter green `#1B5E3B` + gold `#D4A24E` — do NOT paint staff pages purple, do NOT introduce new brand palette. Sidebar active `#2563eb` is accidental drift; correct to brand.
- Keep `.env` secrets untouched, no destructive SQL without approval.

**Non-goals (out of this plan):**

- Android repo `qcpaintshop-android` — not in scope.
- DB migrations / schema consolidation (no `schema.sql` single file proposal here).
- Full Tailwind JIT rebuild pipeline change (assume `npm run build:css → public/css/tailwind.css` stays).
- Individual hub business logic (e.g., new reorder algorithm) — deferred to per-hub follow-ups.
- Removing authenticated API routes; only nav links are pruned, routes stay (404 guard via sidebar prune vs route delete).

---

## Key Decisions

| Decision | Recommended | Rejected alternatives | Why |
|---|---|---|---|
| **IA shape** | 8 Module Hubs + 2 System groups — each Hub is a single HTML with internal tabs (Stock Hub pattern), sidebar has 8 links, not 80. | Keep 80-link flat sidebar with 12 subnavs / create new React SPA shell / per-page sidebar duplication | Stock Hub already proved the pattern in this repo (62KB, 6 tabs, local auto-save). SPA would force wholesale rewrite, violate single-pool route injection assumption. |
| **Sidebar redesign** | Rewrite `sidebar-complete.html` from 1211→~400 LOC: 8 primary `qc-nav-item` + 2 collapsed System subgroups, icon set unified (Heroicons outline 1.75 stroke), active `#eff6ff`→ `rgba(102,126,234,0.10)` to honor admin purple. | Patch existing 1211 LOC incrementally / keep blue #3b82f6 | Incremental patch leaves dead `data-page` entries and 15 `aria-expanded` sections; blue `#3b82f6` violates `CLAUDE.md` brand contract. |
| **Subnav fate** | Deprecate 12-file subnav system for Hub-internal tabs; keep `universal-nav-loader.js` but simplify `SUBNAV_MAP` to 8 entries pointing only to non-Hub leaves. 20-tab Zoho horizontal scroller eliminated. | Keep 12 subnavs + add Stock Hub as 21st Zoho tab / build mega-dropdown | 20 tabs already overflow mobile; Hub tabs colocate filtered views & need no extra network fetch for subnav fragment. |
| **Design-system consolidation** | Canonical `design-system.css` as single token source; migrate `qc-ui.css` toast/modal/sheet into it; deprecate `qc-corporate.css` duplicates; add `design-tokens` comment header consumed by lint. | Introduce new CSS framework / inline Tailwind per-page / CSS-in-JS | Repo already ships `design-system.css` with Inter + tokens — leverage, don't add debt. Anti-slop checklist enforced via lint gate (`rounded-2xl` scan, `bg-clip-text` block). |
| **Deduplication strategy** | Archive, not delete: rename duplicate HTMLs to `archived/<name>.html` + 302 redirect via `public/_redirects` or server fallback, so bookmarked URLs survive. After 1 sprint, delete if no 404s in `admin_audit_logs`. | Hard-delete 40 HTML files day-1 / keep all 162 files and just hide sidebar links | Hard-delete breaks prod bookmarks before monitoring proves safety. Hiding links without archiving leaves 404 SEO rot. |
| **Staff panel split** | Staff gets **6-item** flat sidebar (Dashboard, My Work, Attendance, Salary, Customers / Stock-check as gated cards), no collapsible sections. Shared header/sidebar loader with role-switch (`ADMIN_LEVEL_ROLES` already exists in loader). | Duplicate staff-sidebar logic / keep 12+ staff sidebar sections | Staff workflow is linear (clock→tasks→stock→salary), not admin's 8 hubs. Simpler nav reduces support load. |
| **Mobile nav** | Single responsive drawer: desktop 64px icon rail + 260px flyout; mobile full drawer. Delete bottom quickbar and horizontal subnav tabs (redundant). Already partially implemented (`qc-sidebar.collapsed` icon-rail CSS lines 417–529 exist). | Keep quickbar + subnav + drawer (3 layers) / introduce bottom tab bar | Existing collapsed CSS already implements icon rail — activate it, don't add third nav. |
| **Execution order** | NAV-1 tokens → NAV-2 sidebar/header → NAV-3 Hub consolidation (Stock verified, then Salary, CRM, Catalog, Work, WhatsApp, Painters) → NAV-4 responsive polish. Vertical slices ship behind feature-flag (`?nav=v2` or `localStorage.nav2=1`) until sign-off. | Big-bang replace all 162 pages / per-page cosmetic PRs | Feature-flagged vertical slices keep prod revertible; big-bang risks Zoho sync regressions undetectable until month-end. |

---

## Recommended Approach

**Architecture retained:** `server.js → routes/*.js` (pool-injected) + `public/*.html` (static + Tailwind JIT) + `public/components/*.html` fragments loaded by `universal-nav-loader.js`. No framework migration.

**Evolution, not revolution:**

1. **Tokens first:** Consolidate `design-system.css` — correct `--color-primary` to actual brand (`#667eea` admin, but keep CSS custom properties for both themes via `[data-theme="staff"]` override), document spacing/typography/card/table/empty/toast primitives. Add stylelint rule banning anti-slop patterns (`purple→blue hero`, `bg-clip-text`, `glassmorphism`, `rounded-2xl` everywhere, `Inter` as sole type scale).
2. **Nav shell second:** Rewrite sidebar to 8 hubs, refactor `universal-nav-loader.js` (shrink `COMPONENT_JS` map, `SUBNAV_MAP`, add `HUB_MAP` for hub→tab routing). Preserve `data-page` contract — every old `data-page` still resolves (redirects to hub tab via hash `#tab=...`) so legacy links don't 404.
3. **Hub consolidation third:** Per-domain, merge N pages → 1 Hub HTML (copy Stock Hub tab/section pattern: `tabs` + `section` + `fetch + brand/category filters + bulk selection bar`). Archive old pages behind redirect, keep API/routes untouched.
4. **Polish last:** Responsive icon-rail activation, keyboard nav, `prefers-reduced-motion`, focus rings, skeleton loaders (`skeletons.css` already exists) wired consistently.

**Anti-slop posture (bundled:taste filter):** No `bg-clip-text` headlines, no purple-to-blue full-page hero, no cream `#faf8f4` background, no aurora/glass, no identical 3-card lucide grids, no `rounded-2xl` on every card (use `10px` primary, `8px` secondary), no `hover:scale-105`, no emoji icons, no left-border accent nesting.

---

## Work Plan

### Phase 0 — Prep & Instrumentation (0.5 day)

| Unit | Content | Files | Validation |
|---|---|---|---|
| 0.1 Audit artifact | Publish this plan to `docs/plans/2026-08-07-business-manager-ia-redesign.md` and `.agents/plans/` mirror | `docs/plans/…` | `ls docs/plans` — file exists |
| 0.2 Link inventory | Generate `docs/audits/nav-inventory-2026-08-07.csv` (page, data-page, sidebar section?, subnav?, route file, orphan?) from `grep data-page` + sidebar grep already done; mark 40 archive candidates | script → `docs/audits/` | `wc -l nav-inventory.csv == 162` |
| 0.3 Feature flag | Add `localStorage.nav2` gate in `universal-nav-loader.js` (if `1` → load v2 sidebar, else v1) — allows incremental QA on same deploy | `public/universal-nav-loader.js`, `public/components/sidebar-v2.html` (new) | `?nav=v2` toggles sidebar without restart |

### Phase 1 — Design System Consolidation (NAV-1, 1 day)

| Unit | Content | Files | Validation |
|---|---|---|---|
| 1.1 Token correction | `design-system.css`: set `--color-primary: #667eea` (admin), `--color-primary-dark: #5a67d8`, add `[data-theme="staff"] { --color-primary: #1B5E3B }`, document spacing `(--space-1..8)`, radii (`--radius-card:10px`, `--radius-pill:999px`), shadows, type scale. Remove duplicate palette from `qc-corporate.css` (import tokens). | `public/css/design-system.css`, `public/css/qc-corporate.css` | Visual: admin pages `#667eea` accents, staff `#1B5E3B` — screenshot diff |
| 1.2 Primitives pass | Unify card/table/header/empty/skeleton/toast styles under tokens; migrate `qc-ui.css` modal/toast variables to use tokens; add `.qc-page-header`, `.qc-card`, `.qc-table`, `.qc-empty` canonical classes. | `public/css/qc-ui.css`, `public/css/skeletons.css`, `public/css/zoho-common.css` | `npm run lint` 0 errors; grep `rounded-2xl` → 0 hits outside design-system |
| 1.3 Lint gates | Add `stylelint` (or eslint css plugin) rules banning `bg-clip-text`, `glassmorphism` (`backdrop-blur` + `rgba` combo), `hover:scale-105` per taste checklist. | `.stylelintrc.json` or `eslint.config.js` | `npm run lint` flags intentional slop fixture |

### Phase 2 — Nav Shell Rewrite (NAV-2, 1.5 days)

| Unit | Content | Files | Validation |
|---|---|---|---|
| 2.1 New IA map | Define canonical 8 hubs in `docs/PROJECT-IA.md` + code constant `HUBS` in `universal-nav-loader.js`. Proposed hubs: **1 Overview (Dashboards) 2 Sales (Estimates) 3 Catalog (Products) 4 CRM (Leads+Customers) 5 Operations (Stock+Zoho) 6 HR & Work (Attendance+Tasks+Salary) 7 Growth (WhatsApp+Painters+Engineers) 8 System (Settings+Health+Guides)** — exact labels Tamil/English gated by `i18n`. | `docs/PROJECT-IA.md`, `public/universal-nav-loader.js` | Sidebar has 8 rows, not 15 |
| 2.2 Sidebar rewrite | `public/components/sidebar-complete.html` 1211→~380 LOC: 8 `qc-nav-item` + 2 system submenus (collapsed), unified Heroicons outline, `data-hub` attr, active via `HUBS.find(hub.pages.includes(data-page))`. Preserve `data-roles`/`data-requires` filtering. Keep icon-rail collapsed CSS already present. | `public/components/sidebar-complete.html` | Screenshot 1280px (rail+labels) + 390px (drawer overlay), axe keyboard nav |
| 2.3 Staff sidebar simplification | `public/components/staff-sidebar.html` 877→~250 LOC: flat 6 items, no collapse, gated cards for Stock-check/Collections rendered as `qc-card` grid, not sidebar items | `public/components/staff-sidebar.html` | Staff login shows 6 rows, no admin links leak |
| 2.4 Loader simplification | `public/universal-nav-loader.js`: add `HUB_MAP` (old data-page → `hub.html#tab=...`), shrink `SUBNAV_MAP` to leaves only, remove 12 subnav fetches where hub-internal tabs replaced them. Keep `COMPONENT_JS` map but only 3 entries (header + 2 sidebars). | `public/universal-nav-loader.js`, `public/js/nav/*.js` | `grep SUBNAV_MAP` → 8 entries, network tab shows 1 fragment fetch not 4 |
| 2.5 Header polish | `public/components/header-v2.html` — unify search/breadcrumb/avatar, remove duplicate per-page headers that replicate header title. | `public/components/header-v2.html`, `public/js/nav/header-v2.js` | No page shows double header |

### Phase 3 — Hub Consolidation (NAV-3, 3–4 days, per-hub vertical slices)

Each hub slice: new `admin-<hub>.html` (≈60KB pattern from Stock Hub), archive old pages, wire redirects,QA per Hub.

| Slice | New Hub file | Archives (to `archived/`) | Tabs inside Hub |
|---|---|---|---|
| **3.0 Stock (verify)** | `admin-stock-hub.html` (already 65KB, 6 tabs) — no rewrite, just prune sidebar duplications (`admin-zoho-stock`, `admin-stock-check`, `admin-stock-migration` → redirect to `#tab=...`) | `admin-zoho-stock.html`, `admin-stock-check.html`, `admin-stock-migration.html`, `admin-zoho-stock-adjust.html` | Overview/Levels/Reorder/Checks/Migrate/Dead + brand/category filters (done) |
| **3.1 Salary** | `admin-salary-hub.html` (new) | `admin-salary-{config,monthly,payments,advances,reports}` + `admin-salary-incentives.html` | Config · Monthly · Payments · Advances · Reports (Incentives as sub-tab of Monthly) |
| **3.2 CRM** | `admin-crm-hub.html` (new) | `admin-leads.html`, `admin-lead-scoring.html`, `admin-design-requests.html`, `admin-customers.html`, `admin-customer-types.html`, `admin-credit-limits.html` | Leads · Customers · Credit · Design |
| **3.3 Catalog** | `admin-catalog-hub.html` (new) | `admin-products.html`, `admin-brands.html`, `admin-categories.html`, `admin-item-master.html`, `admin-painter-catalog.html`, `admin-engineer-catalog.html` | Products · Brands · Categories |
| **3.4 Work** | `admin-work-hub.html` (new) | `admin-tasks.html`, `admin-daily-tasks.html`, `admin-attendance.html`, `admin-activity-monitor.html`, `admin-geofence-logs.html` | Tasks · Daily · Attendance · Logs |
| **3.5 Growth — Comm** | `admin-growth-hub.html` (new, covers WhatsApp + Painters + Engineers) *or split 3.5a WhatsApp hub, 3.5b Painters/Engineers if Growth too fat* | `admin-wa-*` (7), `admin-painter-*`, `admin-engineers.html` | WhatsApp: Inbox/Contacts/Campaigns/Templates · Painters · Engineers (or separate hubs) |
| **3.6 Ops — Zoho Books** | `admin-zoho-hub.html` (new) | `admin-zoho-{invoices,transactions,collections,bulk-jobs,reports,gst-reports,expenses,salesorders,expenses?}` | Invoices · Transactions · Collections · Reports |
| **3.7 System** | `admin-system-hub.html` (new) | `admin-{reports,settings,website,guides,ai,system-health,bug-reports,anomalies,monitoring,photos,live-dashboard}` | Settings · Health · Monitoring · Guides |

Per-slice validation: hub loads, each tab mocks its API (or real if seeded), redirects for archived pages 302 to hub tab, `data-page` legacy bookmarks still resolve (tested via `fetch(href).status`), sidebar active highlights correctly when deep-linking `?tab=`.

*Delete vs Archive gate:* routes (`routes/*.js`) stay; only HTML files move to `archived/`. Add `archived/README.md` explaining tombstone. After 1 sprint, check `admin_audit_logs` + server `access.log` for hits to `/archived/*`; zero hits → hard delete in cleanup PR.

### Phase 4 — Responsive & Polish (NAV-4, 1 day)

| Unit | Content | Files |
|---|---|---|
| 4.1 Icon rail activation | Wire `collapsed` toggle to persist in `localStorage.sidebarCollapsed`; desktop 64px rail with tooltip, hover expands to 260px. Remove bottom quickbar (`qc-quickbar-*`) — logic already in CSS but unused. | `public/components/sidebar-complete.html`, `public/js/nav/sidebar-complete.js` |
| 4.2 Motion & a11y | Add `prefers-reduced-motion` media guard around `transition: 0.35s`; ensure tab `role="tablist"` + keyboard arrow nav; focus rings use `--color-primary`. | `public/css/design-system.css`, hub HTMLs |
| 4.3 Skeletons & empty states | Replace ad-hoc loading spinners with `skeletons.css` patterns (`.skeleton` shimmer) consistently per hub. | hub HTMLs, `public/css/skeletons.css` |
| 4.4 Final audit | Headless Chromium playthrough: 8 admin hubs + 6 staff views, FPS ≥55, tab-switch ≤800ms, axe no critical violations. | — (QA report) |

---

## Validation Plan

| Gate | Command / Check | Expected |
|---|---|---|
| Lint | `npm run lint` | 0 errors (warnings tolerated). Also `npx stylelint "public/css/**/*.css"` if added |
| Unit tests | `npm test` / `npm run test:coverage` | All existing `tests/unit/*pricing/salary/painter-points/dpl` green — nav changes must not regress money paths |
| Nav inventory | `node scripts/nav-audit.js` (new, or `grep data-page`) | 162 files → hubs coverage 100% legacy `data-page` resolves via `HUB_MAP` |
| Redirects | `curl -I https://act.qcpaintshop.com/admin-zoho-stock.html` etc. for each archived page | `302 → /admin-stock-hub.html#tab=...` |
| Visual | Headless Chromium (local `127.0.0.1:8282`) playthrough over 8 hubs: goto hub → tabs → brand/category filter → search → empty state screenshot per hub | Screenshots show single header, 8-row sidebar, no purple staff leakage; FPS ≥55 |
| Mobile | `page.setViewport({width:390,height:844})` drawer open/close + no horizontal tab scroller | Drawer overlays, body locked, no quickbar |
| Rollback readiness | `git tag nav-v1-$(date +%F)` before Phase 2, feature-flag revert `localStorage.nav2=0` | One toggle restores old sidebar |

Highest-risk validation: **legacy bookmark redirects + `data-page` active highlighting** — every archived page's `data-page` value must still highlight the correct Hub tab after redirect; missed mapping = silent 404 UX.

---

## Risks / Rollback

| Risk | Mitigation |
|---|---|
| 80+ links collapse to 8 hubs — power users lose muscle memory | Keep 302 redirects + deep-link `#tab=` so old URLs still land on correct tab. Add in-app "Where did X go?" banner week 1. |
| Zoho stock correctness confusion (system_qty vs branch_item_sales) | Hub tabs reuse **same** `GET /api/zoho/stock/*` + `GET /api/zoho/reorder/*` endpoints — no sync logic changed; mark hub read-only until QA signs `stock_on_hand*zoho_rate` drift acceptance. |
| Staff leaks admin pages during sidebar simplification | `data-roles` + server `requireAuth/requirePermission` gates remain; nav hide is defense-in-depth only. QA as both `admin` and `staff` roles. |
| Tailwind JIT purge removes hub tab CSS if class names dynamic | Classes are static in hub HTMLs (`hidden`, `qc-card`, `qc-tab-active`) — keep Tailwind safelist in `tailwind.config.js` |
| CSP `unsafe-inline` removal later breaks inline hub scripts | All new hubs load data via external `public/js/nav/*.js` pattern (CSP-legal) — no inline `<script>` per page except trivial `data-page` bootstrap. |
| Big HTML count reduction hits SEO (if any public pages indexed) | Only `/admin-*` and `/staff/*` are behind auth; set `X-Robots-Tag: noindex` unchanged, so safe. |

Rollback: `git revert` to tag `nav-v1-…` + flip `localStorage.nav2=0`. Since no DB migration in this plan, rollback is file-only (`git checkout -- public/components/`).

---

## Open Questions

1. **IA labels:** Keep English sidebar labels or switch to Tamil-first labels? `CLAUDE.md` says UI guidance is Tamil, commits English — propose English code labels + Tamil subtitle in hub headers (to confirm before Phase 2).
2. **Hub split for Growth:** Single `admin-growth-hub.html` (WhatsApp + Painters + Engineers) vs two hubs (`admin-wa-hub.html` + `admin-partners-hub.html`)? Painters/Engineers are distinct personas — owner preference needed before slice 3.5.
3. **Archived pages retention:** How many sprints to keep `archived/` before hard delete — 1 sprint (2 weeks) ok or keep 1 quarter for audit?
4. **Public (non-admin) pages:** `painter-*`, `engineer-*`, `customer-*` portals — in scope for same polish or explicitly out? This plan scopes them OUT to avoid 3x blowup; confirm.
5. **Branches vs Zoho Locations naming:** Rename sidebar "Branches" to "Stores" or keep both terms? Production DB uses `branches` + `zoho_locations` separately — confirm UX term.
