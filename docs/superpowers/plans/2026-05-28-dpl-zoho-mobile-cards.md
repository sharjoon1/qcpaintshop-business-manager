# DPL Zoho Items — Mobile Card Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unusable wide table in the "All Zoho Items" DPL view with compact mobile cards on viewports ≤639px.

**Architecture:** Single file change — `public/admin-dpl.html`. New function `renderZohoAllCards()` inserted immediately before `renderZohoAllTable()`. A 1-line mobile guard at the top of `renderZohoAllTable()` delegates to it on mobile. All existing data-layer functions (`zohoAllTogglePdf`, `zohoAllEditSku`, `zohoAllEditName`, `zohoAllAssignPdf`, `zohoAllUpdateBtn`, `zohoAllToggleAll`, `zohoAllShowPicker`, `zohoAllHidePicker`, `zohoAllFilterPicker`, `zohoAllInitPicker`) are reused unchanged — they all work by element ID and data index, which the card layout preserves identically.

**Tech Stack:** Vanilla JS, inline HTML strings, no external dependencies — same pattern as the existing `renderZohoUncoveredCards()` function already in the file.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Modify** | `public/admin-dpl.html` | Add `renderZohoAllCards()` + mobile guard in `renderZohoAllTable()` |

---

### Task 1: Add `renderZohoAllCards()` and mobile guard

**Files:**
- Modify: `public/admin-dpl.html` — insert ~180-line function at line 2045 (just before `renderZohoAllTable()`), plus 1-line guard inside `renderZohoAllTable()`

---

- [ ] **Step 1: Locate the two insertion points**

  Open `public/admin-dpl.html`.

  Find the comment block at line 2046:
  ```
  // Render a Zoho-first view: brand-filtered Zoho items with matched DPL row or
  // a picker dropdown to assign one. Matched rows have checkboxes + push button.
  function renderZohoAllTable() {
  ```

  **Insertion point A** — the new function goes on the blank line at 2045, immediately before this comment.

  Find inside `renderZohoAllTable()` (line 2048 area):
  ```javascript
  function renderZohoAllTable() {
      var bodyEl = document.getElementById('aiMatchBody');
      if (!bodyEl) return;
  ```

  **Insertion point B** — the mobile guard goes as the very first line inside the function, before `var bodyEl`.

---

