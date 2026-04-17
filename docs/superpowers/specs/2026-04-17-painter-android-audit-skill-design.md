# Painter Android Audit Skill — Design Spec

**Date**: 2026-04-17
**Status**: Approved design, awaiting implementation plan
**Author**: Claude Opus 4.7 + sharjoon1

## Goal

Create a reusable Claude Code skill that audits the painter Android app (`qcpaintshop-android` repo, `painter` flavor) before every Play Store release. The skill performs static analysis + APK build verification + backend cross-check against `act.qcpaintshop.com` routes, then auto-fixes P0/P1 issues and proposes P2 quality fixes for user approval.

## Scope Decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Audit method | Static analysis + APK build | Catches compile-time issues; runtime testing deferred to user's manual device testing |
| Skill reusability | Permanent, runs before every Play Store release | Painter app ships frequently (v2.0 → v3.0 in 10 days); regression prevention valuable |
| Fix severity threshold | P0/P1 auto-fix, P2 propose-batch | Auto-fix risky without bounds; quality fixes are subjective |
| Backend validation | Android + Backend cross-check (routes/painters.js) | Silent data bugs are the biggest risk category per memory learnings |
| Architecture | Modular skill (SKILL.md + references/ + scripts/) | Scales with growing bug-pattern library; matches `buybmat-android-dev` pattern |

## Skill Location

```
C:\Users\Hiii\.claude\skills\painter-android-audit\
```

User-level skill (not project-scoped). Consistent with existing `buybmat-android-dev` and `buybmat-android-design` skills.

## File Layout

```
painter-android-audit/
├── SKILL.md                          Orchestrator (~180 lines)
├── references/
│   ├── audit-checklist.md            50+ checks across 7 categories
│   ├── known-bug-patterns.md         Painter-specific regex patterns + recipes
│   ├── backend-crosscheck.md         How to diff Android vs backend
│   └── fix-playbooks.md              Per-category auto-fix recipes
└── scripts/
    ├── extract-android-endpoints.sh  @GET/@POST/@PUT/@DELETE → structured list
    ├── extract-backend-routes.sh     router.(get|post|put|delete) → structured list
    └── build-painter-apk.sh          gradlew assemblePainterRelease with logging
```

Each reference file ≤ 300 lines. Scripts are bash (git-bash on Windows).

## 4-Phase Workflow

### Phase 1 — Discover (~2 min)
- `git log --oneline -30` in painter-android repo (context for what changed recently)
- `scripts/extract-android-endpoints.sh` → list of Android API calls with path/method/params
- `scripts/extract-backend-routes.sh` → list of backend routes
- Baseline build check: confirm app builds cleanly before audit starts
- **If baseline build fails**: skill aborts immediately with the build log — user must fix the pre-existing break before audit runs. Skill never tries to fix a broken baseline.
- **Output**: `audit-findings/YYYY-MM-DD/01-discovery.md`

### Phase 2 — Static Analysis (~10 min)
- Apply every pattern in `known-bug-patterns.md` via grep across .kt files
- Parse every `@SerializedName`, data class field nullability, API param types
- Check `AppNavigation.kt` for duplicate routes
- Verify every `@HiltViewModel` has matching `@Provides` in `AppModule.kt`
- **Output**: `audit-findings/YYYY-MM-DD/02-static.md` (findings: file:line, severity, suggested fix)

### Phase 3 — Backend Cross-Check (~5 min)
- Diff Android endpoint list vs backend route list
- For each matching pair: compare HTTP method, query/body param types, response shape vs Android data class
- Flag orphaned Android calls (backend missing endpoint) — **P0** (call will 404 at runtime)
- Flag orphaned backend routes (Android not consuming them yet) — **P2** informational (may be intentional WIP)
- Flag type mismatches (e.g., backend expects String, Android sends Int) — **P1**
- **Output**: `audit-findings/YYYY-MM-DD/03-backend.md`

### Phase 4 — Build Verification (~5 min)
- Run `scripts/build-painter-apk.sh`
- Parse gradle output: Kotlin compile errors, deprecation warnings, R8 issues, missing resources
- **Output**: `audit-findings/YYYY-MM-DD/04-build.md`

### Report + Fix
- Aggregate phases into `audit-findings/YYYY-MM-DD/SUMMARY.md`
- Categorize by severity: P0, P1, P2
- Present summary to user at **Gate 1** (mandatory pause)
- Auto-fix P0/P1 with deterministic recipes from `fix-playbooks.md`
- Present P2 list at **Gate 2** (mandatory pause) for batch approval
- Re-run build after fixes → `audit-findings/YYYY-MM-DD/FIXES-APPLIED.md`

## Audit Dimensions — 7 Categories

### 1. Data Layer (12 checks) — P0/P1
- Data class fields match backend JSON (name, nullability, type)
- Int/String mismatches for IDs (zoho_item_id known issue)
- Missing `@SerializedName` for snake_case backend fields
- Gson silent-null failures on non-nullable fields
- Response wrapper consistency (`ApiResponse<T>` vs raw `T`)
- Pagination response shape
- Date/time parsing (ISO vs epoch)
- Enum status string mapping
- List vs single-object confusion
- Money field types (Double vs BigDecimal vs paise Int)
- Boolean coercion (0/1, "yes"/"no")
- Empty-string vs null handling

