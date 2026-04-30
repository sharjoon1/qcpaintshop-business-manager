# Admin Products UX — Design Spec

## Goal
Improve `admin-products.html` (Products tab + Zoho Import tab) with two improvements: (1) easier single-step Zoho-item-to-existing-product assignment, and (2) fully mobile-responsive layouts for both tabs.

## Architecture

### Backend
One new endpoint added to `server.js` (products endpoints live at lines ~2525–2700 in server.js, not a separate routes file):

```
POST /api/products/assign-zoho-item
Auth: requirePermission('products', 'manage')
Body: { product_id: int, zoho_item_id: string, size: number, unit: string, price: number }
Action:
  1. INSERT INTO product_pack_sizes (product_id, size, unit, price) → get new pack_size_id
  2. UPDATE product_pack_sizes SET zoho_item_id = ? WHERE id = pack_size_id
  3. Invalidate zoho_items_map mapping (mark as mapped)
Response: { success: true, pack_size_id: int }
```

No database schema changes. Uses existing `product_pack_sizes` table columns.

### Frontend
CSS media queries activate card layouts below 768px. Desktop table layout is preserved for ≥768px. No new pages — all changes are in `public/admin-products.html`.

---

## Feature 1: Inline "Add to Existing" Button

### Where it appears
In the Zoho Import tab, on every **unmapped** Zoho item row (both flat view and grouped view).

### Interaction flow
1. User clicks **"Add to Existing ▾"** button on an unmapped row
2. An inline search panel slides open below that row
3. User types a product name — debounced search calls `GET /api/products?search=<query>&limit=10`
4. Dropdown shows matching products with name + variant count
5. User clicks a product → confirmation: "Add [size][unit] @ ₹[price] to [product name]?"
6. On confirm → `POST /api/products/assign-zoho-item`
7. Row status updates to **Mapped ✓** inline (no page reload)
8. `zohoMappedIds` set updated so the mapped item is excluded from future unmapped counts

### Button placement
- Flat view: right side of each unmapped row alongside existing "Import" button — replace "Import" with two buttons: **"+ Create New"** (green) and **"Add to Existing ▾"** (blue)
- Grouped view: on the group card header alongside "Import Selected" — add **"Add to Existing ▾"** button next to it

### Error handling
- Product not found: show "No products found" in dropdown
- API failure: show inline red error message below the row, keep dropdown open

---

## Feature 2: Mobile-Responsive Products Tab (< 768px)

### Filter bar
- Search input + **"Filter ▾"** button in a single row
- Active filters shown as dismissible chips below the search bar
- "Filter ▾" opens a **bottom drawer** (slides up from bottom of screen) containing:
  - Brand dropdown
  - Category dropdown
  - Status toggle (All / Active / Inactive)
  - Type toggle (All / Area / Unit)
  - "Apply Filters" button + "Clear All" link

### Product list
- Replaces the desktop `<table>` on mobile
- Each product renders as a **card**:
  - Left: 44×44 product image (or paint icon placeholder)
  - Center: product name (truncated), brand · category, price badge + status badge + type badge
  - Right: stacked Edit / Del buttons
- Tap card (not buttons) → opens the existing edit modal
- Cards separated by 8px gap, no horizontal scroll

### Pagination
- "Load more" button at bottom instead of Prev/Next page buttons (same API, increments page)

### Add Product button
- Floating **"+ Add"** button in the filter bar row (top-right), replaces the desktop header button on mobile

---

## Feature 3: Mobile-Responsive Zoho Import Tab (< 768px)

### Filter bar
- Same pattern: Search + "Filter ▾" button row
- "⟳ Sync" button alongside
- Filter drawer: brand, category, mapped status (All / Unmapped / Mapped)

### Item list — Grouped view (default on mobile)
- Each product group renders as an **accordion card**:
  - **Header** (always visible): checkbox, product name, brand, unmapped count badge, **"New"** button (green) + **"Assign ▾"** button (blue), expand/collapse chevron
  - Unmapped groups: yellow border (`#fde68a` bg tint)
  - Fully-mapped groups: green border (`#d1fae5` bg tint), shows "All N variants mapped ✓", only "Edit" button
  - **Expanded body**: list of individual Zoho items, each showing: checkbox, color/size label, price, Mapped/Unmapped badge
- Tap chevron or header (not buttons) to expand/collapse
- Default state: unmapped groups expanded, mapped groups collapsed

### "Assign ▾" on group card
- Same inline search dropdown as Feature 1
- Assigns ALL checked items in the group to the selected product in one batch call (multiple `assign-zoho-item` calls in sequence)
- If no items checked, assigns the whole group

### Flat view toggle
- Small toggle chip at top: **"Grouped | Flat"** — flat view on mobile shows individual item cards (same as grouped expanded rows, but without group headers)

---

## Responsive Breakpoint Strategy

| Breakpoint | Products Tab | Zoho Import Tab |
|---|---|---|
| ≥ 768px | Existing desktop table (unchanged) | Existing desktop table (unchanged) |
| < 768px | Card list + filter drawer | Accordion groups + filter drawer |

Implementation: CSS class `.mobile-only { display: none }` / `.desktop-only { display: none }` toggled via media query. Card markup injected by existing `renderProducts()` and `renderZohoGroups()` JS functions — they check `window.innerWidth < 768` and render the appropriate markup.

---

## Files Changed

| File | Change |
|---|---|
| `public/admin-products.html` | All frontend changes (CSS + JS + HTML) |
| `server.js` (products section ~line 2525) | New `POST /api/products/assign-zoho-item` endpoint |

---

## Out of Scope
- Color variant system (separate sub-project B)
- Any changes to the painter Android app catalog
- Bulk Map tab mobile layout (lower priority, can follow separately)
- Any desktop layout changes