- [ ] **Step 2: Insert `renderZohoAllCards()` at insertion point A**

  Add the following block on the blank line immediately before the `// Render a Zoho-first view:` comment:

  ```javascript
  // Mobile card renderer for the Zoho-all view (viewport ≤639px).
  // Renders each Zoho item as a card into aiCardContainer.
  // All element IDs match the table version — existing handlers work unchanged.
  function renderZohoAllCards() {
      var cardCont = document.getElementById('aiCardContainer');
      if (!cardCont) return;
      var bodyEl = document.getElementById('aiMatchBody');
      if (bodyEl) bodyEl.innerHTML = '';
      aiApplyLayout(); // ensure cardCont visible, tableWrap hidden

      var brandKey  = aiBrandKey();
      var zohoItems = (aiData && aiData.zohoItems) || [];
      var pdfRows   = (aiData && aiData.items) || [];
      var search    = (document.getElementById('aiRowSearch').value || '').toLowerCase();
      var catF      = (document.getElementById('aiCatFilter') ? document.getElementById('aiCatFilter').value : '');

      var brandZoho = zohoItems.filter(function(z) {
          var b = (z.brand || '').replace(/[\s\-]/g, '').toLowerCase();
          return brandKey && b && b.indexOf(brandKey) !== -1;
      });

      var zohoToPdfIdx = {};
      pdfRows.forEach(function(r, idx) {
          if (r._matchedZohoId) zohoToPdfIdx[r._matchedZohoId] = idx;
      });

      var sorted = brandZoho.slice().sort(function(a, b) {
          var ca = (a.category || '').toUpperCase();
          var cb = (b.category || '').toUpperCase();
          if (ca !== cb) return ca < cb ? -1 : 1;
          return (a.name || '').localeCompare(b.name || '');
      });

      var totalMatched  = sorted.filter(function(z) { return zohoToPdfIdx[z.zoho_item_id] != null; }).length;
      var selectedCount = pdfRows.filter(function(r) { return r._selected && r._matchedZohoId; }).length;

      _zohoAllCachedPdfOpts = zohoAllUnmatchedPdfOpts();
      _zohoAllPickerInited  = {};

      var html = '';

      // ── Banner ──────────────────────────────────────────────────────────────
      html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
            + '<span style="font-size:12px;color:#14532d;font-weight:600"><b>' + totalMatched + '/' + sorted.length + '</b> '
            + esc(aiData.brand || 'brand') + ' items matched &middot; <b>' + (sorted.length - totalMatched) + '</b> unmatched</span>'
            + '<button id="zohoAllPushBtn" onclick="aiApplyAndPushToZoho()" ' + (selectedCount === 0 ? 'disabled ' : '')
            + 'style="padding:7px 14px;border:0;background:#1B5E3B;color:#fff;font-size:12px;font-weight:600;border-radius:6px;'
            + (selectedCount === 0 ? 'cursor:not-allowed;opacity:0.5' : 'cursor:pointer') + '">'
            + 'Push <span id="zohoAllPushCount">' + selectedCount + '</span> selected to Zoho</button>'
            + '</div>';

      var visible = 0;

      sorted.forEach(function(z) {
          var searchTxt = ((z.name || '') + ' ' + (z.sku || '') + ' ' + (z.category || '')).toLowerCase();
          if (search && searchTxt.indexOf(search) === -1) return;
          if (catF && (z.category || '').trim() !== catF) return;
          visible++;

          var pdfIdx   = zohoToPdfIdx[z.zoho_item_id];
          var pdf      = pdfIdx != null ? pdfRows[pdfIdx] : null;
          var hasMatch = !!pdf;
          var zid      = esc(String(z.zoho_item_id));
          var dplDate  = z.dpl_updated_at
              ? new Date(z.dpl_updated_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
              : '';

          var cardBorder = hasMatch ? '#bbf7d0' : '#fde68a';
          var cardBg     = hasMatch ? '#fff'    : '#fffbeb';

          html += '<div style="background:' + cardBg + ';border:1px solid #e2e8f0;border-left:3px solid ' + cardBorder + ';border-radius:8px;padding:11px 12px;margin-bottom:9px">';

          // ── Row 1: checkbox + name input/text + badge ──────────────────────
          html += '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px">';
          if (hasMatch) {
              html += '<input type="checkbox" id="zohoAllCb-' + pdfIdx + '" ' + (pdf._selected ? 'checked' : '')
                    + ' onchange="zohoAllTogglePdf(' + pdfIdx + ', this.checked)"'
                    + ' style="margin-top:3px;accent-color:#1B5E3B;flex-shrink:0">';
          } else {
              html += '<div style="width:14px;flex-shrink:0"></div>';
          }
          html += '<div style="flex:1;min-width:0">';
          if (hasMatch) {
              var p = pdf._proposed || {};
              var nameVal = p.editedName != null ? p.editedName : (p.proposedName || pdf.proposed_name || z.name || '');
              html += '<input type="text" value="' + esc(nameVal) + '" oninput="zohoAllEditName(' + pdfIdx + ', this.value)"'
                    + ' style="width:100%;font-size:12px;font-weight:600;color:#166534;padding:3px 6px;border:1px solid #a5b4fc;border-radius:5px;box-sizing:border-box;margin-bottom:2px">';
              if (z.name && z.name !== nameVal) {
                  html += '<div style="font-size:10px;color:#9ca3af;margin-bottom:2px;word-break:break-word">' + esc(z.name) + '</div>';
              }
          } else {
              html += '<div style="font-size:12px;font-weight:600;color:#92400e;word-break:break-word;margin-bottom:2px">' + esc(z.name || '') + '</div>';
          }
          html += '</div>';
          html += hasMatch
              ? '<span style="flex-shrink:0;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:#d1fae5;color:#065f46;white-space:nowrap">&#10003; Matched</span>'
              : '<span style="flex-shrink:0;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:#fef3c7;color:#92400e;white-space:nowrap">&#9888; No match</span>';
          html += '</div>'; // end row 1

          // ── SKU ─────────────────────────────────────────────────────────────
          if (hasMatch) {
              var p2 = pdf._proposed || {};
              var skuVal = p2.editedSku != null ? p2.editedSku : (p2.proposedSku || pdf.proposed_sku || z.sku || '');
              html += '<div style="margin:0 0 7px 22px">'
                    + '<input type="text" value="' + esc(skuVal) + '" oninput="zohoAllEditSku(' + pdfIdx + ', this.value)"'
                    + ' style="font-family:monospace;font-size:11px;color:#4338ca;font-weight:600;padding:2px 6px;border:1px solid #a5b4fc;border-radius:4px;width:100%;box-sizing:border-box">';
              if (z.sku && z.sku !== skuVal) {
                  html += '<div style="font-size:9px;color:#9ca3af;margin-top:1px">' + esc(z.sku) + '</div>';
              }
              html += '</div>';
          } else {
              html += '<div style="font-family:monospace;font-size:11px;color:#9ca3af;margin:0 0 7px 22px">' + esc(z.sku || '&#8212;') + '</div>';
          }

          // ── Price row (matched only) ─────────────────────────────────────────
          if (hasMatch) {
              var p3 = pdf._proposed || {};
              var proposedRate = p3.proposedRate || pdf.proposed_rate || null;
              if (!proposedRate && pdf.dpl) proposedRate = Math.ceil(parseFloat(pdf.dpl) * 1.18 * 1.10);
              var dplChanged  = pdf.dpl && z.cf_dpl && Math.abs(parseFloat(pdf.dpl) - parseFloat(z.cf_dpl)) >= 0.01;
              var rateChanged = proposedRate && z.rate && Math.abs(proposedRate - parseFloat(z.rate)) >= 1;

              html += '<div style="display:flex;gap:10px;align-items:center;margin:0 0 6px 22px;flex-wrap:wrap">';
              html += '<div><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">DPL Now</div>'
                    + '<div style="font-size:12px;font-weight:700;color:#059669">' + (z.cf_dpl > 0 ? fmt(z.cf_dpl) : '&#8212;') + '</div></div>';
              html += '<div style="color:#9ca3af;font-size:12px">&#8594;</div>';
              html += '<div><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">New DPL</div>'
                    + '<div style="font-size:12px;font-weight:700;color:' + (dplChanged ? '#dc2626' : '#059669') + '">'
                    + fmt(pdf.dpl) + (dplChanged ? ' <span style="font-size:9px">&#9650;</span>' : '') + '</div></div>';
              if (proposedRate) {
                  html += '<div><div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px">New Rate</div>'
                        + '<div style="font-size:12px;font-weight:700;color:' + (rateChanged ? '#dc2626' : '#059669') + '">'
                        + fmt(proposedRate) + (rateChanged ? ' <span style="font-size:9px">&#9650;</span>' : '') + '</div></div>';
              }
              html += '</div>'; // end price row

              var meta = [];
              if (pdf.packSize) meta.push('Pack: ' + esc(pdf.packSize));
              if (z.category)   meta.push(esc(z.category));
              if (dplDate)      meta.push('DPL: ' + esc(dplDate));
              if (meta.length) {
                  html += '<div style="font-size:10px;color:#9ca3af;margin:0 0 7px 22px">' + meta.join(' &middot; ') + '</div>';
              }
          }

          // ── Actions / assign picker ──────────────────────────────────────────
          html += '<div style="margin-left:22px">';
          if (hasMatch) {
              var isPushed = pdf._alreadyPushed;
              // Display pane
              html += '<div id="zohoAllMatchDisplay-' + zid + '" style="margin-bottom:4px">'
                    + '<div style="font-size:10px;color:#64748b;word-break:break-word;margin-bottom:4px">'
                    + esc((pdf.product || '') + (pdf.packSize ? ' \xb7 ' + pdf.packSize : '')) + '</div>'
                    + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
              if (isPushed) {
                  html += '<span style="background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;border-radius:3px;font-size:9px;font-weight:700;padding:1px 5px">&#10003; Pushed</span>';
              }
              html += '<button onclick="zohoAllShowPicker(\'' + zid + '\',' + pdfIdx + ')"'
                    + ' style="font-size:10px;padding:3px 10px;border:1px solid #d1d5db;border-radius:4px;background:#fff;color:#374151;cursor:pointer">Change Match</button>'
                    + '</div></div>'; // end display pane
              // Picker pane (hidden by default)
              html += '<div id="zohoAllPicker-' + zid + '" style="display:none">'
                    + '<input type="text" placeholder="&#128269; Search..." oninput="zohoAllFilterPicker(\'' + zid + '\', this.value, true)"'
                    + ' style="width:100%;font-size:11px;padding:4px 7px;border:1px solid #d1d5db;border-radius:4px;margin-bottom:4px;box-sizing:border-box">'
                    + '<select id="zohoAllSel-' + zid + '" onchange="zohoAllAssignPdf(\'' + zid + '\', this.value)"'
                    + ' style="width:100%;font-size:11px;padding:5px 7px;border:1px solid #4338ca;border-radius:4px;background:#fff;color:#374151;margin-bottom:4px"></select>'
                    + '<button onclick="zohoAllHidePicker(\'' + zid + '\')"'
                    + ' style="font-size:10px;padding:3px 10px;border:1px solid #e5e7eb;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer">Cancel</button>'
                    + '</div>'; // end picker pane
          } else {
              html += '<input type="text" placeholder="&#128269; Search product..." onfocus="zohoAllInitPicker(\'' + zid + '\')"'
                    + ' oninput="zohoAllFilterPicker(\'' + zid + '\', this.value, false)"'
                    + ' style="width:100%;font-size:11px;padding:4px 7px;border:1px solid #fcd34d;border-radius:4px;margin-bottom:4px;box-sizing:border-box;background:#fffbeb">'
                    + '<select id="zohoAllSel-' + zid + '" onchange="zohoAllAssignPdf(\'' + zid + '\', this.value)"'
                    + ' style="width:100%;font-size:11px;padding:5px 7px;border:1px solid #f59e0b;border-radius:4px;background:#fff;color:#374151">'
                    + '<option value="">&#8212; assign DPL row &#8212;</option></select>';
          }
          html += '</div>'; // end actions
          html += '</div>'; // end card
      });

      if (visible === 0) {
          html += '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:12px">No items match the current filter.</div>';
      }

      cardCont.innerHTML = html;
      zohoAllUpdateBtn();
  }

  ```

