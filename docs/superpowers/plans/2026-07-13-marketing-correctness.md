# Marketing Correctness Batch — PNTR bridge + ENUM hotfix, delivery tracking, opt-out, send-from, scheduling

## Context

Owner-selected batch (2026-07-12) from the three-domain discovery: make staff marketing work
correct and complete. Five workstreams, one of which became a **P0 live-crash hotfix** during
planning: the painter-leads followup endpoint deployed 2026-07-12 inserts outcome/type values that
are NOT in the prod ENUMs, and prod runs `STRICT_TRANS_TABLES` (verified live) — 6 of 8 outcomes
and the UI-offered "sms" type will 500 as soon as staff use the new page. The other four: PNTR
daily-call alerts read `painter_daily_assignments` which the new flow never stamps (perpetual
"0% complete" staff/manager alerts); campaign Delivered/Read KPIs are permanently 0; WhatsApp
opt-out/STOP handling doesn't exist anywhere (compliance + number-ban risk on whatsapp-web.js);
the wizard's "Send from" choice is silently dropped; scheduling has no UI (and a latent TZ bug).

Owner decisions: BRIDGE the old assignments table (not retire the crons); batch approved as
"marketing correctness". Execution: Build+Judge per commit (proven pattern), sequential CM1→CM5.

## Verified facts (all file:line checked 2026-07-12/13)

- `painter_lead_followups.outcome` = ENUM(old 7 values only); `followup_type` = ENUM('call','whatsapp','visit') — no 'sms'; `call_status` ENUM('connected','not_answered','wrong_number','switched_off','busy') inserted unvalidated (`api.js:886`). Prod sql_mode STRICT_TRANS_TABLES; 367 old rows. New endpoint `routes/painter-leads/api.js:795-937` inserts NEW outcomes ('interested','callback','no_response','converted','unreachable','other') + type 'sms' → strict-mode 500 inside its transaction.
- `painter_daily_assignments(user_id, branch_id, painter_lead_id, assigned_date, contacted_at, contact_outcome varchar(50))`, UNIQUE(user_id,painter_lead_id,assigned_date). Old (orphaned) stamp: `routes/painter-marketing.js:113-118`. Readers count done = `contacted_at IS NOT NULL` (scheduler 17:00 `:187-191`, 18:00 `:207-213`; `admin/performance` `painter-marketing.js:604-616`, whose `interested` metric matches `contact_outcome IN ('interested_in_program')` — old vocab). New handler has `lead.assigned_to`; managers/admins may act on others' leads. `contact_outcome` is varchar — NOT an enum.
- `wa_campaigns` already has scheduled_at, delivered_count, read_count, send_from_branch_id (INT DEFAULT 0 via `migrate-wa-campaign-send-from.js`; every existing row = 0 because routes drop the field). `wa_campaign_leads` has status ENUM incl. 'delivered','read','skipped' + delivered_at/read_at but NO whatsapp_msg_id. `wa_instant_messages`: no msg-id column AND status ENUM has NO 'skipped'. `whatsapp_messages` has whatsapp_msg_id + index.
- Engine `services/wa-campaign-engine.js`: send at :392-410 — `sent` is the whatsapp-web.js message object (`sent.id._serialized`) but treated as boolean; success UPDATE :413-421; session = `campaign.branch_id` only (:267); rate limits + `wa_sending_stats` keyed on `campaign.branch_id` (:280-292, :421); consecutive-failure auto-pause reads `status IN ('sent','failed')` (:330-333) — 'skipped' safe; next-lead picks `status='pending'` (:310) → rows stuck 'sending' after a restart are orphaned. `sendMessage` returns `sentMsg || true` and returns `false` (no throw) when no session (session-manager:421,:447); instant-send ignores the return (`wa-marketing.js:957-975`) and sends TWO messages for media+text.
- Ack handler `services/whatsapp-session-manager.js:312-337`: ack 2=delivered ≥3=read; updates ONLY `whatsapp_messages` by msg id. Hot path (fires for OTP/receipts/chat too).
- Routes: create `wa-marketing.js:152-181` drops send_from_branch_id (also PUT :192-194, duplicate :447-454); start :322-357 accepts scheduled_at (no validation); populate :245/:261-267 + `buildLeadFilterQuery` :841-848; instant fetch :878-885. UI `admin-wa-marketing.html`: wizard sends send_from_branch_id (:1435, options 0=General/-1=Admin); BOTH start calls send `{}` (:1466, :1037); no datetime input; dashboard has no Delivered/Read tiles (:122-139, loadDashboard :898-940) though the API returns them (:608-615).
- Opt-out: zero suppression anywhere (schema-wide verified). Single inbound handler session-manager:205 (phone → `91XXXXXXXXXX` at :210; groups filtered :208; reply possible via in-scope client). ALL sends funnel through `sendMessage`(:407)/`sendMedia`(:458) which normalize phone (:429-434/:485-490) and accept `metadata.source`. Marketing sources: campaign engine (currently sends NO metadata → 'system'), instant-send (same), `painter_invite` (`painter-leads/api.js:171`), `painter_marketing_admin` (`painter-marketing.js:465`). Everything else is transactional. `leads.phone` ≈ 10-digit; inbound 12-digit — canonical key = last-10 (tested helpers: `pntr-import-service.js:1`, `painter-leads/api.js:85`).
- **TZ fact**: DB session TZ is forced `+00:00` (config/database.js) → SQL `NOW()` is UTC; engine activates `scheduled_at <= NOW()` — a naive IST datetime stored raw fires **5.5h late**. Route must convert IST→UTC on store.

