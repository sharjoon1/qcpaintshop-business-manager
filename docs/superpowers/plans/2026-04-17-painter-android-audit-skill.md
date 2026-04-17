# Painter Android Audit Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable user-level Claude Code skill (`painter-android-audit`) that audits the painter Android app before every Play Store release: static analysis, APK build verification, backend cross-check against `routes/painters.js`, then auto-fixes P0/P1 issues and proposes P2 fixes.

**Architecture:** Modular skill at `C:\Users\Hiii\.claude\skills\painter-android-audit\` following the same pattern as the existing `buybmat-android-dev` skill — SKILL.md orchestrator + `references/` markdown knowledge base + `scripts/` bash helpers. The skill drives a 4-phase workflow (Discover → Static → Backend → Build) with two mandatory approval gates. Skill files are **not** git-tracked (live in user home); only the plan + spec commit to the qcpaintshop.com repo.

**Tech Stack:** Markdown (SKILL.md + references), bash scripts run via git-bash on Windows, grep/sed for extraction, gradle for APK build. No runtime dependencies beyond a local Claude Code environment.

**Target app repo:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\` (flavor `painter`, package `com.qcpaintshop.painter`)
**Target backend:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com\routes\painters.js` and `routes/painter-marketing.js`

---

## File Structure

Files to create under `C:\Users\Hiii\.claude\skills\painter-android-audit\`:

| Path | Purpose | Approx size |
|---|---|---|
| `SKILL.md` | Orchestrator — 4-phase workflow, gates, rollback policy | 180 lines |
| `references/audit-checklist.md` | 50+ static checks across 7 categories with severity | 250 lines |
| `references/known-bug-patterns.md` | 15 seed regex patterns + paired fix recipes | 220 lines |
| `references/backend-crosscheck.md` | Endpoint/type diff methodology | 120 lines |
| `references/fix-playbooks.md` | Deterministic Edit-recipes per bug category | 200 lines |
| `scripts/extract-android-endpoints.sh` | Parses Retrofit interfaces → TSV: method, path, interface, params | 40 lines |
| `scripts/extract-backend-routes.sh` | Parses `router.<verb>(...)` → TSV: method, path, middleware | 35 lines |
| `scripts/build-painter-apk.sh` | Wraps `gradlew assemblePainterRelease` with logging | 25 lines |

Files to create/update in this project repo:

| Path | Purpose |
|---|---|
| `docs/superpowers/plans/2026-04-17-painter-android-audit-skill.md` | This plan (created by writing-plans skill) |

No files modified in production code. No runtime migrations. No dependency changes.

---

## Task 1: Create skill directory skeleton

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\`
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\references\`
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\scripts\`

- [ ] **Step 1: Verify parent exists and no stale folder present**

Run:
```bash
ls "C:/Users/Hiii/.claude/skills/"
```
Expected: lists `buybmat-android-design` and `buybmat-android-dev`; NO `painter-android-audit` entry. If `painter-android-audit` already exists, stop and ask the user whether to overwrite — do not proceed.

- [ ] **Step 2: Create the three folders**

Run:
```bash
mkdir -p "C:/Users/Hiii/.claude/skills/painter-android-audit/references" \
         "C:/Users/Hiii/.claude/skills/painter-android-audit/scripts"
```

- [ ] **Step 3: Verify structure**

Run:
```bash
ls -la "C:/Users/Hiii/.claude/skills/painter-android-audit/"
```
Expected: two subdirs `references` and `scripts`, no files yet.

- [ ] **Step 4: No commit**

Skill files live outside any git repo. The only commit for this plan happens at Task 10.

---

## Task 2: Write `scripts/extract-android-endpoints.sh`

**Purpose:** Parse every Retrofit annotation (`@GET`, `@POST`, `@PUT`, `@DELETE`, `@PATCH`) in the painter flavor, emit TSV `METHOD<TAB>PATH<TAB>INTERFACE_FILE<TAB>FUNCTION`.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\scripts\extract-android-endpoints.sh`

- [ ] **Step 1: Manually sanity-check real input first**

Run:
```bash
grep -n "@GET\|@POST\|@PUT\|@DELETE\|@PATCH" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AuthApi.kt"
```
Expected: at least one line like `    @POST("api/painters/auth/request-otp")` or similar. This confirms the grep pattern will find real annotations. If no output, stop and inspect the file manually before continuing.

- [ ] **Step 2: Write the script**

Content of `scripts/extract-android-endpoints.sh`:
```bash
#!/usr/bin/env bash
# extract-android-endpoints.sh
# Parses Retrofit annotations in the painter flavor and emits a TSV stream.
# Columns: METHOD<TAB>PATH<TAB>INTERFACE_FILE<TAB>FUNCTION_NAME
# Usage: ./extract-android-endpoints.sh <painter-flavor-root>
# Example: ./extract-android-endpoints.sh "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter"

set -euo pipefail

ROOT="${1:?usage: extract-android-endpoints.sh <painter-flavor-root>}"

if [[ ! -d "$ROOT" ]]; then
  echo "error: $ROOT is not a directory" >&2
  exit 1
fi

# Find every .kt file that declares a Retrofit annotation. awk walks each file
# and, when it sees an @VERB("path"), looks ahead for the suspend/fun line.
grep -rln --include='*.kt' -E '@(GET|POST|PUT|DELETE|PATCH)\(' "$ROOT" | while IFS= read -r file; do
  awk -v f="$file" '
    /@(GET|POST|PUT|DELETE|PATCH)\(/ {
      match($0, /@(GET|POST|PUT|DELETE|PATCH)\("([^"]+)"\)/, m)
      if (m[0] != "") { verb=m[1]; path=m[2]; next_fn=1; next }
    }
    next_fn && /fun [a-zA-Z0-9_]+\(/ {
      match($0, /fun ([a-zA-Z0-9_]+)\(/, f2)
      if (f2[1] != "") {
        printf "%s\t%s\t%s\t%s\n", verb, path, f, f2[1]
        next_fn=0
      }
    }
  ' "$file"
done
```

- [ ] **Step 3: Make executable + smoke-test on painter flavor**

Run:
```bash
chmod +x "C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-android-endpoints.sh"
"C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-android-endpoints.sh" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter" | head -5
```
Expected output — 5 tab-separated rows, e.g.:
```
POST	api/painters/auth/request-otp	.../AuthApi.kt	requestOtp
POST	api/painters/auth/verify-otp	.../AuthApi.kt	verifyOtp
GET	api/painters/me/dashboard	.../DashboardApi.kt	getDashboard
...
```

- [ ] **Step 4: Count total endpoints — should be in the 30-80 range**

Run:
```bash
"C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-android-endpoints.sh" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter" | wc -l
```
Expected: a number between 30 and 100. If it's 0 or 1, the awk pattern didn't match — debug before continuing. If > 150, something is double-counting.

- [ ] **Step 5: No commit** (skill files not tracked)

---

## Task 3: Write `scripts/extract-backend-routes.sh`