### 2. Network Layer (7 checks) — P0/P1
- Every API interface route matches backend (method + path)
- Query param types (brand is String not Int — memory learning)
- Path param vs query param correctness
- Request body matches backend Zod validation schema
- `X-Painter-Token` header present on all painter endpoints
- Base URL consistency
- Retrofit converter order

### 3. UI / Compose (10 checks) — P1/P2
- Deprecated Material3 APIs (`tabIndicatorOffset`, bare `menuAnchor()`)
- LazyColumn missing `key()` on dynamic lists
- `collectAsStateWithLifecycle` usage
- Hardcoded colors not using QCGreen/QCGold theme tokens
- `remember` missing for expensive computations
- State hoisting violations
- Missing loading/error states on async screens
- Navigation route duplicates
- Deep link registrations
- Back-handler on non-top screens

### 4. DI / Hilt (4 checks) — P0
- Every `@HiltViewModel` has all deps `@Provides`-ed in `AppModule`
- 17 API interfaces all bound
- No circular dependencies
- `@Singleton` vs `@ViewModelScoped` correctness

### 5. Build Health (6 checks) — P0
- APK compiles without errors
- No unresolved symbols
- Kotlin version consistency
- ProGuard/R8 keep rules for Retrofit/Gson models
- Manifest permissions match feature use
- `versionCode` > last Play Store release (prerequisite, not enforced)

### 6. Painter-Specific Logic (8 checks) — P1
- OTP auth: token storage + header injection
- FCM token registered on login
- Points display: regular vs annual pool correctness
- Loyalty level thresholds (3K/5K/10K) match backend
- Referral code generation + deep link
- Card regeneration triggers on profile update
- Tamil/English toggle persistence
- Notification deep link routing (payload type → correct screen)

### 7. Release Readiness (5 checks) — P1
- `versionCode` incremented since last Play Store release
- `versionName` follows semver
- Telegram upload script works (`--dry-run` test)
- APK size under ~15MB
- Mapping file generated for crash symbolication

**Severity assignment rules**:
- **P0** (auto-fix): Build-breaking, null crashes, missing DI bindings, nav duplicates
- **P1** (auto-fix): Data mismatches, API type errors, missing @SerializedName, deprecated APIs with safe drop-in replacement, missing auth headers
- **P2** (propose): Hardcoded strings, missing loading states, color inconsistencies, unused imports, Tamil translation gaps

## Fix Policy

### Auto-fix (P0/P1)
- Group findings by category, apply fix from `fix-playbooks.md`
- Deterministic Edit/MultiEdit only — **never** AI-generated fixes for critical paths
- After each category batch, re-run build check
- If build breaks, rollback via git reset; do not retry silently
- Live tally reported to user: "Fixed 12/15 P0, 8/20 P1, build still green"
- **If a P0/P1 finding has no matching recipe in `fix-playbooks.md`**: skill does NOT attempt to fix it. Finding moves to "Manual Review Required" section of SUMMARY.md with full context. User decides the fix.

**Example fix recipes** (from `fix-playbooks.md`):
```
Pattern: data class field `val zohoItemId: Int`
Fix: change to `val zohoItemId: String?`, add @SerializedName("zoho_item_id") if missing
Files matched: **/data/remote/dto/*.kt

Pattern: ExposedDropdownMenuBox with bare .menuAnchor()
Fix: replace with .menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled = true)
Import: androidx.compose.material3.ExposedDropdownMenuBoxScope.MenuAnchorType

Pattern: Coil 2.x image.toBitmap()
Fix: (result.drawable as BitmapDrawable).bitmap
```

### Propose-batch (P2)
1. Write `audit-findings/YYYY-MM-DD/PROPOSED-FIXES.md` with numbered items
2. Each item: file:line, description, exact diff preview
3. Skill pauses: `Apply all N? Or pick subset? (all / 1,3,7 / none)`
4. Apply user's selection only

### Approval Gates
- **Gate 1** (mandatory): After phases 1-4, before any fix. Summary counts.
- **Gate 2** (mandatory): Before P2 batch apply. User picks subset.
- **Gate 3** (conditional): If uncommitted changes detected in painter-android repo → pause, ask user to stash/commit first.
- **Gate 4** (conditional): If any fix causes build break → pause with log excerpt, ask for guidance. Never loop blindly.

### Rollback Safety
- Skill creates audit branch at start: `git checkout -b audit/YYYY-MM-DD`
- Each category = separate commit for granular revert
- On user rejection: `git checkout master && git branch -D audit/...`

### Commit Policy
- Skill does NOT push to remote
- Skill does NOT bump versionCode/versionName
- Commit format: `fix(painter-audit): <category> — <count> issues`

## Report Format

