# KAI AI Items Editor - Design Document

## Goal

Add an AI-powered command bar to the Zoho Items Edit page (`admin-zoho-items-edit.html`) that lets users edit items via natural language commands before pushing to Zoho. Full AI control — KAI sees all item data, can do formulas, smart fixes, anomaly detection, and bulk edits.

## Architecture

**Command Bar UI** → `POST /api/zoho/items/ai-edit` → AI Engine (Clawdbot/KAI) → JSON edits → Apply to client-side `dirtyItems` → Review → Push to Zoho

### Frontend: Command Bar

- **Position**: Between the toolbar row (column toggles, % adjuster) and the search row
- **Components**:
  - Text input for natural language commands
  - "Apply" button (gradient, matches existing toolbar style)
  - Loading spinner during AI processing
  - Scope indicator: "Applying to X selected items" or "Applying to all X items"
- **Quick Command Pills**: Row of preset buttons below input:
  - "Set DPL = 80% of Rate"
  - "Round rates to nearest 10"
  - "Find price anomalies"
  - "Fill missing HSN codes"
  - "Standardize brand names"
- **Result Banner**: After AI applies changes:
  - Green banner with summary text: "Updated 45 items: set DPL to 80% of rate"
  - "Undo AI Changes" button to revert the batch
  - Auto-dismisses after 30 seconds or on next command

### Scope Logic

- If items have checkboxes selected (`selectedItemIds.size > 0`): AI processes only selected items
- If no selection: AI processes ALL loaded items
- Command bar shows real-time scope: "12 selected" or "all 450 items"

### Backend: New Endpoint

**`POST /api/zoho/items/ai-edit`** in `routes/zoho.js`

Request:
```json
{
  "command": "Set DPL to 80% of rate for Asian Paints items",
  "items": [
    { "zoho_item_id": "123", "name": "Apex Emulsion 1L", "rate": 1200, "purchase_rate": 800, "cf_dpl": 1100, "brand": "Asian Paints", "unit": "pcs", "category_name": "Interior", "sku": "AP-001" },
    ...
  ]
}
```

Response:
```json
{
  "success": true,
  "edits": [
    { "zoho_item_id": "123", "changes": { "cf_dpl": 960 } },
    { "zoho_item_id": "456", "changes": { "cf_dpl": 680 } }
  ],
  "summary": "Updated 45 items: set DPL to 80% of rate for Asian Paints brand",
  "warning": null
}
```

### AI System Prompt (Items Editor Persona)

KAI gets a specialized system prompt for items editing:
- Role: Zoho Items Editor for a paint retail business
- Input: User command + full item data as JSON array
- Output: MUST return valid JSON with `edits[]` array and `summary` string
- Editable fields: rate, purchase_rate, cf_dpl, unit, hsn_or_sac, brand, category_name, manufacturer, reorder_level, description, cf_product_name, sku, tax_percentage
- Read-only fields (for context only): name, stock_on_hand, last_synced
- Rules: Never change zoho_item_id or name. Round numeric values to 2 decimals. If command is unclear, return empty edits with a clarifying summary.

### Undo System

- Before applying AI edits, snapshot the current state of affected items
- `aiUndoStack` stores `{ edits[], previousValues[] }`
- "Undo AI Changes" reverts `dirtyItems` to pre-AI state
- Only 1 level of undo (last AI command)

### Error Handling

- AI returns invalid JSON → show error toast, no changes applied
- AI returns edits for non-existent items → skip those, warn in summary
- AI timeout (>30s) → abort, show timeout message
- No edits returned → show info: "KAI found nothing to change"

### Mobile UX

- Command bar stacks vertically on mobile (full width)
- Quick commands: horizontal scroll row (same as AI chat quick prompts)
- Result banner: full width, compact text

## Files to Create/Modify

- **Modify**: `public/admin-zoho-items-edit.html` — Add command bar UI, quick commands, result banner, AI apply/undo logic
- **Modify**: `routes/zoho.js` — Add `POST /items/ai-edit` endpoint
- **No new files needed** — uses existing `ai-engine.js` for AI calls

## Not In Scope

- Multi-turn chat conversations (single command → single response)
- Persisting AI edit history to database
- AI auto-push (always requires manual Push to Zoho)
- Custom quick commands (hardcoded presets for now)