---

- [ ] **Step 3: Add mobile guard at insertion point B**

  Inside `renderZohoAllTable()`, replace the opening lines:

  ```javascript
  function renderZohoAllTable() {
      var bodyEl = document.getElementById('aiMatchBody');
      if (!bodyEl) return;
  ```

  with:

  ```javascript
  function renderZohoAllTable() {
      if (aiIsMobileLayout()) { renderZohoAllCards(); return; }
      var bodyEl = document.getElementById('aiMatchBody');
      if (!bodyEl) return;
  ```

---

- [ ] **Step 4: Verify in browser DevTools — mobile emulation**

  Open `http://localhost:3000/admin-dpl.html` in Chrome.

  Open DevTools → Toggle device toolbar (`Ctrl+Shift+M`) → set width to **375px** (iPhone SE).

  Upload a DPL PDF or CSV and click **Match**. Switch view dropdown to **All Zoho Items**.

  **Check:**
  - [ ] Cards render (not wide table)
  - [ ] Green left border on matched cards, amber on unmatched
  - [ ] Name shows as editable `<input>` on matched cards
  - [ ] SKU shows as editable monospace `<input>` on matched cards
  - [ ] Price row shows DPL Now → New DPL → New Rate with ▲ on changes
  - [ ] Checkbox visible on matched cards only
  - [ ] "Change Match" button shown on matched cards
  - [ ] Unmatched cards show search input + assign dropdown
  - [ ] Banner shows correct matched/total count + push button
  - [ ] Toggle device back to desktop (>639px) — table renders normally (not cards)