**Purpose:** Parse every `router.<verb>('...', ...)` in the given JS file, emit TSV `METHOD<TAB>PATH<TAB>FILE<TAB>LINE_NUMBER`.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\scripts\extract-backend-routes.sh`

- [ ] **Step 1: Write the script**

Content of `scripts/extract-backend-routes.sh`:
```bash
#!/usr/bin/env bash
# extract-backend-routes.sh
# Parses Express router definitions and emits TSV.
# Columns: METHOD<TAB>PATH<TAB>FILE<TAB>LINE_NUMBER
# Usage: ./extract-backend-routes.sh <path-to-routes-file> [<path-to-routes-file> ...]
# Example: ./extract-backend-routes.sh routes/painters.js routes/painter-marketing.js

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: extract-backend-routes.sh <file.js> [<file.js> ...]" >&2
  exit 1
fi

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "warn: $file not found, skipping" >&2
    continue
  fi
  grep -nE "router\.(get|post|put|delete|patch)\(" "$file" | while IFS=: read -r lineno rest; do
    # rest looks like: router.get('/foo/bar', requireAuth, ...
    verb=$(echo "$rest" | sed -nE "s/.*router\.(get|post|put|delete|patch)\(.*/\1/p" | tr 'a-z' 'A-Z')
    path=$(echo "$rest" | sed -nE "s/.*router\.[a-z]+\(['\"]([^'\"]+)['\"].*/\1/p")
    if [[ -n "$verb" && -n "$path" ]]; then
      printf "%s\t%s\t%s\t%s\n" "$verb" "$path" "$file" "$lineno"
    fi
  done
done
```

- [ ] **Step 2: Make executable + smoke-test on `routes/painters.js`**

Run:
```bash
chmod +x "C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-backend-routes.sh"
"C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-backend-routes.sh" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/routes/painters.js" | head -5
```
Expected — 5 tab-separated rows, e.g.:
```
POST	/auth/request-otp	routes/painters.js	42
POST	/auth/verify-otp	routes/painters.js	67
GET	/me/dashboard	routes/painters.js	110
...
```

- [ ] **Step 3: Verify count matches ~120 (from memory: 124 router calls)**

Run:
```bash
"C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-backend-routes.sh" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/routes/painters.js" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/routes/painter-marketing.js" \
  | wc -l
```
Expected: a number in the 100-180 range. If < 50, sed pattern missed something.

- [ ] **Step 4: No commit**

---

## Task 4: Write `scripts/build-painter-apk.sh`

**Purpose:** Thin wrapper around `./gradlew :app:assemblePainterRelease` that tees output to an audit log for later parsing. Exits with gradle's exit code so the SKILL.md orchestrator can branch on it.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\scripts\build-painter-apk.sh`

- [ ] **Step 1: Write the script**

Content of `scripts/build-painter-apk.sh`:
```bash
#!/usr/bin/env bash
# build-painter-apk.sh
# Runs ./gradlew :app:assemblePainterRelease from the android repo root,
# tees output to the given log path, and exits with gradle's exit code.
# Usage: ./build-painter-apk.sh <android-repo-root> <log-output-path>

set -uo pipefail  # NOTE: no -e — we want to capture gradle's exit code

REPO="${1:?usage: build-painter-apk.sh <android-repo-root> <log-output-path>}"
LOG="${2:?usage: build-painter-apk.sh <android-repo-root> <log-output-path>}"

if [[ ! -x "$REPO/gradlew" ]]; then
  echo "error: $REPO/gradlew not found or not executable" >&2
  exit 2
fi

mkdir -p "$(dirname "$LOG")"

echo "=== build start: $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee "$LOG"
( cd "$REPO" && ./gradlew :app:assemblePainterRelease --no-daemon --warning-mode all 2>&1 ) | tee -a "$LOG"
rc=${PIPESTATUS[0]}
echo "=== build end: exit=$rc ===" | tee -a "$LOG"

exit "$rc"
```

- [ ] **Step 2: Make executable + smoke-test with `--version` shortcut**

Run (confirms gradle runs at all without triggering a 5-minute full build):
```bash
chmod +x "C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/build-painter-apk.sh"
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && ./gradlew --version ) | head -5
```
Expected: Gradle version banner. Confirms the JDK and gradle wrapper work. We do NOT run the full assemble here — that's for Task 10.

- [ ] **Step 3: No commit**

---

## Task 5: Write `references/known-bug-patterns.md`

**Purpose:** Seed library of 15 painter-specific regex patterns from spec section "Known Initial Bug Patterns", each paired with the deterministic fix recipe.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\references\known-bug-patterns.md`

- [ ] **Step 1: Write the file**

Content of `references/known-bug-patterns.md`:
```markdown
# Known Bug Patterns — Painter Android App

Each entry: a bug signature (regex or AST-ish description), its severity, and a deterministic fix recipe. Severity rules follow SKILL.md.

This file is the canonical list of painter-app foot-guns learned over time. Additions go through the user-approval step documented in SKILL.md § "Pattern Growth".

---

## 1. Gson Int-that-should-be-String (P0)

**Signature:** Data class field named `zohoItemId`, `painterId`, `invoiceId`, `productId`, or `variantId` declared as `Int` / `Long` / `Int?` / `Long?`.

**Regex (multi-line):**
```
val (zohoItemId|painterId|invoiceId|productId|variantId)\s*:\s*(Int|Long)\??
```

**Why:** Zoho numeric IDs can overflow Kotlin `Int`; treat every backend-sourced ID as `String?`.

**Fix recipe:** Change type to `String?`. If no `@SerializedName` present and the backend field is snake_case, add one.

**Example fix:**
```kotlin
// BEFORE
data class Product(val zohoItemId: Int, ...)

// AFTER
data class Product(
    @SerializedName("zoho_item_id") val zohoItemId: String?,
    ...
)
```

---

## 2. Gson silent-null: non-nullable field missing from response (P0)

**Signature:** Data class field declared non-nullable but mapped from a backend field that can be absent (any `zoho_*` optional field, any computed field).

**Regex — suspicious non-null types in DTOs under `data/remote/dto/`:**
```
val [a-zA-Z0-9_]+\s*:\s*(String|Int|Long|Double|Boolean)(?!\?)
```

**Why:** If Gson cannot populate the field, the whole object becomes `null` silently — crashes at the next dereference.

**Fix recipe:** Default to nullable (`String?`, `Int?`, etc.) unless you've verified the backend always sends the field in a non-null form. For a field that is always present but sometimes empty, `String?` is still the safest choice.

---

## 3. Missing `@SerializedName` for snake_case backend fields (P1)

**Signature:** Data class camelCase field with no `@SerializedName`, where backend sends snake_case.

**Regex:**
```
^\s*(val|var)\s+[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\s*:
```
(any camelCase identifier starting with lowercase) — then look upward for a preceding `@SerializedName` annotation on the previous line.

**Fix recipe:** Add `@SerializedName("<snake_case_name>")`.

**Example:**
```kotlin
// BEFORE
val productId: String?

// AFTER
@SerializedName("product_id")
val productId: String?
```

---

## 4. Coil 2.x `image.toBitmap()` removed (P0)

**Signature:** Any call to `image.toBitmap()` or `.toBitmap()` on a Coil result.