## Commits (each: full `npm test` + `npm run lint` green; Build+Judge; baseline 76 suites/1,062 tests @ 574a633)

### CM1 — P0 HOTFIX (ships + deploys alone, migration BEFORE pm2 restart)
1. `migrations/20260713_painter_followup_enums.js` (idempotent via information_schema COLUMN_TYPE check, house shape, direct-run block): append to `painter_lead_followups.outcome` ENUM **at the end** the 6 new values ('interested','callback','no_response','converted','unreachable','other' — do NOT reorder/dedupe existing); append 'sms' to `followup_type` ENUM. End-append = INSTANT.
2. `routes/painter-leads/api.js`: add `VALID_CALL_STATUSES = ['connected','not_answered','wrong_number','switched_off','busy']` validation → 400 (not strict-mode 500).
3. **PNTR bridge** in the same handler, inside the existing transaction (~:909, via `conn`): `UPDATE painter_daily_assignments SET contacted_at = NOW(), contact_outcome = ? WHERE painter_lead_id = ? AND assigned_date = CURDATE()` + `AND user_id = ?` (with `lead.assigned_to`) when assigned_to is non-null. Store the NEW outcome value as-is (column is varchar). 0 rows matched = success (lead not in today's list). Same-day second followup overwrites contact_outcome (last-wins, matches old behavior — state in commit msg).
4. Reader fix: `painter-marketing.js:604-616` `interested` metric → `contact_outcome IN ('interested_in_program','interested')`.
5. Tests (extend `tests/unit/painter-leads.test.js`, fake-pool style): all 8 outcomes accepted; 'sms' type accepted; invalid call_status → 400 before any INSERT; bridge UPDATE present in tx with expected WHERE/params; manager acting on another's lead stamps assigned_to's row; migration up() idempotency.

### CM2 — Delivered/Read tracking
1. `migrations/20260713_wa_delivery_tracking.js`: `whatsapp_msg_id VARCHAR(100) NULL` + KEY on `wa_campaign_leads` AND `wa_instant_messages`; append 'skipped' to `wa_instant_messages.status` ENUM (needed by CM3, harmless early).
2. New `services/wa-ack-tracker.js`: `applyMarketingAck(pool, msgId, ack)` — **conditional UPDATEs, affectedRows-gated counters** (no SELECT-then-UPDATE): delivered: `UPDATE wa_campaign_leads SET status='delivered', delivered_at=NOW() WHERE whatsapp_msg_id=? AND status='sent'` → iff affected, bump campaign delivered_count; read: run delivered-upgrade first (bumps delivered too on sent→read skip), then `SET status='read', read_at=NOW() WHERE ... AND status='delivered'` → iff affected bump read_count. Mirror (statuses/timestamps only) for `wa_instant_messages`. Idempotent + downgrade-proof by construction.
3. Ack handler: keep existing whatsapp_messages update first; early-return `ack < 2`; call tracker in its own try/catch (never break chat receipts).
4. Engine: capture `sent`, guard `sent && sent.id?._serialized`, persist msg id in the success UPDATE; **read-back catch-up** (ack race): after persisting, read `whatsapp_messages.status` for that id and apply via the tracker if already delivered/read. Startup sweep in `start()`: `UPDATE wa_campaign_leads SET status='pending' WHERE status='sending'` (restart-orphan recovery).
5. Instant-send: capture return; `false` → mark failed (currently mislabeled 'sent'); media+text sends two messages — persist the FINAL (text) message's id.
6. UI: Delivered/Read KPI tiles in the dashboard grid + loadDashboard binding (API already returns totals).
7. Tests: new `tests/unit/wa-ack-tracker.test.js` transition matrix (sent→delivered bumps once; sent→read bumps both; delivered→read bumps read only; repeat acks no-op; unknown id no-op; late delivered after read no-op); engine fake-pool msg-id-persist + read-back; instant false-return → failed; content-contract tiles.

### CM3 — Opt-out / STOP
1. `migrations/20260713_wa_opt_outs.js`: `wa_opt_outs (phone_key CHAR(10) PRIMARY KEY, opted_out_at DATETIME NOT NULL, source VARCHAR(30), raw_from VARCHAR(50), branch_id INT NULL)`.
2. New `services/wa-optout-service.js` (pure + pool fns): `detectKeyword(body)` → 'stop'|'start'|null (case-insensitive, trimmed, trailing-punctuation-stripped, exact-word: STOP/UNSUBSCRIBE/OPTOUT/UNSUB; START/RESUME/SUBSCRIBE); `phoneKey(raw)` last-10; `isOptedOut(pool, phone)`; `recordOptOut/recordOptIn`; exported `MARKETING_SOURCES = ['campaign','instant','painter_invite','painter_marketing_admin']`.
3. Inbound handler (session-manager:205, right after phone at :210, before media branch): STOP → record + confirmation reply; START → remove + reply. Replies bilingual (English + Tamil; Tamil must NOT open with வணக்கம்), sent via the module's own `sendMessage` with source `'optout'` so they are **recorded in the chat thread** and never themselves suppressed.
4. Enforcement in `sendMessage`/`sendMedia` before `client.sendMessage`: if `metadata.source` ∈ MARKETING_SOURCES and target's phoneKey is opted out → throw Error with `code='OPTED_OUT'`.
5. Engine passes `{source:'campaign'}`, instant-send `{source:'instant'}` (load-bearing — without metadata the gate is bypassed). All FOUR marketing call sites handle OPTED_OUT: engine → lead status 'skipped', NO failed_count, NO sending-stat bump, continue loop; instant → row 'skipped' (ENUM extended in CM2); `painter_invite` + `painter_marketing_admin` → clean 400 "painter has opted out of WhatsApp".
6. Audience exclusion (courtesy layer; send-time gate is the real one): `NOT EXISTS (SELECT 1 FROM wa_opt_outs o WHERE o.phone_key = RIGHT(REGEXP_REPLACE(l.phone,'[^0-9]',''),10))` in populate (both paths), `buildLeadFilterQuery`, and instant fetch — NOT EXISTS, not NOT IN (NULL pitfall).
7. Tests: keyword matrix incl. 'STOP.' / 'stop!' / 'stop by the shop' (no match); phoneKey 10/12-digit/formatted; enforcement throws only for marketing sources ('estimate' passes); engine skip path (fake pool: 'skipped' UPDATE present, failed_count absent); populate SQL contains NOT EXISTS; Tamil reply string does not start with வணக்கம்.

### CM4 — Send-from honored
1. `migrations/20260713_wa_send_from_nullable.js`: `MODIFY send_from_branch_id INT NULL DEFAULT NULL` + `UPDATE wa_campaigns SET send_from_branch_id = NULL` (**mandatory backfill** — every existing row is an unintentional 0; without NULL-out, deploy silently reroutes existing/running campaigns to the General session).
2. Routes: `parseSendFrom(v)` helper ('' / null / undefined → null; else parseInt; validate ∈ {-1, 0, active branch ids} → 400 otherwise); persist in create INSERT, PUT, duplicate.
3. Engine: `effectiveBranchId = campaign.send_from_branch_id ?? campaign.branch_id` computed once in `processCampaign` and used for **isConnected, hourly/daily limit reads, the send calls, and incrementSendingStat** (rate limits must key on the actual sending session or two branches sharing General double the anti-block budget).
4. Tests: parseSendFrom matrix; engine test asserting session/limits/stats all use -1 when send_from=-1 and branch_id when NULL; route INSERT column-list test.

### CM5 — Schedule picker
1. Start route: validate scheduled_at (reject past beyond 2-min grace, reject >30 days); **convert IST wall-clock input → UTC before storing** (DB session is +00:00; storing raw IST fires 5.5h late). Accept 'YYYY-MM-DDTHH:mm' from datetime-local.
2. Wizard: datetime-local input in the review step; `createAndStartCampaign` threads `scheduled_at` (raw input string, no toISOString) into the start body only when set; list-path start stays immediate. UI copy: "starts within ~1 minute of the scheduled time".
3. Tests: route validation + IST→UTC conversion unit tests (pure helper, exported); content-contract: input present, wizard JS sends the raw value.

## Out of scope (recorded in discovery doc)
Nurture buttons (`ai-lead-manager.js` schema mismatch — needs its own design: fix-or-remove), campaign log CSV export, Tamil STOP keyword (product question), promotional SMS, ROI attribution, retention automation.

## Verification
- Per commit: full suite + lint (judge re-runs independently).
- Deploy CM1 immediately after its judge PASS (hotfix): push → prod `git stash && git pull && npm install` → `node migrations/20260713_painter_followup_enums.js` + `INSERT IGNORE _migrations` marker → `pm2 restart` → curl /health → prod read-only check `SHOW COLUMNS FROM painter_lead_followups LIKE 'outcome'` shows widened ENUM.
- CM2-CM5 deploy together after all judges PASS: same procedure, run the three 20260713 migrations + markers.
- Post-deploy live checks: log one followup via the staff page (each outcome type OK, `painter_daily_assignments.contacted_at` stamped); send a 2-lead test campaign to owner-controlled numbers → Delivered/Read tick up in dashboard; text STOP from one number → confirmation reply arrives, campaign resend marks it skipped; text START → re-enabled; create a campaign scheduled 5 min out (IST) → activates on time.