- [ ] **Step 5: Verify interactive actions on mobile**

  On 375px viewport:
  - [ ] Check a matched card checkbox → push button count increments
  - [ ] Edit name input on a matched card → value persists after re-render
  - [ ] Click "Change Match" → picker pane appears, display pane hides
  - [ ] Select a DPL row from picker → card re-renders with new match
  - [ ] Click "Cancel" in picker → display pane returns

---

- [ ] **Step 6: Commit**

  ```bash
  git add public/admin-dpl.html
  git commit -m "feat(dpl): mobile card layout for All Zoho Items view

  - renderZohoAllCards() renders each Zoho item as a card on ≤639px viewports
  - Matched cards: name/SKU editable inputs, DPL/rate change indicators, checkbox, Change Match picker
  - Unmatched cards: amber border, assign search + dropdown
  - Banner with matched/total count and Push button (same IDs as table — zohoAllUpdateBtn works unchanged)
  - renderZohoAllTable() delegates to cards on mobile with 1-line guard

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```

---

### Task 2: Deploy to production

**Files:** No changes — deploy only.

- [ ] **Step 1: Push to GitHub**

  ```bash
  git push origin master
  ```

- [ ] **Step 2: SSH deploy**

  ```bash
  ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager"
  ```

  **Expected:** PM2 shows `business-manager` online.