**Regex:**
```
\.toBitmap\(\)
```

**Fix recipe:**
```kotlin
// BEFORE
val bm = result.image.toBitmap()

// AFTER
val bm = (result.drawable as BitmapDrawable).bitmap
```

Add import: `import android.graphics.drawable.BitmapDrawable`.

---

## 5. Material3 `tabIndicatorOffset` removed (P1)

**Signature:** Any reference to `TabRowDefaults.tabIndicatorOffset`.

**Regex:**
```
TabRowDefaults\.tabIndicatorOffset
```

**Fix recipe:** Use the default indicator — remove the explicit `indicator = { ... tabIndicatorOffset ... }` lambda and let `TabRow` supply its own.

---

## 6. `ExposedDropdownMenuBox` bare `.menuAnchor()` (P1)

**Signature:** Call to `.menuAnchor()` with zero args on a modifier inside an `ExposedDropdownMenuBox`.

**Regex:**
```
\.menuAnchor\(\s*\)
```

**Fix recipe:**
```kotlin
// BEFORE
Modifier.menuAnchor()

// AFTER
Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled = true)
```
Add import: `import androidx.compose.material3.ExposedDropdownMenuBoxScope.MenuAnchorType`.

---

## 7. `java.time.YearMonth` on minSdk 24 (P0)

**Signature:** Import of `java.time.YearMonth` or `java.time.LocalDate` without explicit `coreLibraryDesugaring` in `app/build.gradle.kts`.

**Regex:**
```
^import java\.time\.(YearMonth|LocalDate|LocalDateTime)
```

**Fix recipe:** Replace with `java.util.Calendar`-based arithmetic, OR verify `coreLibraryDesugaringEnabled = true` + `coreLibraryDesugaring` dependency is in `build.gradle.kts`. Prefer `Calendar` for one-off calendar math; prefer desugaring only if the file uses java.time extensively.

---

## 8. `CatalogApi` brand/category as wrong type (P1)

**Signature:** Query parameter `brand` or `category` typed as `Int?` / `Long?` in any API interface.

**Regex:**
```
@Query\("(brand|category)"\)\s+[a-zA-Z]+\s*:\s*(Int|Long)\??
```

**Why:** The backend expects the brand/category **name** as a String, not an ID.

**Fix recipe:** Change parameter type to `String?`.

---

## 9. PackSize numeric-as-string sort (P2 — backend side, informational)

**Signature:** Any client-side sort on pack size strings like "5", "10", "100" — string-sort puts "100" before "5".

**Regex:** manual — look in Compose composables for `sortedBy { it.size }` or similar on a pack-size list.

**Fix recipe:** Already fixed backend-side with `CAST(ps.size AS DECIMAL)`. If encountered client-side, `sortedBy { it.size.toDoubleOrNull() ?: 0.0 }`.

---

## 10. `ProductDetail.id` missing `@SerializedName` for `product_id` (P0)

**Signature:** In any DTO file matching `ProductDetail*.kt`, a field `val id: ...` without `@SerializedName("product_id")`.

**Regex:**
```
^\s*(val|var)\s+id\s*:\s*String
```
(in files under `data/remote/dto/`)

**Fix recipe:**
```kotlin
@SerializedName("product_id")
val id: String?,
```

---

## 11. `ProductVariant.id` as Int (P0)

**Signature:** In DTOs matching `ProductVariant*.kt`, `val id: Int` or `val id: Long`.

**Regex:**
```
ProductVariant[^\n]*val id\s*:\s*(Int|Long)\??
```

**Fix recipe:** Change to `val id: String?`.

---

## 12. `AppNavigation.kt` route duplicates (P0)

**Signature:** The same route string literal appears in two or more `composable("...")` calls in `navigation/AppNavigation.kt`.

**Regex (multiline find):** extract every `composable("<route>")` and `sort | uniq -d`.

**Fix recipe:** Manual review required — which one is the intended route? The skill flags this, does NOT auto-delete.

---

## 13. Search chip missing close mechanism (P2)

**Signature:** Any Compose `FilterChip` or `Chip` whose selected state has no accompanying close/X affordance.

**Regex:** manual review — search for `FilterChip(selected = true` and audit whether the chip includes a trailing icon or `onClose` callback.

**Fix recipe:** Add a trailing close icon:
```kotlin
FilterChip(
    selected = true,
    onClick = { onClear() },
    label = { Text(query) },
    trailingIcon = { Icon(Icons.Default.Close, null) }
)
```

---

## 14. Hilt missing `@Provides` for new ViewModel dep (P0)

**Signature:** A `@HiltViewModel` constructor injects an interface (e.g., `catalogApi: CatalogApi`) for which no `@Provides` method exists in `AppModule.kt` (or any `@Module`).

**Detection:** For each `@HiltViewModel` class, parse constructor args; for each arg type, grep for `@Provides.*<Type>` or `@Binds.*<Type>` in the `di/` folder. Flag any miss.

**Fix recipe:** Add a `@Provides` method in `AppModule.kt`. Example:
```kotlin
@Provides
@Singleton
fun provideCatalogApi(retrofit: Retrofit): CatalogApi =
    retrofit.create(CatalogApi::class.java)
```

---

## 15. FCM token not registered on painter auth (P0)

**Signature:** After painter OTP login, no call to `injectFCMToken()` or the FCM-token-to-server registration function.

**Detection:** Grep the `VerifyOtpScreen.kt` / `AuthViewModel.kt` for `injectFCMToken` or `registerFcmToken`. If not present after a successful verify, flag.

**Fix recipe:** Ensure the login success flow calls `injectFCMToken()` the same way the staff/customer flows do. Reference commit `c86aab1` for precedent.

---

## Meta — adding new patterns

When the skill encounters a bug that isn't in this list:
1. At end of audit, skill proposes the new pattern (signature + fix) in a short block.
2. User approves → append to this file, numbered in sequence, with discovery date.
3. Never silently extend this file.
```

- [ ] **Step 2: Verify the file exists and line count is reasonable**

Run:
```bash
wc -l "C:/Users/Hiii/.claude/skills/painter-android-audit/references/known-bug-patterns.md"
```
Expected: 200-260 lines.

- [ ] **Step 3: Spot-check one pattern by running its regex**

Run (tests pattern 4 on painter flavor):
```bash
grep -rn --include='*.kt' '\.toBitmap()' \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter" || echo "no matches (OK)"
```
Expected: either real matches with file:line, or "no matches (OK)". Confirms the regex is grep-compatible.

- [ ] **Step 4: No commit**

---

## Task 6: Write `references/audit-checklist.md`

**Purpose:** The 50+ check list across 7 categories from spec section "Audit Dimensions". Each check: an ID, category, description, severity, detection method.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\references\audit-checklist.md`

- [ ] **Step 1: Write the file**

