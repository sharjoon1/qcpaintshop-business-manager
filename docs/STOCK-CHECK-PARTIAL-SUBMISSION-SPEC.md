# Stock Check Partial Submission - Developer Specification

**Date:** 2026-02-24  
**Requested by:** Sharjoon (Quality Colours Owner)  
**For:** Claude Code (Developer)  
**Component:** Stock Check Assignment Mobile/Web UI

---

## Business Context

Staff are assigned stock checks with **300-1,100 items per assignment**. Current system requires submitting ALL items at once — staff cannot save progress mid-way. This is impractical for large assignments.

**Business Requirement:** Enable staff to:
1. Check items in batches (e.g., 50-100 at a time)
2. Save progress without final submission
3. Resume checking from where they left off
4. See completion progress (e.g., "245/1,109 items checked")
5. Submit final when all items are done

---

## Technical Implementation

### Backend (Already Implemented ✅)

Two new API endpoints have been added to `/routes/stock-check.js`:

#### 1. Save Progress (Partial Submission)
```
POST /api/stock-check/save-progress/:id
```

**Purpose:** Save partial item counts without changing assignment status to "submitted"

**Request Body:**
```json
{
  "items": [
    {
      "zoho_item_id": "2032688000000123456",
      "reported_qty": 25.5,
      "notes": "Optional note about this item"
    },
    {
      "zoho_item_id": "2032688000000123457",
      "reported_qty": 10.0
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Saved 2 items",
  "data": {
    "saved": 2,
    "total": 1109,
    "checked": 247,
    "remaining": 862,
    "progress_pct": 22
  }
}
```

**Notes:**
- Assignment status remains "pending"
- Each item's `submitted_at` timestamp is updated
- Staff can call this endpoint multiple times
- Photos can be uploaded (multipart/form-data) same as final submit

---

#### 2. Get Progress Status
```
GET /api/stock-check/progress/:id
```

**Purpose:** Retrieve current progress on an assignment

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "pending",
    "total": 1109,
    "checked": 247,
    "remaining": 862,
    "discrepancies": 12,
    "progress_pct": 22,
    "checked_items": [
      {
        "zoho_item_id": "2032688000000123456",
        "item_name": "Asian Paints Tractor Emulsion - White - 20L",
        "item_sku": "AP-TE-WHT-20L",
        "system_qty": 10.0,
        "reported_qty": 8.0,
        "difference": -2.0,
        "notes": "2 buckets damaged"
      }
    ]
  }
}
```

---

#### 3. Final Submission (Existing Endpoint)
```
POST /api/stock-check/submit/:id
```

**Behavior Change:**
- Now accepts partial submission (same as save-progress)
- Changes assignment status from "pending" → "submitted"
- Notifies admin
- Use this when staff confirms ALL items are counted

---

## Frontend UI Requirements

### 1. Assignment Detail Screen (New Features)

**Progress Indicator (Top of Screen)**
```
┌─────────────────────────────────────────┐
│  Stock Check Progress                   │
│  ████████░░░░░░░░░░░░░░░░ 245/1,109    │
│  22% Complete · 864 Remaining           │
└─────────────────────────────────────────┘
```

**Display:**
- Progress bar showing checked/total
- Percentage completion
- "X items remaining"
- Update in real-time as staff checks items

---

### 2. Item List (Filtering Options)

**Add Filter Tabs:**
```
[ All (1,109) ] [ Unchecked (864) ] [ Checked (245) ] [ Discrepancies (12) ]
```

**Default View:** Show **Unchecked items first** (auto-filter)

**Why:** Staff don't need to scroll through already-checked items. Focus on what's left to do.

---

### 3. "Save Progress" Button

**Location:** Bottom of screen (sticky footer)

**Behavior:**
- Enabled when at least 1 item has been counted (reported_qty entered)
- Calls `/api/stock-check/save-progress/:id`
- Shows success toast: "Saved 12 items. 852 remaining."
- Does NOT navigate away — staff can continue checking

**Button States:**
```
┌──────────────────────────┐
│  Save Progress (12 new)  │  ← When items are entered
└──────────────────────────┘

┌──────────────────────────┐
│  ✓ Progress Saved        │  ← After successful save (2 sec)
└──────────────────────────┘