- [ ] **Step 3: Verify on production mobile**

  Open `https://act.qcpaintshop.com/admin-dpl.html` on a real mobile device.

  Run a DPL match → switch to All Zoho Items.

  **Check:**
  - [ ] Cards render (not a wide table)
  - [ ] All card elements readable without horizontal scroll
  - [ ] Push button works

---

## Self-Review

**Spec coverage:**
- ✅ Card layout for mobile (≤639px) — Task 1 Steps 2–3
- ✅ Banner: matched/total + push button — Step 2 (banner block)
- ✅ Matched card: checkbox, name input, SKU input, DPL→NewDPL→Rate, pack+category, Change Match picker — Step 2
- ✅ Unmatched card: amber border, assign search + dropdown — Step 2
- ✅ Desktop table unchanged — Step 3 (guard only runs on mobile)
- ✅ All existing handlers reused (same element IDs preserved) — confirmed in Step 5
- ✅ Deployed — Task 2

**Placeholder scan:** No TBDs. All HTML is complete inline code.

**Type consistency:**
- `zohoAllCb-{pdfIdx}` — used in `zohoAllToggleAll()` ✓
- `zohoAllSel-{zid}` — used in `zohoAllInitPicker()`, `zohoAllFilterPicker()` ✓
- `zohoAllPicker-{zid}` — used in `zohoAllShowPicker()`, `zohoAllHidePicker()` ✓
- `zohoAllMatchDisplay-{zid}` — used in `zohoAllShowPicker()`, `zohoAllHidePicker()` ✓
- `zohoAllPushBtn`, `zohoAllPushCount` — used in `zohoAllUpdateBtn()` ✓
- `_zohoAllCachedPdfOpts`, `_zohoAllPickerInited` — reset at start of `renderZohoAllCards()` ✓
