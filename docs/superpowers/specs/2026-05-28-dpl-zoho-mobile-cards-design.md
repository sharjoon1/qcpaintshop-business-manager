# DPL Admin — All Zoho Items Mobile Card Layout

## Goal

`admin-dpl.html`-ல் DPL matching முடிந்தவுடன் காட்டும் **"All Zoho Items" view** mobile-ல் unusable ஆக இருக்கிறது (10-column wide table). Mobile viewport-ல் (≤639px) ஒவ்வொரு Zoho item-உம் ஒரு compact card ஆக render ஆக வேண்டும்.

## Architecture

**Single file change:** `public/admin-dpl.html`

- New function `renderZohoAllCards()` — mobile card renderer (~150 lines)
- `renderZohoAllTable()` gets a 3-line mobile guard at the top that delegates to `renderZohoAllCards()`
- All existing data-layer functions (`zohoAllTogglePdf`, `zohoAllEditSku`, `zohoAllEditName`, `zohoAllAssignPdf`, `zohoAllUpdateBtn`, `zohoAllToggleAll`, `zohoAllShowPicker`, `zohoAllHidePicker`, `zohoAllFilterPicker`, `zohoAllInitPicker`) are reused unchanged
- Card container: `aiCardContainer` div (same element used by DPL card view)
- Table body: `aiMatchBody` is cleared before cards render

## Mobile Guard in renderZohoAllTable()

```javascript
function renderZohoAllTable() {
    // NEW: delegate to card renderer on mobile
    if (aiIsMobileLayout()) {
        renderZohoAllCards();
        return;
    }
    // ... existing table code unchanged ...
}
```

## renderZohoAllCards() — Full Spec

### Data Setup (same as renderZohoAllTable)
- `brandKey = aiBrandKey()`
- `zohoItems = aiData.zohoItems`
- `pdfRows = aiData.items`
- Filter zohoItems to current brand
- Build reverse map: `zoho_item_id → pdfRows index`
- Sort by category then name
- Apply search + category filter

### Output Target
- Clear `aiMatchBody` (table body element)
- Write all HTML into `aiCardContainer`

### Banner (first element, above cards)
```html
<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px 12px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px">
  <span style="font-size:12px; color:#14532d; font-weight:600">
    {totalMatched}/{total} {brand} Zoho items matched · {unmatched} unmatched
  </span>
  <button id="zohoAllPushBtn" onclick="aiApplyAndPushToZoho()" ...>
    Push <span id="zohoAllPushCount">{selectedCount}</span> selected to Zoho
  </button>
</div>
```
- Push button disabled + opacity:0.5 when selectedCount === 0 (same as table version)
- `id="zohoAllPushBtn"` and `id="zohoAllPushCount"` preserved — `zohoAllUpdateBtn()` updates these by id

### Per-Card Structure

**Matched card** (`border-left: 3px solid #bbf7d0; background: #fff`):

```
[☐] Item Name (editable input)          [✓ Matched]
    SKU (editable input, monospace)
    ─────────────────────────────────────
    DPL Now  →  New DPL      New Rate
    ₹X,XXX  →  ₹X,XXX ▲    ₹X,XXX ▲
    ─────────────────────────────────────
    Pack: XL · Category       [✓ Pushed?]
    DPL updated: DD MMM YYYY
    [Change Match]
```

**Unmatched card** (`border-left: 3px solid #fde68a; background: #fffbeb`):

```
    Item Name (plain text)               [⚠ No match]
    ─────────────────────────────────────
    🔍 Search product...
    [— assign DPL row — ▼]
```

### Card Detail

**Name field (matched):**
- `<input type="text">` with `oninput="zohoAllEditName({pdfIdx}, this.value)"`
- Priority: `p._proposed.editedName` → `p._proposed.proposedName` → `p.proposed_name` → `z.name`
- If zoho name ≠ current value: show original in grey below

**SKU field (matched):**
- `<input type="text" style="font-family:monospace">` with `oninput="zohoAllEditSku({pdfIdx}, this.value)"`
- Priority: `p._proposed.editedSku` → `p._proposed.proposedSku` → `p.proposed_sku` → `z.sku`
- If zoho SKU ≠ current value: show original in grey below