┌──────────────────────────┐
│  Save Progress           │  ← Default state (nothing new to save)
└──────────────────────────┘
```

---

### 4. "Submit Final" Button

**Location:** Only show when **all items are checked** (checked === total)

**Confirmation Modal:**
```
┌────────────────────────────────────────┐
│  Submit Stock Check?                   │
│                                        │
│  You have checked all 1,109 items.     │
│  This will mark the assignment as      │
│  complete and notify your manager.     │
│                                        │
│  [ Cancel ]        [ Submit Final ]    │
└────────────────────────────────────────┘
```

**After Submit:**
- Calls `/api/stock-check/submit/:id`
- Navigate back to "My Assignments" screen
- Show success message

---

### 5. Resume Flow (On Opening Assignment)

**When staff opens an assignment with partial progress:**

1. Call `GET /api/stock-check/progress/:id` on load
2. Display progress bar with current stats
3. Auto-filter to "Unchecked" items
4. Optionally show a "Resume" banner:

```
┌────────────────────────────────────────┐
│  ↻ Resuming from 22% complete          │
│  You last saved progress 2 hours ago    │
└────────────────────────────────────────┘
```

---

### 6. Item Row (Visual Indicator)

**Checked Item:**
```
┌────────────────────────────────────────┐
│  ✓ Asian Paints Tractor Emulsion       │
│     System: 10.0 | Counted: 8.0        │
│     Diff: -2.0 (20% short) ⚠️          │
└────────────────────────────────────────┘
```

**Unchecked Item:**
```
┌────────────────────────────────────────┐
│  ○ Asian Paints Apex Exterior          │
│     System: 15.0 | [Tap to count]      │
└────────────────────────────────────────┘
```

---

### 7. Auto-Save (Optional Enhancement)

**Behavior:**
- Auto-save every 5 items entered (or every 2 minutes)
- Silent save in background
- Show small toast: "Auto-saved" (1 sec fade)

**Benefits:**
- Staff don't lose work if app crashes/phone battery dies
- Reduces need to manually click "Save Progress"

---

## User Flow Example

**Scenario:** Manikandan has 1,109 items to check at Main Branch

1. Opens assignment → sees "0/1,109 · 0% Complete"
2. Starts checking items (enters counts)
3. After 50 items, clicks **"Save Progress (50 new)"**
4. Toast: "Saved 50 items. 1,059 remaining."
5. Takes a break (lunch, customer service, etc.)
6. Returns later, reopens assignment
7. Banner: "Resuming from 5% complete"
8. Continues from item 51 (unchecked filter active)
9. Repeats save progress every 50-100 items
10. After item 1,109, **"Submit Final"** button appears
11. Clicks Submit → Confirmation modal → Done

**Total time:** Can span multiple days if needed

---

## Database Schema (Reference)

**Table:** `stock_check_assignments`
- `status` ENUM: 'pending', 'submitted', 'reviewed', 'adjusted'
- Status remains **'pending'** during partial saves
- Only changes to **'submitted'** on final submit

**Table:** `stock_check_items`
- `reported_qty`: Decimal (null until staff enters count)
- `submitted_at`: Timestamp (updated on each save)
- `difference`: Auto-calculated (reported_qty - system_qty)

---

## Testing Checklist

### Functional Tests
- [ ] Save progress with 1 item
- [ ] Save progress with 100 items
- [ ] Save progress multiple times (should append, not overwrite)
- [ ] Resume assignment shows correct progress
- [ ] Filter tabs work (All/Unchecked/Checked/Discrepancies)
- [ ] Final submit disabled until all items checked
- [ ] Final submit changes status to 'submitted'
- [ ] Progress bar updates correctly
- [ ] Photo upload works with partial save

### Edge Cases
- [ ] Save progress with 0 items (should show error)
- [ ] Network failure during save (retry logic)
- [ ] Two staff members assigned same branch (shouldn't happen, but handle gracefully)
- [ ] Assignment already submitted (disable save button)
- [ ] Large assignment (1,000+ items) loads without lag

### UX Tests
- [ ] Clear visual difference between checked/unchecked items
- [ ] Progress bar is prominent and easy to read
- [ ] "Save Progress" button always visible (sticky footer)
- [ ] Filter tabs switch instantly (no loading delay)
- [ ] Toast messages are brief and informative

---

## UI Mockup References

**Priority:** 
1. Progress indicator (top)
2. Filter tabs (All/Unchecked/Checked)
3. Save Progress button (sticky footer)
4. Submit Final (only when 100% done)

**Secondary:**
- Auto-save
- Resume banner
- Item visual indicators (✓/○)

---

## Questions for Developer

1. **Mobile App or Web UI?** (or both?)
2. **Framework?** (React Native, Flutter, Web React, etc.)
3. **Current item entry method?** (manual input, barcode scan, etc.)
4. **Photo upload?** Already implemented or new feature?

---

## Success Metrics

**Before Implementation:**
- Staff abandon large assignments (>500 items)
- Complaints about losing progress

**After Implementation:**
- 100% completion rate on all assignments
- Average session time: 15-30 min (can do in chunks)
- Zero lost progress complaints

---

## Notes from Business Manager (QC Manager)

**Critical Requirements:**
1. **Never lose progress** — even if app crashes
2. **Clear visibility** — staff must know how much is left
3. **Simple UX** — one-click save, minimal taps
4. **Fast loading** — assignments with 1,000+ items must load quickly

**Nice-to-Have:**
- Offline mode (save locally, sync when online)
- Batch barcode scanning (scan 10 items, enter counts for all)
- Voice input for counts ("fifteen", "twenty point five")

---

**End of Specification**

Save this doc in: `/www/wwwroot/act.qcpaintshop.com/docs/`  
Share with Claude Code for implementation.
