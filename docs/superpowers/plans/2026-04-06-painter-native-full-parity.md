# Implementation Plan: Painter Native Android App — Full Web Parity

**Spec:** `docs/superpowers/specs/2026-04-06-painter-native-app-full-parity-design.md`
**Date:** 2026-04-06
**Android Root:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\`
**Painter Src:** `app/src/painter/java/com/qcpaintshop/painter/`

---

## Phase 1: API Layer + Data Models (Foundation)

All new screens need API endpoints and data models. Build these first so all phases can proceed in parallel.

### Step 1.1: New API Interfaces

**File:** `data/remote/api/PointsApi.kt` (NEW)
```
GET me/points/{pool}?limit=&page= → PointsResponse (transactions list)
POST me/withdraw → WithdrawResponse
```

**File:** `data/remote/api/CardsApi.kt` (NEW)
```
GET me/visiting-card?format=url → CardResponse (imageUrl)
GET me/id-card?format=url → CardResponse (imageUrl)
```

**File:** `data/remote/api/VisualizationApi.kt` (NEW)
```
GET me/visualizations → VisualizationsResponse (gallery + pending)
POST me/visualizations (Multipart) → VisualizationResponse
```

**File:** `data/remote/api/ReferralApi.kt` (NEW)
```
GET me/referrals → ReferralsResponse (list + stats)
```

**File:** `data/remote/api/NotificationApi.kt` (NEW)
```
GET me/notifications?limit=&unread= → NotificationsResponse
POST me/fcm/register → generic success
PUT me/notifications/{id}/read → generic success
```

**File:** `data/remote/api/AttendanceApi.kt` (UPDATE — add checkin history)
```
GET me/checkin-history?month= → CheckinHistoryResponse
GET me/daily-streak → StreakResponse  (add to DashboardApi)
PUT me/daily-streak → StreakResponse
```

**File:** `data/remote/api/EstimateDetailApi.kt` (UPDATE — add actions)
```
POST me/estimates/{id}/request-discount → generic
POST me/estimates/{id}/payment → generic
GET me/estimates/{id}/pdf → ResponseBody (file download)
```

**File:** `data/remote/api/CatalogApi.kt` (UPDATE — add filter params)
```
GET me/catalog?search=&brand=&category=&hasPoints=&inStock= (add hasPoints, inStock params)
GET me/catalog/{id} → ProductDetailResponse
GET me/offer-products → OfferProductsResponse
```

**File:** `data/remote/api/ProfileApi.kt` (NEW)
```
PUT me/profile (Multipart — photo + fields) → ProfileResponse
```

### Step 1.2: Data Models

**File:** `data/remote/models/Models.kt` (NEW — all response/request models)
- PointsTransaction, PointsResponse
- CardResponse
- Visualization, VisualizationRequest, VisualizationsResponse
- Referral, ReferralsResponse
- Notification, NotificationsResponse
- CheckinDay, CheckinHistoryResponse
- OfferProduct, OfferProductsResponse
- ProductDetail, ProductVariant
- WithdrawRequest
- ProfileUpdateRequest
- EstimateDetail, EstimateItem (full detail with actions)
- QuotationDetail, QuotationRoom, QuotationItem

### Step 1.3: DI Module Update

**File:** `di/AppModule.kt` (UPDATE)
- Add providers for: PointsApi, CardsApi, VisualizationApi, ReferralApi, NotificationApi, ProfileApi
- Add EstimateDetailApi, QuotationDetailApi if not already provided

---

## Phase 2: Catalog Screen Upgrade (Independent)

### Step 2.1: Update CatalogViewModel

**File:** `ui/catalog/CatalogViewModel.kt` (REWRITE ~200 lines)
- Add state: selectedBrand, selectedCategory, hasPointsFilter, inStockFilter, activeFilterCount
- Add: fetchBrands(), fetchCategories() from catalog response
- Add: applyFilters(), resetFilters()
- Add: fetchProductDetail(id)
- Update: fetchCatalog() to pass all filter params
- Add: offers state from `GET me/offers`

### Step 2.2: Filter Bottom Sheet

**File:** `ui/catalog/FilterBottomSheet.kt` (NEW ~180 lines)
- Material3 ModalBottomSheet
- Brand dropdown (from API brands list)
- Category dropdown (from API categories list)
- "Points products only" Switch
- "In stock only" Switch
- Apply button + Reset text button
- Filter count callback

### Step 2.3: Update CatalogScreen

**File:** `ui/catalog/CatalogScreen.kt` (REWRITE ~400 lines)
- Top bar: Search + Filter icon with count badge
- Offer banners horizontal carousel (LazyRow)
- Product grid (LazyVerticalGrid, 2 columns)
- Product family card: image, name, brand, price range, variant count, points badge, offer badge, stock indicator
- Tap card → expand inline or bottom sheet showing variants
- Each variant: size, rate, stock, points earned
- "Create Estimate" button per variant
- Load more pagination
- Empty state
- Skeleton loading

### Step 2.4: Product Detail Bottom Sheet

**File:** `ui/catalog/ProductDetailSheet.kt` (NEW ~200 lines)
- Product image (Coil) or gradient placeholder
- Name, brand, stock status
- Price (single or range)
- Best active offer highlighted
- Variant list with earnings breakdown (size, rate, regular points, annual points)
- "Create Estimate" button per variant

---

## Phase 3: Dashboard Screen Upgrade (Independent)

### Step 3.1: Dashboard ViewModel Expansion

**File:** `ui/home/HomeViewModel.kt` (REWRITE ~300 lines)
- Add: fetchOfferProducts(), fetchRecentEstimates(), fetchRecentTransactions()
- Add: fetchCards(), fetchVisualizations(), fetchStreakCalendar()
- Add: submitWithdrawal(), recordDailyStreak()
- State classes for each section

### Step 3.2: Dashboard Section Components

**File:** `ui/home/components/OfferCarousel.kt` (NEW ~150 lines)
- Brand tab chips (LazyRow)
- Auto-scrolling HorizontalPager for offer products
- Dot indicators
- Offer badges

**File:** `ui/home/components/BalanceCards.kt` (NEW ~100 lines)
- 2x2 grid: Regular Points, Annual Points, Total Earned, Referrals
- Clickable → navigate to Points History

**File:** `ui/home/components/RecentEstimates.kt` (NEW ~80 lines)
- LazyColumn of last 10 estimates (number, status badge, date, amount)
- "View All" → Work tab

**File:** `ui/home/components/RecentTransactions.kt` (NEW ~80 lines)
- Transaction rows (source, amount +/-, pool badge, date)
- "View All" → Points History

**File:** `ui/home/components/MyCardsSection.kt` (NEW ~80 lines)
- Visiting card + ID card thumbnails (Coil)
- Share buttons

**File:** `ui/home/components/VisualizationSection.kt` (NEW ~100 lines)
- 2-column gallery grid (completed)
- Pending list with status badges
- "Request" button

**File:** `ui/home/components/ReferralSection.kt` (NEW ~60 lines)
- Referral code display (dashed border)
- Share button (native share intent)

**File:** `ui/home/components/WithdrawalSheet.kt` (NEW ~100 lines)
- ModalBottomSheet
- Pool dropdown (Regular/Annual)
- Amount input, available balance display
- Submit button

**File:** `ui/home/components/StreakSheet.kt` (NEW ~120 lines)
- ModalBottomSheet with monthly calendar grid
- Green dots on check-in days, month navigation
- Current streak + personal best

**File:** `ui/home/components/LevelPanel.kt` (NEW ~80 lines)
- 4 tier cards: Bronze, Silver, Gold, Diamond
- Thresholds, multipliers, perks
- Current tier highlighted

### Step 3.3: HomeScreen Rewrite

**File:** `ui/home/HomeScreen.kt` (REWRITE ~500 lines)
- Scrollable column composing all sections in order:
  1. Greeting header (existing)
  2. Morning briefing card (existing)
  3. Balance cards (NEW)
  4. Offer products carousel (NEW)
  5. My Cards section (NEW)
  6. Quick actions row (NEW — Estimate, Withdraw, Card, Refer, Visualize)
  7. Referral code section (NEW)
  8. Recent estimates (NEW)
  9. Recent transactions (NEW)
  10. Visualizations (NEW)
- Streak sheet trigger on streak tap
- Level panel trigger on level badge tap
- Withdrawal sheet trigger

---

## Phase 4: New Profile Sub-Screens (Parallelizable)

### Step 4.1: Points History Screen

**File:** `ui/profile/PointsHistoryScreen.kt` (NEW ~250 lines)
**File:** `ui/profile/PointsHistoryViewModel.kt` (NEW ~80 lines)
- Top tab row: Regular | Annual
- Balance card for selected pool
- Filter chips: All | Earned | Spent | Withdrawn
- Transaction list (LazyColumn) with infinite scroll
- Date, source, amount (+green/-red)

### Step 4.2: Cards Screen

**File:** `ui/profile/CardsScreen.kt` (NEW ~200 lines)
**File:** `ui/profile/CardsViewModel.kt` (NEW ~60 lines)
- Visiting Card section: image (Coil), Share button, Download button
- ID Card section: same layout
- Share: Intent.ACTION_SEND with image URI
- Download: MediaStore insert for gallery save

### Step 4.3: Visualization Screen

**File:** `ui/profile/VisualizationScreen.kt` (NEW ~300 lines)
**File:** `ui/profile/VisualizationViewModel.kt` (NEW ~80 lines)
- Gallery grid (completed visualizations)
- Pending list with status badges
- FAB → request form bottom sheet
- Request form: photo picker (camera+gallery via ActivityResultContracts), brand, color name, color code (hex input), notes
- Full-screen image viewer on gallery tap

### Step 4.4: Referrals Screen

**File:** `ui/profile/ReferralsScreen.kt` (NEW ~180 lines)
**File:** `ui/profile/ReferralsViewModel.kt` (NEW ~50 lines)
- Header: referral code + share button
- Stats: total count, total earnings
- Referral list (name, date, status, earnings)

### Step 4.5: Gallery Screen

**File:** `ui/profile/GalleryScreen.kt` (NEW ~150 lines)
**File:** `ui/profile/GalleryViewModel.kt` (NEW ~40 lines)
- 3-column grid of visualization images
- Tap → full-screen viewer with pinch-to-zoom (Coil + transformable modifier)

### Step 4.6: Training Screen

**File:** `ui/profile/TrainingScreen.kt` (NEW ~150 lines)
**File:** `ui/profile/TrainingViewModel.kt` (NEW ~40 lines)
- LazyColumn of training items
- Card: thumbnail, title, type badge (Video/Article), duration
- Empty state
- Tap → TrainingDetailScreen

### Step 4.7: Training Detail Screen

**File:** `ui/profile/TrainingDetailScreen.kt` (NEW ~100 lines)
- Video: AndroidView with VideoView or external intent
- Article: WebView or rich text
- Fallback: open in browser

### Step 4.8: Attendance Calendar Screen

**File:** `ui/profile/AttendanceCalendarScreen.kt` (NEW ~250 lines)
**File:** `ui/profile/AttendanceCalendarViewModel.kt` (NEW ~60 lines)
- Streak count display (fire emoji + number)
- Monthly stats (X/30 days)
- Custom calendar grid composable (7 columns)
- Month navigation (< April 2026 >)
- Green fill on check-in days, today highlighted
- "Check In Today" button if not checked in → navigate to CheckInScreen

### Step 4.9: Edit Profile Screen

**File:** `ui/profile/EditProfileScreen.kt` (NEW ~250 lines)
**File:** `ui/profile/EditProfileViewModel.kt` (NEW ~80 lines)
- Circular profile photo with camera overlay icon
- Photo picker (camera + gallery)
- Text fields: Full name, City (phone display-only)
- Save button → PUT /me/profile (multipart)
- Success → pop back, profile refreshed

---

## Phase 5: Detail Screens (Parallelizable)

### Step 5.1: Estimate Detail Screen

**File:** `ui/work/estimates/EstimateDetailScreen.kt` (NEW ~350 lines)
**File:** `ui/work/estimates/EstimateDetailViewModel.kt` (NEW ~120 lines)
- Header: estimate number, date, status badge
- Customer details card
- Items list (product, qty, rate, amount)
- Totals: subtotal, markup/discount, grand total, payment, balance due
- Action buttons based on status:
  - "Request Discount" (pending statuses)
  - "Submit Payment" with amount input (approved statuses)
  - "Download PDF" (all statuses)
- PDF download: save to Downloads + open with Intent

### Step 5.2: Quotation Detail Screen

**File:** `ui/work/quotations/QuotationDetailScreen.kt` (NEW ~300 lines)
**File:** `ui/work/quotations/QuotationDetailViewModel.kt` (NEW ~80 lines)
- Header: quotation number, type badge, status
- Customer details
- Room breakdown: room name, dimensions, area
- Items per room
- Totals: labour, material, grand total

---

## Phase 6: Notifications + FCM Deep Links

### Step 6.1: Notifications Screen

**File:** `ui/notifications/NotificationsScreen.kt` (NEW ~200 lines)
**File:** `ui/notifications/NotificationsViewModel.kt` (NEW ~60 lines)
- LazyColumn of notifications
- Read/unread styling (bold vs normal, white vs grey bg)
- Icon per notification type
- Time ago display
- Tap → navigate to relevant screen (deep link routing)
- Mark as read on tap

### Step 6.2: FCM Deep Link Integration

**File:** Update `QCFirebaseMessagingService.kt` (in main/ shared)
- Update deep link routing for native navigation instead of WebView URLs
- Map notification types to Compose navigation routes:
  - estimate_* → `estimate/{id}`
  - points_* / withdrawal_* → `profile/points`
  - offer_* → `catalog`
  - visualization_* → dashboard visualizations
  - training_* → `profile/training`
- Store pending deep link in SharedPreferences for cold start handling

**File:** Update `PainterMainActivity.kt`
- Check for pending deep link on onCreate
- Navigate after NavHost is ready

### Step 6.3: FCM Token Registration

**File:** Update `ui/auth/AuthViewModel.kt`
- After successful login, call `POST me/fcm/register` with token from SharedPreferences
- Handle token refresh re-registration

---

## Phase 7: Navigation + Wiring

### Step 7.1: Update Navigation Graph

**File:** `navigation/AppNavigation.kt` (UPDATE)
- Add composable routes for ALL new screens:
  - `profile/points` → PointsHistoryScreen
  - `profile/cards` → CardsScreen
  - `profile/visualizations` → VisualizationScreen
  - `profile/referrals` → ReferralsScreen
  - `profile/gallery` → GalleryScreen
  - `profile/training` → TrainingScreen
  - `profile/training/{id}` → TrainingDetailScreen
  - `profile/edit` → EditProfileScreen
  - `attendance/calendar` → AttendanceCalendarScreen
  - `notifications` → NotificationsScreen
  - `estimate/{id}` → EstimateDetailScreen
  - `quotation/{id}` → QuotationDetailScreen
- Remove all "Coming Soon" placeholder composables

### Step 7.2: Update Routes.kt

**File:** `navigation/Routes.kt` (UPDATE)
- Add route constants for new screens: Cards, Visualizations, Notifications

### Step 7.3: Update ProfileScreen

**File:** `ui/profile/ProfileScreen.kt` (UPDATE)
- Wire all quick action cards to actual navigation (Cards, Gallery, Referrals, etc.)
- Add notification bell icon to header
- Remove "Coming Soon" labels

### Step 7.4: Update DI Module

**File:** `di/AppModule.kt` (UPDATE)
- Provide all new API interfaces

---

## Phase 8: Backend — Minor Addition

### Step 8.1: Add hasPoints filter to catalog endpoint

**File (web project):** `routes/painters.js`
- In the `GET /me/catalog` handler, add optional `hasPoints` query parameter
- Filter products where points_per_unit > 0 when hasPoints=true

---

## Phase 9: Build + Version Bump

### Step 9.1: Version Bump
- Update `app/build.gradle.kts`: painter versionCode 10 → 11, versionName "2.0.0" → "2.1.0"

### Step 9.2: Build APK
```bash
cd qcpaintshop-android
./gradlew assemblePainterRelease
```

### Step 9.3: Send APK via Telegram

### Step 9.4: Update Skills.md + Memory

---

## Subagent Execution Strategy

**Parallel Group A (Foundation — must complete first):**
- Agent 1: Phase 1 (API layer + Models + DI)

**Parallel Group B (after Phase 1):**
- Agent 2: Phase 2 (Catalog upgrade)
- Agent 3: Phase 3 (Dashboard upgrade)
- Agent 4: Phase 4.1-4.4 (Points History, Cards, Visualization, Referrals)
- Agent 5: Phase 4.5-4.9 (Gallery, Training, Attendance Calendar, Edit Profile)
- Agent 6: Phase 5 (Estimate + Quotation detail screens)
- Agent 7: Phase 6 (Notifications + FCM)

**Parallel Group C (after all above):**
- Agent 8: Phase 7 (Navigation wiring) + Phase 8 (Backend) + Phase 9 (Build)

**Review after each group before proceeding.**
