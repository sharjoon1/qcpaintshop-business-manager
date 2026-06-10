# DECISIONS.md — Owner answers to open questions (master upgrade execution)

Source of the question IDs: `docs/PROJECT-REPORT-2026-06-10.md` §14.
Captured as they arrive; every phase that depends on a question must check here first.

## Answered

| Date | Question | Answer | Affects |
|---|---|---|---|
| 2026-06-10 | Phase-0 R1: how to give `qcpaintshop-android` a remote? | Create **private** GitHub repo `sharjoon1/qcpaintshop-android` (owner creates in browser); commit dirty files, merge `design/painter-app-ux-2026-05` → `master`, push all branches. | R1 |
| 2026-06-10 | Phase-0 DOC3: commit or discard the untracked docs? | **Commit all** (project report, `admin-dpl-hotfix.patch`, 3 superpowers plan docs). | DOC3 |
| 2026-06-10 | Phase-0 S14: where do service-account keys live? | `C:\Users\Hiii\.qc-secrets\` (user profile, outside any repo/sync folder). Publish scripts resolve via `PLAY_API_KEY_PATH` env → `~/.qc-secrets/play-api-key.json` → legacy folder fallback. | S14 |
| 2026-06-10 | Q-P3: how many audit findings actually remain open? | Answered by T8 tracker (`docs/audit/REMAINING-FINDINGS.md`): **527 total = 116 fixed / 27 likely-fixed / 384 open** (P0: 6 open, all from the product-inventory board). | T8, phase planning |
| 2026-06-10 | **Q-B10**: is the prod customer-OTP `console.log` relied on by support? | **No — remove it.** No operational workflow reads OTPs from pm2 logs. | Phase 1 / S2 |
| 2026-06-10 | **Q-B1**: painter credit overdue auto-debit basis | Owner delegated to executor recommendation: overdue check considers **only unpaid** self-billing invoices; after an auto-debit, **`credit_used` is reduced by the debited amount** (no repeat daily re-debits). | Phase 2 / M3 |
| 2026-06-10 | **Q-B2**: clawback visibility | Owner delegated to executor recommendation: **yes — absorbed clawbacks get a ledger entry** (`painter_point_transactions`), and netting runs inside the award transaction. | Phase 2 / M2 |
| 2026-06-10 | **Q-B3**: slab basis with dual attribution | Owner delegated to executor recommendation: **each invoice counts once per painter per period** (dedupe by invoice_id across direct/salesperson rows); basis otherwise unchanged (both billing types). | Phase 2 / M9 |

## Pending (asked at the phase that needs them)

| ID | Question | Needed by |
|---|---|---|
| Q-P2 | Exact prod DDL of the no-DDL Zoho tables (read-only `SHOW CREATE TABLE`)? | Phase 3 / D1 |
| Q-B7 | Make 2FA mandatory for admin/manager? | Phase 4 / S6 |
| Q-B5/Q-B6 | Extend DPL catalog to other brands? Pending non-standard SKU links? | Phase 6 / X1 |
| Q-B8 | Backfill `estimates.branch_id`? | Phase 6 / D7 |
| Q-B9 | Is the engineer portal live in production? | Phase 6 / S12 |
| Q-P1 | Prod Node/pm2/MariaDB versions, nginx config, `CORS_ORIGIN` set? | before tightening `engines` / infra work |
| Q-P4–P8 | Prod facts: AI provider flags, archival crontab, Android vc42/43 shipped?, WhatsApp HTTP fallback, Zoho sync intervals | as phases approach |