### Findings Folder
```
qcpaintshop-android/audit-findings/2026-04-17/
├── SUMMARY.md
├── 01-discovery.md
├── 02-static.md
├── 03-backend.md
├── 04-build.md
├── PROPOSED-FIXES.md
├── FIXES-APPLIED.md
└── build-log-final.txt
```

Gitignored. Timestamped per audit. User can compare runs over time.

### SUMMARY.md Template
```markdown
# Painter Android Audit — YYYY-MM-DD

**Result**: Ready for release / N P0 issues blocking / Fixed M, K need review

## Counts
| Severity | Found | Auto-fixed | Manual review |
|----------|-------|-----------|---------------|
| P0       | x     | x         | x             |
| P1       | x     | x         | x             |
| P2       | x     | 0         | x (proposed)  |

## P0/P1 Auto-fixed (highlights)
- [commit SHA] Fixed N Gson nullable crashes in X
- [commit SHA] Added M missing @SerializedName
- ...

## Manual Review Required
1. file:line — description
2. ...

## Build
- Pre-audit: ✅/❌ (baseline)
- Post-fix: ✅/❌, N errors, M deprecation warnings

## Next Steps
- [ ] Review manual items
- [ ] Decide on P2 fixes (see PROPOSED-FIXES.md)
- [ ] Bump versionCode before Play Store upload
```

## Skill Entry Behavior

On invoke:
- Name: `painter-android-audit`
- Description: "Audit painter Android app before Play Store release — static analysis + build verification + backend cross-check. Run before every release."
- Reads latest `audit-findings/` folder; if < 24h old, offers to continue
- Opening banner:
  ```
  🔍 Painter Android Audit starting...
  App: qcpaintshop-android/app/src/painter (vX.Y.Z versionCode N)
  Backend: act.qcpaintshop.com routes/painters.js + routes/painter-marketing.js
  Estimated time: 25 min. Mandatory approval gates: 2 (plus up to 2 conditional).
  ```

## Skill Exit Behavior

- Clean completion: offers to open `SUMMARY.md`
- Build break: leaves rollback instructions, does not auto-rollback
- Writes `last-audit-ref.txt` with commit SHA + timestamp for next-run comparison

## Memory/Pattern Growth

- After audit, if new bug pattern found (not in `known-bug-patterns.md`):
  - Skill proposes addition at end of run
  - User confirms → skill appends to `references/known-bug-patterns.md`
- Skill does NOT update user's auto-memory (`C:\Users\Hiii\.claude\projects\...\memory\`) — skill is self-contained
- Over time the skill's `known-bug-patterns.md` becomes the canonical list of painter-specific foot-guns

## Skill Hand-offs (to avoid re-implementing)

- Blocker debugging → `superpowers:systematic-debugging`
- Claim-of-completion verification → `superpowers:verification-before-completion`
- Multi-step plan creation (if audit uncovers large refactor) → `superpowers:writing-plans`

## Testing Strategy

- First real run on painter-android repo serves as integration test
- Skill considered working if audit completes without crashing itself
- No unit tests for skill logic (YAGNI — skill is orchestration + file I/O)

## Out of Scope

- Runtime device testing (requires ADB + phone, user's manual step)
- Staff/customer flavor audit (WebView-based, separate skill if needed)
- Backend refactoring (skill only flags, doesn't rewrite routes/painters.js)
- Auto-incrementing versionCode (user's conscious decision per release)
- CI/GitHub Actions integration (can be added later, not in scope now)

## Known Initial Bug Patterns (seed for `known-bug-patterns.md`)

From memory's painter app learnings (to be encoded at skill creation):

1. **Gson Int-that-should-be-String**: `zoho_item_id`, `painter_id` overflow Int → use `String?`
2. **Gson missing field → whole object null**: Use `String?` for ID fields from Zoho
3. **@SerializedName for snake_case**: backend sends `product_id`, Android field `productId`
4. **Coil 2.x API**: `image.toBitmap()` removed, use `(result.drawable as BitmapDrawable).bitmap`
5. **Material3 `tabIndicatorOffset`**: removed in newer versions, use default indicator
6. **ExposedDropdownMenuBox `.menuAnchor()`**: deprecated, use `MenuAnchorType` overload
7. **minSdk 24 calendar**: use `java.util.Calendar` not `java.time.YearMonth`
8. **CatalogApi brand/category params**: must be `String?` not `Int?` (name strings, not IDs)
9. **PackSize SQL sort**: string-sort bug, already fixed backend-side (`CAST(ps.size AS DECIMAL)`)
10. **ProductDetail.id**: backend sends `product_id` → needs `@SerializedName("product_id")`
11. **ProductVariant.id**: must be `String?` (Zoho long numeric string overflows Int)
12. **AppNavigation duplicates**: multiple agents editing same file → verify no conflicting routes
13. **Search chip pattern**: needs explicit close mechanism (no click-outside-to-dismiss in Compose)
14. **Hilt missing bindings**: new ViewModel deps added without `@Provides` → runtime crash
15. **FCM token registration**: must register for painter auth in addition to staff/customer (fixed in commit c86aab1)

## Terminal State

This spec ends here. Next step: invoke `superpowers:writing-plans` to create the implementation plan for building this skill.