Content of `references/audit-checklist.md`:
```markdown
# Audit Checklist — Painter Android App

52 checks across 7 categories. Each check has an ID (e.g. `DATA-03`), a description, a severity, and a detection hint (regex / file / method).

Severity legend:
- **P0** — Blocks release. Auto-fixed if recipe exists in `fix-playbooks.md`, otherwise flagged for manual review.
- **P1** — Should fix before release. Same policy as P0.
- **P2** — Quality. Proposed in batch, user picks subset.

---

## Category 1 — Data Layer (12 checks)

| ID | Check | Severity | Detection |
|---|---|---|---|
| DATA-01 | Every DTO field present in backend response maps 1:1 by name (or has `@SerializedName`) | P1 | Parse DTO vs a sample backend response; diff by field |
| DATA-02 | ID fields (`zoho_*_id`, `painter_id`, `invoice_id`) typed `String?` not `Int/Long` | P0 | Pattern 1 in known-bug-patterns.md |
| DATA-03 | `@SerializedName` present on every camelCase field that maps to snake_case backend | P1 | Pattern 3 in known-bug-patterns.md |
| DATA-04 | Non-nullable field must be guaranteed present in backend response | P0 | Pattern 2 in known-bug-patterns.md |
| DATA-05 | Response wrapper consistent — `ApiResponse<T>` where backend returns `{success, data}` | P1 | Look for `Call<T>` that should be `Call<ApiResponse<T>>` |
| DATA-06 | Pagination DTO matches backend shape (`items`, `total`, `page`) | P1 | Grep for paginated endpoints; confirm DTO matches |
| DATA-07 | Date/time fields parsed consistently (ISO string vs epoch) | P1 | Grep for `SimpleDateFormat` / `Instant.parse` in DTOs |
| DATA-08 | Enum / status string → sealed class or typed enum, not bare `String` | P2 | Grep DTOs for `val status: String` |
| DATA-09 | List vs single-object — `List<X>` vs `X` never confused | P1 | Cross-check against backend response |
| DATA-10 | Money types consistent — prefer `String` or `BigDecimal`, avoid `Double` for currency | P1 | Grep DTOs for `amount: Double` / `total: Double` |
| DATA-11 | Boolean coercion: backend 0/1 or "yes"/"no" handled | P1 | Grep DTOs for `val is*: Boolean` and verify backend format |
| DATA-12 | Empty-string vs null — repository layer normalizes `""` to `null` where backend is sloppy | P2 | Audit repository/mapper classes |

## Category 2 — Network Layer (7 checks)

| ID | Check | Severity | Detection |
|---|---|---|---|
| NET-01 | Every `@GET/@POST/...` has a matching backend route (same verb + path) | P0 | Join output of extract-android-endpoints.sh vs extract-backend-routes.sh |
| NET-02 | `@Query("brand")` / `@Query("category")` typed `String?` not `Int?` | P1 | Pattern 8 in known-bug-patterns.md |
| NET-03 | Path vs query param parity — `{id}` in Kotlin matches `:id` in Express | P1 | Regex `@Path\("[a-z]+"\)` vs backend route placeholders |
| NET-04 | Request body shape matches backend Zod schema (if present) | P1 | Grep `routes/painters.js` for `validate(` usages; compare to `@Body` DTO |
| NET-05 | `X-Painter-Token` header applied to every painter endpoint | P0 | Grep `data/remote/interceptor/*.kt` and AuthInterceptor |
| NET-06 | Base URL single source of truth | P1 | Grep for `https?://` literals in source |
| NET-07 | Retrofit converter order (Gson) — Scalars before Gson if used | P2 | Inspect `NetworkModule` / `ApiClient` converter list |

## Category 3 — UI / Compose (10 checks)

| ID | Check | Severity | Detection |
|---|---|---|---|
| UI-01 | No deprecated `TabRowDefaults.tabIndicatorOffset` | P1 | Pattern 5 |
| UI-02 | No bare `.menuAnchor()` — needs `MenuAnchorType` overload | P1 | Pattern 6 |
| UI-03 | LazyColumn `items(list) { ... }` has explicit `key = { it.id }` for dynamic lists | P2 | Grep `LazyColumn` + `items(` without `key =` |
| UI-04 | State collected with `collectAsStateWithLifecycle()` not `collectAsState()` | P2 | Grep `collectAsState(` |
| UI-05 | Colors pulled from theme (QCGreen/QCGold), not hardcoded hex | P2 | Grep `Color(0xFF` |
| UI-06 | Expensive computations wrapped in `remember { ... }` | P2 | Heuristic — review costly composables |
| UI-07 | State hoisted — child composables don't own mutable state they should receive | P2 | Manual review |
| UI-08 | Async screens have loading + error composables | P1 | Grep for `Loading` / `Error` paths per screen |
| UI-09 | `navigation/AppNavigation.kt` has no duplicate routes | P0 | Pattern 12 |
| UI-10 | Non-top screens wire a `BackHandler` or rely on nav back | P2 | Grep for `BackHandler` usage |

## Category 4 — DI / Hilt (4 checks)

| ID | Check | Severity | Detection |
|---|---|---|---|
| DI-01 | Every `@HiltViewModel` constructor dep has a `@Provides`/`@Binds` in any `@Module` | P0 | Pattern 14 |
| DI-02 | All 17 API interfaces in `data/remote/api/` are bound in `di/NetworkModule.kt` or `AppModule.kt` | P0 | List .kt files in `api/` + grep `@Provides.*<Type>` |
| DI-03 | No circular dependencies in the DI graph | P0 | Build fails with Dagger error — caught at Phase 4 |
| DI-04 | `@Singleton` used for long-lived (API, repo), `@ViewModelScoped` for VM-only | P2 | Manual review |

## Category 5 — Build Health (6 checks)

| ID | Check | Severity | Detection |
|---|---|---|---|
| BUILD-01 | `./gradlew :app:assemblePainterRelease` exits 0 | P0 | build-log-final.txt |
| BUILD-02 | No unresolved Kotlin references | P0 | Grep build log for `Unresolved reference:` |
| BUILD-03 | Kotlin stdlib version matches across modules | P1 | Grep `kotlin_version` / `kotlinVersion` |
| BUILD-04 | R8 `-keep` rules cover every Retrofit DTO (Gson reflects on them) | P1 | Check `proguard-rules.pro` + DTO package coverage |
| BUILD-05 | `AndroidManifest.xml` permissions match actual feature use — no over-request | P2 | Manual review |
| BUILD-06 | `versionCode` in `app/build.gradle.kts` > last Play Store release | P1 | Compare to `last-audit-ref.txt` (informational only — user confirms) |

## Category 6 — Painter-Specific Logic (8 checks)

| ID | Check | Severity | Detection |
|---|---|---|---|
| PNTR-01 | OTP token stored in `UserPreferences` and injected via `AuthInterceptor` | P0 | Grep `x-painter-token` in interceptor |
| PNTR-02 | FCM token registered on successful painter login | P0 | Pattern 15 |
| PNTR-03 | Points display: `regular` vs `annual` pool values pulled from correct JSON fields | P1 | DTO vs screen composable cross-check |
| PNTR-04 | Loyalty level thresholds (3K / 5K / 10K) match backend `painter-points-engine.js` | P1 | Grep Kotlin for `3000`, `5000`, `10000` + verify against backend |
| PNTR-05 | Referral code generation + deep link scheme registered in `AndroidManifest.xml` | P1 | Grep `intent-filter` in Manifest |
| PNTR-06 | Card regeneration API called on profile photo update | P1 | Grep `card_generated_at` / regenerateCard call sites |
| PNTR-07 | Language toggle (Tamil/English) persisted in `UserPreferences` | P2 | Grep for locale/language pref key |
| PNTR-08 | Notification payload type → correct screen routing | P1 | Grep `MessagingService` for `payload.type` branches |

## Category 7 — Release Readiness (5 checks)

| ID | Check | Severity | Detection |
|---|---|---|---|
| REL-01 | `versionCode` strictly > last release (read from `last-audit-ref.txt`) | P1 | Compare numbers |
| REL-02 | `versionName` follows semver (X.Y.Z) | P2 | Regex on `versionName` |
| REL-03 | Telegram upload script (if used) passes `--dry-run` | P1 | Run script with `--dry-run` |
| REL-04 | Final APK size < ~15 MB | P2 | `stat -c%s` on output APK |
| REL-05 | Mapping file generated for R8 (crash symbolication) | P1 | Check `app/build/outputs/mapping/painterRelease/mapping.txt` exists |

---

## Coverage Summary

| Category | Checks | Auto-fixable (P0/P1) | Proposed (P2) |
|---|---|---|---|
| Data Layer | 12 | 10 | 2 |
| Network | 7 | 6 | 1 |
| UI / Compose | 10 | 3 | 7 |
| DI / Hilt | 4 | 3 | 1 |
| Build Health | 6 | 4 | 2 |
| Painter-Specific | 8 | 7 | 1 |
| Release Readiness | 5 | 3 | 2 |
| **Total** | **52** | **36** | **16** |
```

- [ ] **Step 2: Verify line count**

Run:
```bash
wc -l "C:/Users/Hiii/.claude/skills/painter-android-audit/references/audit-checklist.md"
```
Expected: 120-200 lines.

- [ ] **Step 3: Verify count math**

Grep the file: totals in the Coverage Summary must be 12+7+10+4+6+8+5 = 52. Confirm by reading the final table block in the file.

- [ ] **Step 4: No commit**

---

## Task 7: Write `references/fix-playbooks.md`

**Purpose:** Deterministic Edit/MultiEdit recipes for P0/P1 auto-fix. Each recipe references a pattern ID from `known-bug-patterns.md` and shows the exact before/after.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\references\fix-playbooks.md`

- [ ] **Step 1: Write the file**

Content of `references/fix-playbooks.md`:
```markdown
# Fix Playbooks — Painter Android App

Deterministic recipes for auto-fixing P0/P1 findings. Every recipe here corresponds to a pattern ID in `known-bug-patterns.md`. If a finding doesn't match a recipe here, it is NOT auto-fixed — it goes to "Manual Review Required" in SUMMARY.md.

**Policy:**
- Recipes use `Edit` or `MultiEdit` tool only. No AI-generated fixes.
- Each fix = one category = one commit on the audit branch (`audit/YYYY-MM-DD`).
- After each category batch, re-run `scripts/build-painter-apk.sh`. If build breaks → `git reset --hard HEAD~1` on the audit branch and pause.

---

## Recipe 1 — ID fields to `String?` (pattern 1, DATA-02)

**Detection:** grep `val (zohoItemId|painterId|invoiceId|productId|variantId)\s*:\s*(Int|Long)\??` in `app/src/**/data/remote/dto/*.kt`.

**Edit:** For each match, read the file, then `Edit`:
- old: `val zohoItemId: Int` → new: `@SerializedName("zoho_item_id")\n    val zohoItemId: String?`
- Verify `import com.google.gson.annotations.SerializedName` is present; add if missing.

**Required imports:** `com.google.gson.annotations.SerializedName`.

**Post-fix check:** grep file for the new type, confirm `@SerializedName` is directly above.

---

## Recipe 2 — Non-nullable primitive in DTO (pattern 2, DATA-04)

**Detection:** See pattern 2 regex.

**Edit:** Append `?` to the type.
- old: `val name: String` → new: `val name: String?`
- old: `val age: Int` → new: `val age: Int?`

**Caveat:** If the field is consumed by code that assumes non-null (e.g. `.uppercase()` on it), the nullability change will surface new compile errors. That is desirable — they are true bugs. Do NOT silence them with `!!`.

---

## Recipe 3 — Missing `@SerializedName` (pattern 3, DATA-03)

**Detection:** camelCase field in DTO with no annotation on the preceding line, where the field name would snake-case to something the backend sends.

**Edit:** Insert line above the field:
```kotlin
@SerializedName("<snake_case>")
```
Compute snake_case via: `s/([a-z])([A-Z])/\1_\L\2/g`.

**Required imports:** `com.google.gson.annotations.SerializedName`.

---

## Recipe 4 — Coil `toBitmap()` (pattern 4)

**Detection:** `.toBitmap()` anywhere in `.kt` files.

**Edit:** Context-aware, so the skill does a MultiEdit across the file:
- old: `result.image.toBitmap()` → new: `(result.drawable as BitmapDrawable).bitmap`
- old: `image.toBitmap()` → new: `(drawable as BitmapDrawable).bitmap` (only if local `drawable` is in scope)

**Required imports:** `android.graphics.drawable.BitmapDrawable`.

**If the match is inside a lambda where neither `drawable` nor `result.drawable` is in scope:** skip auto-fix, flag as manual review.

---

## Recipe 5 — `tabIndicatorOffset` removal (pattern 5, UI-01)

**Detection:** `TabRowDefaults.tabIndicatorOffset` reference.

**Edit:** Remove the entire `indicator = { currentTabPositions -> ... tabIndicatorOffset ... }` lambda argument from the `TabRow(...)` call. Rely on the default indicator.

**Heuristic:** if the `indicator` lambda is complex (>3 lines) and clearly does more than just position the indicator, flag for manual review instead of auto-removing.

---

## Recipe 6 — `menuAnchor()` upgrade (pattern 6, UI-02)

**Detection:** `\.menuAnchor\(\s*\)` on a Modifier.

**Edit:**
- old: `.menuAnchor()` → new: `.menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled = true)`

**Required imports:** `androidx.compose.material3.ExposedDropdownMenuBoxScope.MenuAnchorType`.

---

## Recipe 7 — `java.time` removal (pattern 7, BUILD-03)

**Detection:** `^import java\.time\.` at file head.

**Edit:** This is a structural rewrite, not a regex swap. **Do NOT auto-fix** — flag for manual review with the hint: "either add core library desugaring to `build.gradle.kts`, or rewrite to `java.util.Calendar`."

---

## Recipe 8 — Catalog brand/category `Int` → `String` (pattern 8, NET-02)

**Detection:** `@Query\("(brand|category)"\)\s+[a-zA-Z]+\s*:\s*(Int|Long)\??` in `api/*.kt`.

**Edit:**
- old: `@Query("brand") brand: Int?` → new: `@Query("brand") brand: String?`

**Cascading:** after this change, every caller passing an Int will fail to compile. Those call sites become P0 follow-ups to fix (change the argument type).

---

## Recipe 10 — `ProductDetail.id` → `product_id` (pattern 10)

**Detection:** In DTO files named `ProductDetail*.kt`, `val id: String` without `@SerializedName("product_id")` above.

**Edit:** Insert annotation line, widen to `String?`:
- old: `val id: String,` → new: `@SerializedName("product_id")\n    val id: String?,`

---

## Recipe 11 — `ProductVariant.id` → `String?` (pattern 11)

**Detection:** pattern 11 regex.

**Edit:**
- old: `val id: Int` → new: `@SerializedName("variant_id")\n    val id: String?`
- old: `val id: Long` → new: `@SerializedName("variant_id")\n    val id: String?`

---

## Recipe 14 — Missing Hilt `@Provides` (pattern 14, DI-01)

**Detection:** See pattern 14 detection steps.

**Edit:** Append a `@Provides` method to `AppModule.kt` (or `NetworkModule.kt` for API interfaces). Template:
```kotlin
@Provides
@Singleton
fun provide<Type>(retrofit: Retrofit): <Type> =
    retrofit.create(<Type>::class.java)
```
For non-Retrofit dependencies (repositories, services), flag for manual review — the correct `@Provides` body depends on the constructor.

---

## Recipes NOT in this file (no auto-fix)

The following known patterns **require manual review**. The skill flags them, does not touch them:
- Pattern 9 (PackSize sort) — backend fix exists, client rarely needs change
- Pattern 12 (AppNavigation duplicates) — semantic decision required
- Pattern 13 (Search chip close) — UX design decision
- Pattern 15 (FCM registration) — integration-level change, needs verification

---

## Rollback protocol

If any recipe in this file, when applied, causes `scripts/build-painter-apk.sh` to return non-zero:
1. `git reset --hard HEAD~1` on the audit branch.
2. Stop further auto-fixes.
3. Write the failing build log excerpt to `audit-findings/YYYY-MM-DD/BUILD-BREAK.md`.
4. Pause at Gate 4 (conditional gate — see SKILL.md).
```

- [ ] **Step 2: Verify line count**

Run:
```bash
wc -l "C:/Users/Hiii/.claude/skills/painter-android-audit/references/fix-playbooks.md"
```
Expected: 150-220 lines.

- [ ] **Step 3: No commit**

---

## Task 8: Write `references/backend-crosscheck.md`

**Purpose:** How the skill diffs Android endpoint list vs backend route list in Phase 3.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\references\backend-crosscheck.md`

- [ ] **Step 1: Write the file**

Content of `references/backend-crosscheck.md`:
```markdown
# Backend Cross-Check — Painter Android vs `routes/painters.js`

Phase 3 of the audit. Inputs:
- `scripts/extract-android-endpoints.sh` output (TSV: METHOD, PATH, INTERFACE_FILE, FUNCTION)
- `scripts/extract-backend-routes.sh` output (TSV: METHOD, PATH, FILE, LINE_NUMBER)

Output: `audit-findings/YYYY-MM-DD/03-backend.md`.

---

## Path Normalization

Android paths include the `api/` prefix (e.g. `api/painters/me/dashboard`). Backend paths are relative to their mount point (e.g. `/me/dashboard` inside `routes/painters.js`, mounted at `/api/painters` in `server.js`).

**Normalize before diffing:**
- Android: strip leading `api/painters/` or `api/painter-marketing/`.
- Backend: prefix `/me/dashboard` with the mount point inferred from the file name (`painters.js` → `/me/...`, `painter-marketing.js` → `/painter-marketing/...`).
- Convert `{id}` (Retrofit) → `:id` (Express) before compare.
- Lowercase both sides. Trim trailing slashes.

---

## The Four Diff Results

### 1. Matched — same verb + same path
Pass. Still run the type cross-check (see below).

### 2. Orphaned Android call (backend missing) — P0
Android has `GET api/painters/me/foo` but no backend route matches.
**Action:** Report file:line of the Android `@GET`. Skill never auto-adds backend routes.

### 3. Orphaned backend route (Android not consuming) — P2 informational
Backend has `/some-internal-route` that no Android call hits.
**Action:** Report. Most likely intentional (admin-only route, marketing cron target, WIP).

### 4. Verb mismatch — P1
Backend accepts POST, Android calls GET at same path.
**Action:** Report; suggest the correct Retrofit annotation. Do NOT auto-edit — verb changes often imply semantic change (idempotency, caching).

---

## Type Cross-Check (per matched pair)

For each matched endpoint, compare:

### Request shape
- Android `@Body` DTO field set vs backend `req.body.*` usage (grep backend for `req.body.` inside the route handler) and any `validate(schema)` usage.
- Flag missing fields (Android doesn't send something backend requires) — P0.
- Flag extra fields Android sends that backend ignores — P2 (noise, not harmful).

### Query param set
- Android `@Query("foo")` → backend `req.query.foo`.
- Missing `req.query.foo` access on backend = Android sending a param that does nothing — P2.
- Android lacks a `@Query` that backend requires = P0.

### Path param parity
- `@Path("id") id: String` → `:id` in Express route.
- Mismatched name = P1 (works accidentally by position, fragile).

### Response shape
- Try to locate the backend response via `res.json({...})` inside the handler.
- Confirm Android DTO has every key the handler returns, with compatible nullability.
- Mismatches flagged as P1 and referred to `known-bug-patterns.md` pattern 1/2/3.

---

## Edge Cases

- Backend routes mounted under path params (e.g. `router.use('/:branchId', ...)`) — cross-check against the full mounted path, not just the inner path.
- Backend routes using `router.all()` or `router.use()` — skip (catch-all, not an endpoint).
- Android endpoints that hit non-painter routes (e.g. `api/public/config`) — out of scope for this skill.

---

## Severity Summary

| Result | Severity |
|---|---|
| Orphaned Android (backend missing) | **P0** |
| Verb mismatch | **P1** |
| Type mismatch — missing required field | **P0** |
| Type mismatch — extra field | **P2** |
| Path param name mismatch | **P1** |
| Orphaned backend | **P2** informational |
```

- [ ] **Step 2: Verify file exists**

Run:
```bash
wc -l "C:/Users/Hiii/.claude/skills/painter-android-audit/references/backend-crosscheck.md"
```
Expected: 80-140 lines.

- [ ] **Step 3: No commit**

---

## Task 9: Write `SKILL.md`

**Purpose:** Orchestrator. YAML frontmatter (name + description) + 4-phase workflow + gate policies + references to the support files.

**Files:**
- Create: `C:\Users\Hiii\.claude\skills\painter-android-audit\SKILL.md`

- [ ] **Step 1: Write the file**

Content of `SKILL.md`:
```markdown
---
name: painter-android-audit
description: Audit the painter Android app (qcpaintshop-android, flavor `painter`) before every Play Store release. Runs static analysis, APK build verification, and backend cross-check against act.qcpaintshop.com routes/painters.js, then auto-fixes P0/P1 findings and proposes P2 quality fixes for approval. Use before every painter APK upload, or when the user says "audit painter app", "pre-release check", "painter APK audit", or mentions painter-android release readiness.
---

# Painter Android Audit

## Opening Banner

When invoked, print:
```
🔍 Painter Android Audit starting...
App: qcpaintshop-android/app/src/painter (vX.Y.Z versionCode N)
Backend: act.qcpaintshop.com routes/painters.js + routes/painter-marketing.js
Estimated time: ~25 min. Mandatory approval gates: 2 (plus up to 2 conditional).
```
(Read the version values from `app/build.gradle.kts` via `grep -E 'versionCode|versionName'` before printing.)

## Pre-flight — Uncommitted Changes (Gate 3 — conditional)

Run `git -C "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" status --porcelain`. If any output:
- Pause.
- Ask: "Painter-android repo has uncommitted changes. Stash? Commit? Continue anyway? (stash/commit/continue/abort)"
- Honor the user's answer. Never silently mutate.

## Audit Branch Setup

Always work on a fresh audit branch:
```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
git checkout -b "audit/$(date -u +%Y-%m-%d)"
```
If the branch already exists (second run same day), append `-2`, `-3`, etc.

Output folder:
```
qcpaintshop-android/audit-findings/YYYY-MM-DD/
```
Ensure `audit-findings/` is in `.gitignore` — if not, add it as the first action and commit that change on the audit branch.

---

## Phase 1 — Discover (~2 min)

1. `git log --oneline -30` in painter-android repo → prepend to `01-discovery.md` as "Recent commits" section.
2. Run `scripts/extract-android-endpoints.sh <painter-flavor-root>` → write TSV to `01-discovery.md` under "Android endpoints".
3. Run `scripts/extract-backend-routes.sh <painter-routes-file> <painter-marketing-routes-file>` → write TSV to `01-discovery.md` under "Backend routes".
4. Baseline build check: `scripts/build-painter-apk.sh <repo-root> audit-findings/YYYY-MM-DD/build-log-baseline.txt`.
5. **If baseline build exits non-zero:** abort the entire audit with message: "Baseline build failed. Fix pre-existing break before audit runs." Leave discovery outputs intact.

**Output:** `audit-findings/YYYY-MM-DD/01-discovery.md`

---

## Phase 2 — Static Analysis (~10 min)

For each category in `references/audit-checklist.md`:
1. Run the detection hints (regex via Grep tool, file reads via Read).
2. Cross-reference findings with `references/known-bug-patterns.md`.
3. For each finding record: check ID, file path, line number, severity, one-line description.

Special detections:
- Navigation duplicates: read `navigation/AppNavigation.kt`, extract every `composable("...")` first arg, `sort | uniq -d`.
- Hilt coverage: list every `@HiltViewModel` class's constructor args, then for each arg type search `di/` for `@Provides` / `@Binds` of that type.

**Output:** `audit-findings/YYYY-MM-DD/02-static.md`

Format (one finding per bullet):
```
- [PNTR-02] P0  VerifyOtpScreen.kt:84  FCM token not registered after verify — see pattern 15
```

---

## Phase 3 — Backend Cross-Check (~5 min)

Follow the methodology in `references/backend-crosscheck.md`.

1. Normalize paths (strip `api/painters/`, convert `{id}` ↔ `:id`).
2. Join Android TSV + backend TSV on (METHOD, PATH).
3. For matched pairs: run the type cross-check documented in `backend-crosscheck.md`.
4. For each diff result, emit a finding with the severity from that doc.

**Output:** `audit-findings/YYYY-MM-DD/03-backend.md`

---

## Phase 4 — Build Verification (~5 min)

1. Run `scripts/build-painter-apk.sh <repo-root> audit-findings/YYYY-MM-DD/build-log-prefix.txt`.
2. Parse the log:
   - `^e: ` lines = Kotlin errors (P0)
   - `Unresolved reference:` = P0
   - `warning:` lines — extract and count, keep as P2 info
   - Missing resource errors = P0
   - R8 / ProGuard warnings = P1
3. Record count of each kind.

**Output:** `audit-findings/YYYY-MM-DD/04-build.md`

---

## Aggregate + Gate 1 (mandatory pause)

Merge phases into `SUMMARY.md` using the template from the spec (`## Counts` table + sections).

Print summary counts to user:
```
Audit complete. Findings:
  P0: 3 (auto-fix: 2, manual: 1)
  P1: 8 (auto-fix: 7, manual: 1)
  P2: 12 (proposed in PROPOSED-FIXES.md)
Auto-fix plan: 9 findings across 4 categories, 4 commits expected.
Proceed with auto-fix? (yes / no / review first)
```

Wait for user.

---

## Auto-Fix Loop (P0 + P1)

For each category present in findings (DATA, NET, UI, DI, BUILD, PNTR, REL — in that order):
1. Group findings in that category that match a recipe in `references/fix-playbooks.md`.
2. Apply all fixes via `Edit` / `MultiEdit`.
3. Run `scripts/build-painter-apk.sh` again. Tee log to `audit-findings/YYYY-MM-DD/build-log-<category>.txt`.
4. If exit code = 0: `git add -A && git commit -m "fix(painter-audit): <category> — N issues"`.
5. If exit code ≠ 0: `git reset --hard HEAD` (NOT `HEAD~1` since commit didn't happen), record failure in `FIXES-APPLIED.md`, pause at **Gate 4**.

Findings with NO matching recipe → "Manual Review Required" in SUMMARY.md, untouched.

After loop completes, final build log → `audit-findings/YYYY-MM-DD/build-log-final.txt`.

---

## Gate 2 (mandatory pause) — P2 Batch

1. Write `audit-findings/YYYY-MM-DD/PROPOSED-FIXES.md`: numbered list, each item shows file:line + exact before/after diff.
2. Prompt user:
   ```
   N P2 fixes proposed. Apply:
     all   → apply all N
     1,3,7 → apply those items only
     none  → skip
   Response?
   ```
3. Apply subset exactly.
4. Re-run build. On success → commit `fix(painter-audit): P2 quality — K items`.

---

## Gate 4 (conditional) — Build Break

Triggered when any fix commit breaks the build:
1. `git reset --hard HEAD`.
2. Write build log excerpt (last 80 lines) to `audit-findings/YYYY-MM-DD/BUILD-BREAK.md`.
3. Pause with message: "Fix for <category> broke the build. See BUILD-BREAK.md. Continue to next category, or abort audit? (continue/abort)"
4. Never retry the same fix silently.

---

## Exit Behavior

- Clean completion:
  - Write `last-audit-ref.txt` in `audit-findings/` with `SHA<tab>versionCode<tab>ISO-timestamp`.
  - Offer: "Open SUMMARY.md?"
- Build break persisted after retry prompt: leave rollback instructions, do NOT auto-rollback the whole audit branch.

---

## Pattern Growth

If during static analysis a new bug was found that does not match any pattern in `references/known-bug-patterns.md`:
1. At end of run, present the candidate pattern: signature (regex), example file:line, suggested fix.
2. Ask user: "Add to known-bug-patterns.md? (yes/no/modify)"
3. If yes or modify → append to `references/known-bug-patterns.md` with the next sequential number and today's date. Never silently mutate.

This skill does NOT write to the user's auto-memory at `C:\Users\Hiii\.claude\projects\...\memory\`. It is self-contained.

---

## Hand-offs

- Blocker debugging → `superpowers:systematic-debugging`
- Pre-completion verification → `superpowers:verification-before-completion`
- Multi-step refactor plan (if audit finds a large restructure) → `superpowers:writing-plans`

---

## Out of Scope

- Runtime device testing (user's manual ADB step).
- Other flavors (staff, customer, main).
- Backend code refactoring (skill flags only).
- Auto-bumping versionCode / versionName.
- Pushing to remote or uploading to Play Store.
```

- [ ] **Step 2: Verify frontmatter parses**

Run:
```bash
head -5 "C:/Users/Hiii/.claude/skills/painter-android-audit/SKILL.md"
```
Expected: first line is `---`, then `name: painter-android-audit`, then `description: ...`, then `---`, then blank. Description line must not be wrapped to multiple lines.

- [ ] **Step 3: Verify line count**

Run:
```bash
wc -l "C:/Users/Hiii/.claude/skills/painter-android-audit/SKILL.md"
```
Expected: 160-220 lines.

- [ ] **Step 4: No commit**

---

## Task 10: End-to-end skill smoke test + plan commit

**Purpose:** Confirm the skill is invokable and reads cleanly. We do NOT execute the full audit here — a full audit includes a 5-min gradle build and is the subject of its own future run. This task only verifies the skill loads.

**Files:**
- Modify: `docs/superpowers/plans/2026-04-17-painter-android-audit-skill.md` (mark all tasks complete in a final commit)

- [ ] **Step 1: List skill folder and verify all 8 files present**

Run:
```bash
find "C:/Users/Hiii/.claude/skills/painter-android-audit" -type f | sort
```
Expected — exactly these 8 paths:
```
C:/Users/Hiii/.claude/skills/painter-android-audit/SKILL.md
C:/Users/Hiii/.claude/skills/painter-android-audit/references/audit-checklist.md
C:/Users/Hiii/.claude/skills/painter-android-audit/references/backend-crosscheck.md
C:/Users/Hiii/.claude/skills/painter-android-audit/references/fix-playbooks.md
C:/Users/Hiii/.claude/skills/painter-android-audit/references/known-bug-patterns.md
C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/build-painter-apk.sh
C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-android-endpoints.sh
C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-backend-routes.sh
```

- [ ] **Step 2: Verify all scripts are executable**

Run:
```bash
ls -l "C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/"
```
Expected: each script line starts with `-rwx` (execute bit set for owner).

- [ ] **Step 3: Dry-run Phase 1 discovery on real repos**

Run:
```bash
"C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-android-endpoints.sh" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter" \
  | wc -l
"C:/Users/Hiii/.claude/skills/painter-android-audit/scripts/extract-backend-routes.sh" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/routes/painters.js" \
  "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/routes/painter-marketing.js" \
  | wc -l
```
Expected: two integers. Android count in 30-100 range. Backend count in 100-180 range.

- [ ] **Step 4: Confirm SKILL tool can find the skill**

In a fresh Claude Code turn (after skill creation), invoke:
- Expect the tool list (via the system-reminder skill enumeration) to include `painter-android-audit` once the user's next Claude Code session starts.

This step is manual verification by the user, NOT a bash command. Document this expectation in the PR / commit message — "Skill will appear in the skills list on next Claude Code session start."

- [ ] **Step 5: Commit the plan + any helper file changes to qcpaintshop.com repo**

Run (from `D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com`):
```bash
git add docs/superpowers/plans/2026-04-17-painter-android-audit-skill.md
git commit -m "$(cat <<'EOF'
docs(superpowers): painter android audit skill — implementation plan

Plan covers creating a user-level Claude Code skill at
~/.claude/skills/painter-android-audit/ for pre-release painter APK audits.
Skill files live outside this repo; only the plan + earlier spec are tracked
here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify commit landed**

Run:
```bash
git log --oneline -1
```
Expected: first line shows the new commit SHA with the plan summary.

---

## Self-Review Results

**Spec coverage:**
- Skill location `~/.claude/skills/painter-android-audit/` → Task 1. ✅
- File layout (SKILL.md + 4 references + 3 scripts) → Tasks 1-9. ✅
- 4-phase workflow → `SKILL.md` (Task 9) encodes Discover/Static/Backend/Build. ✅
- Baseline-build-fails-abort behavior → SKILL.md Phase 1 step 5. ✅
- 50+ checks across 7 categories → Task 6 (52 checks). ✅
- 15 seed bug patterns → Task 5. ✅
- Fix policy (P0/P1 auto, P2 propose-batch) → SKILL.md auto-fix loop + Gate 2. ✅
- Rollback safety (audit branch, per-category commit, reset on break) → SKILL.md. ✅
- Gates 1-4 → SKILL.md explicit sections for each. ✅
- No-recipe findings go to "Manual Review Required" → SKILL.md auto-fix loop. ✅
- Pattern growth protocol (user approval to append to known-bug-patterns.md) → SKILL.md "Pattern Growth" section + known-bug-patterns.md "Meta" section. ✅
- Skill does NOT write to user's auto-memory → SKILL.md explicit statement. ✅
- Out-of-scope items → SKILL.md "Out of Scope". ✅
- Skill entry behavior (opening banner, version read) → SKILL.md "Opening Banner". ✅
- Skill exit behavior (last-audit-ref.txt, SUMMARY.md offer) → SKILL.md "Exit Behavior". ✅

**Placeholder scan:** No TODO / TBD / "implement later" / "similar to above" in task content. All code blocks complete. Commands have expected outputs.

**Type consistency:** Script names (`extract-android-endpoints.sh`, `extract-backend-routes.sh`, `build-painter-apk.sh`) match everywhere. TSV column order consistent across scripts and `backend-crosscheck.md`. Finding record format consistent between `02-static.md` bullet format and `SUMMARY.md` sections.

**One spec requirement was adjusted:** the spec says "rollback via `git reset HEAD~1`" but that only works *after* a commit lands. The plan's SKILL.md says `git reset --hard HEAD` for pre-commit failure and `git reset --hard HEAD~1` is reserved for the rare case of post-commit regression discovery. This is a correctness fix, documented in SKILL.md Auto-Fix Loop step 5.

---

## Summary of Work

| Task | What | Where |
|---|---|---|
| 1 | Create skeleton | `~/.claude/skills/painter-android-audit/` |
| 2 | `extract-android-endpoints.sh` | `scripts/` |
| 3 | `extract-backend-routes.sh` | `scripts/` |
| 4 | `build-painter-apk.sh` | `scripts/` |
| 5 | `known-bug-patterns.md` (15 seeded) | `references/` |
| 6 | `audit-checklist.md` (52 checks) | `references/` |
| 7 | `fix-playbooks.md` (recipes) | `references/` |
| 8 | `backend-crosscheck.md` | `references/` |
| 9 | `SKILL.md` orchestrator | skill root |
| 10 | Smoke test + commit plan | this repo |

Total estimated build time: ~45 minutes of focused work, plus ~5 minutes for the gradle smoke build if Task 10 step 3 triggers it.