**Price columns (matched):**
- **DPL Now** → `z.cf_dpl` (green `#059669`), `—` if 0
- **New DPL** → `pdf.dpl`; red `#dc2626` + ▲ if changed vs `z.cf_dpl`; green if same
- **New Rate** → `pdf._proposed.proposedRate` or computed `ceil(dpl × 1.18 × 1.10)`; red + ▲ if changed vs `z.rate`
- Arrow separator `→` between DPL Now and New DPL
- Pack size + category shown as small grey text below prices
- DPL updated date shown if `z.dpl_updated_at`

**Checkbox (matched rows only):**
- `id="zohoAllCb-{pdfIdx}"` — same ID pattern as table, so `zohoAllToggleAll()` works unchanged
- `onchange="zohoAllTogglePdf({pdfIdx}, this.checked)"`
- Checked if `pdf._selected`

**"✓ Pushed" badge:** shown if `pdf._alreadyPushed`

**Match display/picker pane (matched):**
- Display pane: `id="zohoAllMatchDisplay-{zid}"` — shows proposedName + proposedSku + pdf product+packSize + "Change" button
- Picker pane: `id="zohoAllPicker-{zid}"` — search input + select + Cancel button (hidden by default)
- Same IDs as table version → `zohoAllShowPicker()` / `zohoAllHidePicker()` work unchanged

**Assign picker (unmatched):**
- Search input with `onfocus="zohoAllInitPicker('{zid}')"` + `oninput="zohoAllFilterPicker('{zid}', this.value, false)"`
- `<select id="zohoAllSel-{zid}">` with `onchange="zohoAllAssignPdf('{zid}', this.value)"`
- Same IDs as table version → lazy init + assignment work unchanged

### Empty State
If no visible items after filter: show centred grey message "No items match the current filter."

## Functions NOT Changed
- `zohoAllTogglePdf(pdfIdx, checked)` — works by pdfIdx, layout-agnostic
- `zohoAllToggleAll(checked)` — queries `#zohoAllCb-*` by ID, works in cards
- `zohoAllEditSku(pdfIdx, val)` — writes to `aiData`, layout-agnostic
- `zohoAllEditName(pdfIdx, val)` — writes to `aiData`, layout-agnostic
- `zohoAllAssignPdf(zid, val)` — updates match map, calls `renderZohoAllTable()` (which re-dispatches to cards on mobile)
- `zohoAllUpdateBtn()` — updates `#zohoAllPushBtn` + `#zohoAllPushCount` by ID, works in cards
- `zohoAllShowPicker(zid, pdfIdx)` — shows `#zohoAllPicker-{zid}`, works in cards
- `zohoAllHidePicker(zid)` — hides `#zohoAllPicker-{zid}`, works in cards
- `zohoAllFilterPicker(zid, q, isMatched)` — filters `#zohoAllSel-{zid}`, works in cards
- `zohoAllInitPicker(zid)` — populates `#zohoAllSel-{zid}` lazily, works in cards
- `_zohoAllCachedPdfOpts`, `_zohoAllPickerInited` — reset inside `renderZohoAllTable()` before dispatch, still works

## Viewport Breakpoint
Mobile card view: `window.matchMedia('(max-width:639px)').matches` — same as `aiIsMobileLayout()`

## Self-Review

**Placeholder scan:** No TBDs or TODOs. All field priorities, IDs, and event handlers fully specified.

**Internal consistency:** All element IDs (`zohoAllCb-*`, `zohoAllSel-*`, `zohoAllPicker-*`, `zohoAllMatchDisplay-*`, `zohoAllPushBtn`, `zohoAllPushCount`) match what existing functions query. No ID collisions.

**Scope:** Single file, single new function + 3-line guard. No backend changes.

**Ambiguity check:** `zohoAllUpdateBtn()` is called after toggle — it queries `#zohoAllPushBtn` by ID which exists in the banner rendered by `renderZohoAllCards()`. ✓
