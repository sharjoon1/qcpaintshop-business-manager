#!/usr/bin/env node
/**
 * salesperson-painter-unify.js — Painter <-> Zoho-salesperson unification driver.
 *
 * Owner spec (2026-08-13): in Zoho, ALL salespersons were historically created
 * FROM painters — names carry PNTR/Painter tokens and often an embedded
 * 10-digit mobile ("CHANDRAN PNTR - 9585833985", "MR BALAJI PNTR PKD",
 * "9965475554"). Goals:
 *   (A) every painter must have a Zoho salesperson — REPORT ONLY here; creation
 *       stays with services/painter-zoho-sync-service.js (do not reimplement);
 *   (B) every Zoho salesperson must be linked to a painter (LINK);
 *   (C) salespersons that are NOT painters get painter records (CREATE) and
 *       their sales since 2025-12-01 backfilled via the EXISTING
 *       services/painter-points-backfill-service.js backfillPainter()
 *       (idempotent via painter_invoices_processed; same call convention as
 *       routes/painters/admin.js:2688).
 *
 * Matching rules (pure functions, locked by
 * tests/unit/salesperson-painter-match.test.js):
 *   1. Extract a 10-digit Indian mobile from the salesperson name (separators
 *      allowed, +91/0 prefixes stripped, must start 6-9) and match against
 *      painters.phone normalized the same way. Phone match wins.
 *   2. Else name tokens: strip PNTR/PAINTER(S) tokens, phone-sized digit runs,
 *      punctuation, pure-digit tokens and MR/MRS/MS; token-subset compare
 *      (smaller set fully inside the bigger, at least one shared token of
 *      length >= 3). Conservative: auto-match only when exactly ONE painter
 *      candidate.
 *   3. Classification:
 *        LINK      painter found, painters.zoho_salesperson_id IS NULL
 *        CONFLICT  painter found but carries a DIFFERENT salesperson id
 *                  (report only — NEVER overwritten), or multiple salespersons
 *                  resolve to the same painter
 *        CREATE    no painter → proposal for a new painters row
 *        AMBIGUOUS more than one candidate (report only)
 *
 * CREATE proposal rules (painters schema: full_name NOT NULL, phone NOT NULL
 * UNIQUE varchar(20); everything else defaulted — docs/schema/prod-schema-2026-06-11.sql):
 *   - full_name = cleaned display name (PNTR tokens + phone digits stripped,
 *     Title Case); bare-number names fall back to "Painter <mobile>".
 *   - phone = extracted mobile, else deterministic placeholder
 *     "ZSP-<last 16 of salesperson id>" (schema forbids NULL; placeholder
 *     contains letters so it can never phone-match, and is flagged loudly).
 *   - status='approved', created_via='zoho_import' (existing enum value),
 *     notes = provenance marker, zoho_salesperson_id set,
 *     approved_at/activated_at = NOW(). activated_at is stamped deliberately:
 *     backfillPainter() skips non-activated painters (see the comment at
 *     routes/painters/admin.js:2681) and the entire point of CREATE is the
 *     historical backfill.
 *
 * Usage (ON PROD only, after owner approval of the preflight):
 *   node scripts/salesperson-painter-unify.js          # PREFLIGHT (default, read-only)
 *   node scripts/salesperson-painter-unify.js --demo   # fabricated sample data, no DB
 *   APPLY=1 node scripts/salesperson-painter-unify.js  # execute: links -> creates -> backfills
 *
 * Idempotent re-runs: LINK update only fills NULL (guarded WHERE); CREATE
 * skips when a painter already holds that salesperson id; backfill is already
 * idempotent via painter_invoices_processed.
 */
'use strict';

const FROM_DATE = '2025-12-01'; // owner-fixed backfill start (routes/painters/admin.js:2688)

// ─── Pure matching helpers (exported, unit-tested, no DB) ───────────────────

const PNTR_TOKEN_RE = /\b(?:PNTR|PAINTERS?)\b/gi;
const DIGIT_RUN_RE = /\d(?:[\d\s\-.]*\d)?/g; // digit runs, separators allowed
const MATCH_STOP_TOKENS = new Set(['MR', 'MRS', 'MS']);

/**
 * Normalize a stored phone value to a canonical 10-digit Indian mobile.
 * Returns null when it cannot be a real mobile: contains letters (guards the
 * ZSP- placeholders this script itself creates), wrong length after stripping
 * +91/0 prefixes, or does not start 6-9.
 */
function normalizePhone(raw) {
    if (raw == null) return null;
    const s = String(raw);
    if (/[A-Za-z]/.test(s)) return null;
    let digits = s.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length !== 10) return null;
    return /^[6-9]/.test(digits) ? digits : null;
}

/**
 * Extract the first valid 10-digit Indian mobile embedded in a salesperson
 * name. Digit runs may be split by spaces/hyphens/dots ("+91 98470-12345").
 */
function extractMobile(name) {
    if (!name) return null;
    const runs = String(name).match(DIGIT_RUN_RE) || [];
    for (const run of runs) {
        const mobile = normalizePhone(run);
        if (mobile) return mobile;
    }
    return null;
}

/** Remove phone-sized digit runs (>= 10 squashed digits) from a name. */
function stripPhoneRuns(name) {
    return String(name || '').replace(DIGIT_RUN_RE, run =>
        run.replace(/\D/g, '').length >= 10 ? ' ' : run);
}

function titleCase(s) {
    return String(s).toLowerCase().replace(/(^|\s)([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

/**
 * Display-name cleaning rule (documented): strip phone runs, strip
 * PNTR/PAINTER(S) tokens (any case), punctuation → space, collapse
 * whitespace, Title Case. "MR BALAJI PNTR PKD" → "Mr Balaji Pkd".
 */
function cleanDisplayName(name) {
    const stripped = stripPhoneRuns(name)
        .replace(PNTR_TOKEN_RE, ' ')
        .replace(/[^A-Za-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return titleCase(stripped);
}

/**
 * Tokens used for fuzzy-lite matching: uppercased, PNTR tokens + phone runs +
 * punctuation removed, pure-digit tokens and MR/MRS/MS honorifics dropped.
 */
function nameTokens(name) {
    return stripPhoneRuns(name)
        .replace(PNTR_TOKEN_RE, ' ')
        .replace(/[^A-Za-z0-9\s]/g, ' ')
        .toUpperCase()
        .split(/\s+/)
        .filter(t => t && !/^\d+$/.test(t) && !MATCH_STOP_TOKENS.has(t));
}

/**
 * Token-subset match: the smaller token set must be fully contained in the
 * bigger one, both non-empty, and at least one shared token must be length
 * >= 3 (initials alone never auto-match).
 */
function tokenSubsetMatch(tokensA, tokensB) {
    const a = new Set(tokensA), b = new Set(tokensB);
    if (!a.size || !b.size) return false;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    let hasStrongToken = false;
    for (const t of small) {
        if (!big.has(t)) return false;
        if (t.length >= 3) hasStrongToken = true;
    }
    return hasStrongToken;
}

/** Build the proposed new painters row for a salesperson with no painter. */
function buildCreateProposal(sp) {
    const spId = String(sp.zoho_salesperson_id);
    const rawName = String(sp.salesperson_name || '');
    const mobile = extractMobile(rawName);
    const cleaned = cleanDisplayName(rawName);
    const fullName = cleaned || (mobile ? `Painter ${mobile}` : rawName.trim());
    return {
        zoho_salesperson_id: spId,
        full_name: fullName,
        phone: mobile || `ZSP-${spId.slice(-16)}`,
        phone_is_placeholder: !mobile,
        status: 'approved',
        created_via: 'zoho_import',
        notes: `Auto-created by scripts/salesperson-painter-unify.js from Zoho salesperson ${spId} ("${rawName}")`
    };
}

/**
 * Pure classifier. Inputs are plain arrays:
 *   salespersons: [{ zoho_salesperson_id, salesperson_name, is_active }]
 *   painters:     [{ id, full_name, phone, status, zoho_salesperson_id,
 *                    zoho_customer_id, activated_at }]
 * Output: { alreadyLinked, links, conflicts, ambiguous, creates }
 */
function matchSalespersons(salespersons, painters) {
    const linkedBySpId = new Map();
    for (const p of painters) {
        if (p.zoho_salesperson_id) linkedBySpId.set(String(p.zoho_salesperson_id), p);
    }

    const phoneIndex = new Map();
    for (const p of painters) {
        const norm = normalizePhone(p.phone);
        if (!norm) continue;
        if (!phoneIndex.has(norm)) phoneIndex.set(norm, []);
        phoneIndex.get(norm).push(p);
    }

    const painterTokens = painters.map(p => ({ p, tokens: nameTokens(p.full_name) }));

    const out = { alreadyLinked: [], links: [], conflicts: [], ambiguous: [], creates: [] };

    for (const sp of salespersons) {
        const spId = String(sp.zoho_salesperson_id);

        if (linkedBySpId.has(spId)) {
            out.alreadyLinked.push({ sp, painter: linkedBySpId.get(spId) });
            continue;
        }

        let candidate = null;
        let via = null;

        // 1. Phone match (wins when unique; ambiguity stops here — no fallback).
        const mobile = extractMobile(sp.salesperson_name);
        if (mobile && phoneIndex.has(mobile)) {
            const cands = phoneIndex.get(mobile);
            if (cands.length > 1) {
                out.ambiguous.push({ sp, via: 'phone', candidates: cands });
                continue;
            }
            candidate = cands[0];
            via = 'phone';
        }

        // 2. Name-token match (only when phone matched nothing).
        if (!candidate) {
            const spTokens = nameTokens(sp.salesperson_name);
            const cands = spTokens.length
                ? painterTokens.filter(x => tokenSubsetMatch(spTokens, x.tokens)).map(x => x.p)
                : [];
            if (cands.length > 1) {
                out.ambiguous.push({ sp, via: 'name', candidates: cands });
                continue;
            }
            if (cands.length === 1) {
                candidate = cands[0];
                via = 'name';
            }
        }

        // 3. Classify.
        if (!candidate) {
            const spTokens = nameTokens(sp.salesperson_name);
            const hints = spTokens.length
                ? painterTokens
                    .filter(x => x.tokens.some(t => t.length >= 4 && spTokens.includes(t)))
                    .map(x => x.p)
                : [];
            out.creates.push({ sp, proposal: buildCreateProposal(sp), hints });
            continue;
        }

        const existing = candidate.zoho_salesperson_id ? String(candidate.zoho_salesperson_id) : null;
        if (existing === null) {
            out.links.push({ sp, painter: candidate, via });
        } else if (existing === spId) {
            out.alreadyLinked.push({ sp, painter: candidate });
        } else {
            out.conflicts.push({
                sp, painter: candidate, via,
                reason: `painter #${candidate.id} already linked to a DIFFERENT salesperson (${existing})`
            });
        }
    }

    // Post-pass: two+ unlinked salespersons resolving to the SAME painter is a
    // manual decision — demote all of them to CONFLICT, link none.
    const linksByPainter = new Map();
    for (const l of out.links) {
        if (!linksByPainter.has(l.painter.id)) linksByPainter.set(l.painter.id, []);
        linksByPainter.get(l.painter.id).push(l);
    }
    for (const [painterId, group] of linksByPainter) {
        if (group.length < 2) continue;
        out.links = out.links.filter(l => l.painter.id !== painterId);
        for (const l of group) {
            out.conflicts.push({
                sp: l.sp, painter: l.painter, via: l.via,
                reason: `multiple salespersons match painter #${painterId} — manual pick required`
            });
        }
    }

    return out;
}

// ─── SQL (every APPLY write; parameterized; locked by the unit test) ────────

const SQL = {
    // Read-only inventory / preflight
    INVENTORY_SALESPERSONS: `SELECT zoho_salesperson_id, salesperson_name, salesperson_email, is_active
         FROM zoho_salespersons ORDER BY salesperson_name`,
    INVENTORY_PAINTERS: `SELECT id, full_name, phone, status, zoho_salesperson_id, zoho_customer_id, activated_at
         FROM painters ORDER BY id`,
    // Backfill scale (mirrors painter-points-backfill-service filters incl. the
    // painter_invoices_processed exclusion, so re-run preflights show what REMAINS)
    SCALE_SP_LINKED: `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t
         FROM zoho_invoices zi
        WHERE zi.zoho_salesperson_id = ? AND zi.invoice_date >= ?
          AND zi.status NOT IN ('void','draft')
          AND NOT EXISTS (
              SELECT 1 FROM painter_invoices_processed pip
              WHERE pip.painter_id = ? AND pip.zoho_invoice_id = zi.zoho_invoice_id
                AND pip.attribution_type = 'salesperson'
          )`,
    SCALE_SP_NEW: `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t
         FROM zoho_invoices
        WHERE zoho_salesperson_id = ? AND invoice_date >= ?
          AND status NOT IN ('void','draft')`,
    SCALE_DIRECT_LINKED: `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t
         FROM zoho_invoices zi
        WHERE zi.zoho_customer_id = ? AND zi.invoice_date >= ?
          AND zi.status NOT IN ('void','draft')
          AND NOT EXISTS (
              SELECT 1 FROM painter_invoices_processed pip
              WHERE pip.painter_id = ? AND pip.zoho_invoice_id = zi.zoho_invoice_id
                AND pip.attribution_type = 'direct_billing'
          )`,
    FIND_ADMIN: `SELECT id FROM users
        WHERE role IN ('admin', 'administrator', 'super_admin') AND status = 'active'
        ORDER BY id LIMIT 1`,
    READ_PAINTER_SP: `SELECT zoho_salesperson_id FROM painters WHERE id = ? LIMIT 1`,
    CREATE_GUARD: `SELECT id FROM painters WHERE zoho_salesperson_id = ? LIMIT 1`,
    // Writes (APPLY only)
    LINK_PAINTER: `UPDATE painters SET zoho_salesperson_id = ? WHERE id = ? AND zoho_salesperson_id IS NULL`,
    UPSERT_SP_MAP: `INSERT INTO painter_zoho_salesperson_map
            (zoho_salesperson_id, zoho_salesperson_name, zoho_salesperson_phone, painter_id, match_confidence)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE painter_id = VALUES(painter_id), match_confidence = VALUES(match_confidence)`,
    CREATE_PAINTER: `INSERT INTO painters
            (full_name, phone, status, created_via, notes, zoho_salesperson_id, approved_by, approved_at, activated_at)
        VALUES (?, ?, 'approved', 'zoho_import', ?, ?, ?, NOW(), NOW())`
};

// ─── Demo fixture (fabricated — shows the owner the report format, no DB) ───

function buildDemoData() {
    const salespersons = [
        { zoho_salesperson_id: 'SP-001', salesperson_name: 'CHANDRAN PNTR - 9585833985', salesperson_email: null, is_active: 1 },
        { zoho_salesperson_id: 'SP-002', salesperson_name: 'MR BALAJI PNTR PKD', salesperson_email: null, is_active: 1 },
        { zoho_salesperson_id: 'SP-003', salesperson_name: '9965475554', salesperson_email: null, is_active: 1 },
        { zoho_salesperson_id: 'SP-004', salesperson_name: 'KUMAR PNTR - 9847012345', salesperson_email: null, is_active: 1 },
        { zoho_salesperson_id: 'SP-005', salesperson_name: 'RAJU PAINTER', salesperson_email: null, is_active: 1 },
        { zoho_salesperson_id: 'SP-006', salesperson_name: 'OFFICE COUNTER SALES', salesperson_email: null, is_active: 0 },
        { zoho_salesperson_id: 'SP-007', salesperson_name: 'SELVAM PNTR TRICHY', salesperson_email: null, is_active: 1 }
    ];
    const painters = [
        { id: 12, full_name: 'Chandran', phone: '+91 95858 33985', status: 'approved', zoho_salesperson_id: null, zoho_customer_id: 'ZC-12', activated_at: '2026-01-05 00:00:00' },
        { id: 15, full_name: 'Balaji', phone: '9000000015', status: 'approved', zoho_salesperson_id: null, zoho_customer_id: null, activated_at: null },
        { id: 18, full_name: 'Kumar', phone: '9847012345', status: 'approved', zoho_salesperson_id: 'SP-OLD-9', zoho_customer_id: null, activated_at: '2026-02-01 00:00:00' },
        { id: 21, full_name: 'Raju', phone: '9111111111', status: 'approved', zoho_salesperson_id: null, zoho_customer_id: null, activated_at: '2026-03-01 00:00:00' },
        { id: 22, full_name: 'Raju', phone: '9222222222', status: 'approved', zoho_salesperson_id: null, zoho_customer_id: null, activated_at: null },
        { id: 30, full_name: 'Selvam', phone: '9333333333', status: 'approved', zoho_salesperson_id: 'SP-007', zoho_customer_id: 'ZC-30', activated_at: '2026-01-20 00:00:00' },
        { id: 31, full_name: 'Murugan', phone: '9444444444', status: 'approved', zoho_salesperson_id: null, zoho_customer_id: null, activated_at: '2026-04-01 00:00:00' }
    ];
    const match = matchSalespersons(salespersons, painters);
    const scale = new Map([
        ['SP-001', { spInvoices: 14, spTotal: 185000, directInvoices: 3, directTotal: 22000 }],
        ['SP-002', { spInvoices: 6, spTotal: 42000, directInvoices: 0, directTotal: 0 }],
        ['SP-003', { spInvoices: 9, spTotal: 96500, directInvoices: 0, directTotal: 0 }],
        ['SP-006', { spInvoices: 2, spTotal: 5400, directInvoices: 0, directTotal: 0 }]
    ]);
    const rates = { selfAnnual: 0.005, custRegular: 0.005, custAnnual: 0.005 };
    return {
        demo: true,
        salespersons,
        painters,
        match,
        scale,
        rates,
        caseA: deriveCaseA(painters, match)
    };
}

function deriveCaseA(painters, match) {
    const willLink = new Set(match.links.map(l => l.painter.id));
    return painters
        .filter(p => p.status === 'approved' && !p.zoho_salesperson_id)
        .map(p => ({ ...p, will_link: willLink.has(p.id) }));
}

// ─── Preflight report rendering (console out; shared by --demo and live) ────

const inr = n => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const pad = (s, w) => {
    s = String(s === null || s === undefined ? '' : s);
    return s.length >= w ? s : s + ' '.repeat(w - s.length);
};

function estimatePoints(row, rates) {
    return Math.round(row.spTotal * (rates.custRegular + rates.custAnnual))
        + Math.round(row.directTotal * rates.selfAnnual);
}

function renderPreflight(data) {
    const { salespersons, painters, match, scale, rates, caseA } = data;
    const line = '='.repeat(78);
    console.log(line);
    console.log(' SALESPERSON <-> PAINTER UNIFICATION — PREFLIGHT REPORT');
    console.log(` mode: ${data.demo ? 'DEMO (fabricated sample data, no DB)' : 'PREFLIGHT (read-only)'} | backfill from: ${FROM_DATE}`);
    console.log(line);

    // ── Phase 1: inventory ──
    const linkedBySpId = new Map();
    for (const p of painters) {
        if (p.zoho_salesperson_id) linkedBySpId.set(String(p.zoho_salesperson_id), p);
    }
    const activeCount = salespersons.filter(s => Number(s.is_active) === 1).length;
    console.log(`\n--- PHASE 1: INVENTORY ---`);
    console.log(`zoho_salespersons: ${salespersons.length} rows (${activeCount} active / ${salespersons.length - activeCount} inactive)`);
    for (const s of salespersons) {
        const p = linkedBySpId.get(String(s.zoho_salesperson_id));
        console.log(`  ${pad(s.zoho_salesperson_id, 20)} ${pad(s.salesperson_name, 40)} ${Number(s.is_active) === 1 ? 'active  ' : 'INACTIVE'} ${p ? `linked -> painter #${p.id} ${p.full_name}` : 'UNLINKED'}`);
    }
    const byStatus = {};
    for (const p of painters) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    const withSp = painters.filter(p => p.zoho_salesperson_id).length;
    console.log(`painters: ${painters.length} rows (${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}) | with salesperson ${withSp} | without ${painters.length - withSp}`);
    for (const p of painters) {
        console.log(`  #${pad(p.id, 5)} ${pad(p.full_name, 28)} ${pad(p.phone, 16)} ${pad(p.status, 10)} sp=${p.zoho_salesperson_id || '-'}`);
    }

    // ── Phase 2: match classification ──
    console.log(`\n--- PHASE 2: MATCH CLASSIFICATION ---`);
    console.log(`already linked: ${match.alreadyLinked.length} (untouched)`);
    console.log(`LINK proposals: ${match.links.length} (APPLY sets painters.zoho_salesperson_id — only where currently NULL)`);
    for (const l of match.links) {
        const warn = l.painter.activated_at ? '' : '  [WARN: painter not activated — backfill will report skipped:not_activated]';
        console.log(`  ${pad(l.sp.zoho_salesperson_id, 20)} "${l.sp.salesperson_name}" -> painter #${l.painter.id} ${l.painter.full_name} [via ${l.via}] [status ${l.painter.status}]${warn}`);
    }
    console.log(`CONFLICT: ${match.conflicts.length} — REPORT ONLY, never overwritten`);
    for (const c of match.conflicts) {
        console.log(`  ${pad(c.sp.zoho_salesperson_id, 20)} "${c.sp.salesperson_name}" -> painter #${c.painter.id} ${c.painter.full_name}: ${c.reason}`);
    }
    console.log(`AMBIGUOUS: ${match.ambiguous.length} — REPORT ONLY (single-candidate rule)`);
    for (const a of match.ambiguous) {
        console.log(`  ${pad(a.sp.zoho_salesperson_id, 20)} "${a.sp.salesperson_name}" [via ${a.via}] candidates: ${a.candidates.map(c => `#${c.id} ${c.full_name}`).join(' | ')}`);
    }

    // ── Phase 3: create proposals ──
    console.log(`\n--- PHASE 3: CREATE PROPOSALS (${match.creates.length} new painters rows) ---`);
    for (const c of match.creates) {
        const p = c.proposal;
        console.log(`  salesperson ${p.zoho_salesperson_id} "${c.sp.salesperson_name}"`);
        console.log(`    full_name="${p.full_name}" phone=${p.phone}${p.phone_is_placeholder ? ' [PLACEHOLDER — no real phone; painter cannot OTP-login until fixed]' : ''}`);
        console.log(`    status=${p.status} created_via=${p.created_via} approved_at=NOW() activated_at=NOW() zoho_salesperson_id=${p.zoho_salesperson_id}`);
        console.log(`    notes="${p.notes}"`);
        if (c.hints && c.hints.length) {
            console.log(`    NOTE possible relatives (token overlap, review before APPLY): ${c.hints.map(h => `#${h.id} ${h.full_name}`).join(' | ')}`);
        }
    }
    if (match.creates.length) {
        console.log(`  (activated_at=NOW() is deliberate: backfillPainter skips non-activated painters —`);
        console.log(`   routes/painters/admin.js:2681 — and CREATE exists precisely to backfill history.)`);
    }

    // ── Phase 4: case A — painters missing a salesperson ──
    console.log(`\n--- PHASE 4: PAINTERS MISSING SALESPERSON (case A — report only) ---`);
    console.log(`approved painters with zoho_salesperson_id NULL: ${caseA.length}`);
    for (const p of caseA) {
        console.log(`  #${pad(p.id, 5)} ${pad(p.full_name, 28)} ${p.will_link ? '(will be LINKed by this run)' : ''}`);
    }
    const ambiguousPainterIds = new Set(match.ambiguous.flatMap(a => a.candidates.map(c => c.id)));
    const staleAfterRun = caseA.filter(p => !p.will_link);
    if (staleAfterRun.length) {
        console.log(`  -> creation stays with services/painter-zoho-sync-service.js: run its queue`);
        console.log(`     (syncPainterToZoho / retryQueue) for the ${staleAfterRun.length} remaining after links apply.`);
        const risky = staleAfterRun.filter(p => ambiguousPainterIds.has(p.id));
        if (risky.length) {
            console.log(`     CAUTION: ${risky.map(p => `#${p.id} ${p.full_name}`).join(', ')} appear in AMBIGUOUS`);
            console.log(`     candidates above — resolve those manually BEFORE syncing or Zoho gets duplicates.`);
        }
    }

    // ── Phase 5: backfill plan ──
    console.log(`\n--- PHASE 5: BACKFILL PLAN (invoices since ${FROM_DATE}; scale BEFORE apply) ---`);
    console.log(`rates (ai_config): selfAnnual=${rates.selfAnnual} custRegular=${rates.custRegular} custAnnual=${rates.custAnnual}`);
    console.log(`  ${pad('salesperson', 20)} ${pad('painter', 26)} ${pad('sp inv', 7)} ${pad('sp total', 14)} ${pad('direct inv', 10)} ${pad('direct total', 14)} est points`);
    let totInv = 0, totAmt = 0, totPts = 0;
    const planRows = [
        ...match.links.map(l => ({ spId: String(l.sp.zoho_salesperson_id), label: `#${l.painter.id} ${l.painter.full_name}`, skip: !l.painter.activated_at })),
        ...match.creates.map(c => ({ spId: c.proposal.zoho_salesperson_id, label: `NEW "${c.proposal.full_name}"`, skip: false }))
    ];
    for (const row of planRows) {
        const s = scale.get(row.spId) || { spInvoices: 0, spTotal: 0, directInvoices: 0, directTotal: 0 };
        const pts = estimatePoints(s, rates);
        totInv += s.spInvoices + s.directInvoices;
        totAmt += s.spTotal + s.directTotal;
        totPts += pts;
        console.log(`  ${pad(row.spId, 20)} ${pad(row.label, 26)} ${pad(s.spInvoices, 7)} ${pad(inr(s.spTotal), 14)} ${pad(s.directInvoices, 10)} ${pad(inr(s.directTotal), 14)} ~${pts}${row.skip ? '  [WILL SKIP: not activated]' : ''}`);
    }
    console.log(`  TOTAL: ${totInv} invoices, ${inr(totAmt)}, ~${totPts} points`);
    console.log(`  (Estimates use sum*rate; the service rounds per invoice — small drift expected.`);
    console.log(`   Counts already exclude invoices in painter_invoices_processed for LINKed painters;`);
    console.log(`   backfill itself is idempotent. Salesperson attribution awards regular + annual per`);
    console.log(`   the existing service — untouched. Already-linked painters are NOT backfilled here.)`);

    // ── Phase 6: APPLY SQL preview ──
    console.log(`\n--- PHASE 6: EVERY WRITE THE APPLY PATH RUNS (parameterized) ---`);
    console.log(`[per LINK]   ${SQL.LINK_PAINTER}`);
    console.log(`             params: [zoho_salesperson_id, painter_id]`);
    console.log(`[per LINK]   ${SQL.UPSERT_SP_MAP.replace(/\s+/g, ' ').trim()}`);
    console.log(`             params: [sp_id, sp_name, extracted_mobile_or_null, painter_id, 'exact_phone'|'fuzzy_name']`);
    console.log(`[per CREATE] ${SQL.CREATE_PAINTER.replace(/\s+/g, ' ').trim()}`);
    console.log(`             params: [full_name, phone, notes, zoho_salesperson_id, approved_by_admin_id]`);
    console.log(`[per CREATE] same map upsert with match_confidence='exact_name'`);
    console.log(`[per LINK+CREATE painter] backfillPainter(painterId, '${FROM_DATE}', { pool })`);
    console.log(`             — existing services/painter-points-backfill-service.js, untouched;`);
    console.log(`               its own INSERTs go through painter-points-engine + painter_invoices_processed.`);

    // ── Phase 7: apply order ──
    console.log(`\n--- PHASE 7: APPLY ORDER (each step idempotent, re-run safe) ---`);
    console.log(`  1. links    — guarded UPDATE fills only NULL; re-run with same id -> classified already-linked`);
    console.log(`  2. creates  — skipped when any painter already holds that zoho_salesperson_id`);
    console.log(`  3. backfills — sequential, idempotent via painter_invoices_processed`);
    console.log(`  CONFLICT and AMBIGUOUS rows are never written — resolve manually, re-run.`);
}

// ─── Live data gathering (read-only) ─────────────────────────────────────────

async function gather(pool) {
    const backfillService = require('../services/painter-points-backfill-service');
    const [salespersons] = await pool.query(SQL.INVENTORY_SALESPERSONS);
    const [painters] = await pool.query(SQL.INVENTORY_PAINTERS);
    const match = matchSalespersons(salespersons, painters);
    const rates = await backfillService._loadRates(pool);

    const scale = new Map();
    for (const l of match.links) {
        const spId = String(l.sp.zoho_salesperson_id);
        const [[spRow]] = await pool.query(SQL.SCALE_SP_LINKED, [spId, FROM_DATE, l.painter.id]);
        const row = { spInvoices: spRow.c, spTotal: Number(spRow.t), directInvoices: 0, directTotal: 0 };
        if (l.painter.zoho_customer_id) {
            const [[dRow]] = await pool.query(SQL.SCALE_DIRECT_LINKED, [l.painter.zoho_customer_id, FROM_DATE, l.painter.id]);
            row.directInvoices = dRow.c;
            row.directTotal = Number(dRow.t);
        }
        scale.set(spId, row);
    }
    for (const c of match.creates) {
        const spId = c.proposal.zoho_salesperson_id;
        const [[spRow]] = await pool.query(SQL.SCALE_SP_NEW, [spId, FROM_DATE]);
        scale.set(spId, { spInvoices: spRow.c, spTotal: Number(spRow.t), directInvoices: 0, directTotal: 0 });
    }

    return { demo: false, salespersons, painters, match, scale, rates, caseA: deriveCaseA(painters, match) };
}

// ─── APPLY (links -> creates -> backfills; every write printed) ─────────────

async function applyChanges(pool, data) {
    const backfillService = require('../services/painter-points-backfill-service');
    // backfillPainter -> pointsEngine.addPoints uses the engine's module pool;
    // in-server that is set at startup — a standalone script must set it itself.
    require('../services/painter-points-engine').setPool(pool);

    console.log(`\n${'='.repeat(78)}`);
    console.log(' APPLY MODE — writing (links -> creates -> backfills)');
    console.log('='.repeat(78));

    const [adminRows] = await pool.query(SQL.FIND_ADMIN);
    const approvedBy = adminRows.length ? adminRows[0].id : null;
    console.log(`approved_by for created painters: ${approvedBy === null ? 'NULL (no active admin found)' : `user #${approvedBy}`}`);

    const summary = {
        links_applied: 0, links_rerun_skipped: 0, links_apply_conflicts: 0,
        creates_applied: 0, creates_rerun_skipped: 0, creates_failed: 0,
        backfills_run: 0, backfills_skipped: 0, backfill_invoices: 0, backfill_points: 0
    };
    const backfillTargets = [];

    // 1. Links
    for (const l of data.match.links) {
        const spId = String(l.sp.zoho_salesperson_id);
        const confidence = l.via === 'phone' ? 'exact_phone' : 'fuzzy_name';
        const [res] = await pool.query(SQL.LINK_PAINTER, [spId, l.painter.id]);
        if (res.affectedRows === 1) {
            summary.links_applied++;
            console.log(`LINK    painter #${l.painter.id} (${l.painter.full_name}) <- salesperson ${spId} [via ${l.via}]`);
        } else {
            const [cur] = await pool.query(SQL.READ_PAINTER_SP, [l.painter.id]);
            const current = cur.length && cur[0].zoho_salesperson_id ? String(cur[0].zoho_salesperson_id) : null;
            if (current === spId) {
                summary.links_rerun_skipped++;
                console.log(`SKIP    painter #${l.painter.id}: already linked to ${spId} (re-run safe)`);
            } else {
                summary.links_apply_conflicts++;
                console.log(`CONFLICT painter #${l.painter.id}: now carries ${current} (changed since preflight) — NOT overwritten`);
                continue;
            }
        }
        await pool.query(SQL.UPSERT_SP_MAP,
            [spId, l.sp.salesperson_name, extractMobile(l.sp.salesperson_name), l.painter.id, confidence]);
        console.log(`  MAP   painter_zoho_salesperson_map upsert: ${spId} -> painter #${l.painter.id} (${confidence})`);
        backfillTargets.push({ painterId: l.painter.id, label: `${l.painter.full_name} (linked)` });
    }

    // 2. Creates
    for (const c of data.match.creates) {
        const p = c.proposal;
        const [guard] = await pool.query(SQL.CREATE_GUARD, [p.zoho_salesperson_id]);
        if (guard.length) {
            summary.creates_rerun_skipped++;
            console.log(`SKIP    create for salesperson ${p.zoho_salesperson_id}: painter #${guard[0].id} already holds it (re-run safe)`);
            backfillTargets.push({ painterId: guard[0].id, label: `${p.full_name} (pre-existing)` });
            continue;
        }
        try {
            const [ins] = await pool.query(SQL.CREATE_PAINTER,
                [p.full_name, p.phone, p.notes, p.zoho_salesperson_id, approvedBy]);
            summary.creates_applied++;
            console.log(`CREATE  painter #${ins.insertId} "${p.full_name}" phone=${p.phone}${p.phone_is_placeholder ? ' [PLACEHOLDER]' : ''} sp=${p.zoho_salesperson_id}`);
            await pool.query(SQL.UPSERT_SP_MAP,
                [p.zoho_salesperson_id, c.sp.salesperson_name, extractMobile(c.sp.salesperson_name), ins.insertId, 'exact_name']);
            console.log(`  MAP   painter_zoho_salesperson_map upsert: ${p.zoho_salesperson_id} -> painter #${ins.insertId} (exact_name)`);
            backfillTargets.push({ painterId: ins.insertId, label: `${p.full_name} (created)` });
        } catch (err) {
            if (err && err.code === 'ER_DUP_ENTRY') {
                summary.creates_failed++;
                console.log(`FAILED  create for salesperson ${p.zoho_salesperson_id}: duplicate (${err.message.slice(0, 120)}) — resolve manually`);
                continue;
            }
            throw err;
        }
    }

    // 3. Backfills (sequential; the service is idempotent)
    console.log(`\nBackfilling ${backfillTargets.length} painters from ${FROM_DATE} ...`);
    for (const t of backfillTargets) {
        const r = await backfillService.backfillPainter(t.painterId, FROM_DATE, { pool });
        if (r.skipped) {
            summary.backfills_skipped++;
            console.log(`BACKFILL painter #${t.painterId} (${t.label}): SKIPPED (${r.skipped})`);
        } else {
            summary.backfills_run++;
            summary.backfill_invoices += r.invoices_processed;
            summary.backfill_points += r.direct_points_awarded + r.salesperson_points_awarded;
            console.log(`BACKFILL painter #${t.painterId} (${t.label}): processed=${r.invoices_processed} direct_points=${r.direct_points_awarded} salesperson_points=${r.salesperson_points_awarded}`);
        }
    }

    // Summary table
    console.log(`\n${'='.repeat(78)}`);
    console.log(' APPLY SUMMARY');
    console.log('='.repeat(78));
    console.log(`  links     applied ${summary.links_applied} | re-run skipped ${summary.links_rerun_skipped} | apply-time conflicts ${summary.links_apply_conflicts}`);
    console.log(`  creates   applied ${summary.creates_applied} | re-run skipped ${summary.creates_rerun_skipped} | failed(dup) ${summary.creates_failed}`);
    console.log(`  backfills run ${summary.backfills_run} | skipped ${summary.backfills_skipped} | invoices ${summary.backfill_invoices} | points ${summary.backfill_points}`);
    console.log(`  conflicts/ambiguous from preflight remain unresolved (report-only by design).`);
    return summary;
}

// ─── Exports (pure surface for tests) ────────────────────────────────────────

module.exports = {
    FROM_DATE,
    normalizePhone,
    extractMobile,
    stripPhoneRuns,
    cleanDisplayName,
    titleCase,
    nameTokens,
    tokenSubsetMatch,
    buildCreateProposal,
    matchSalespersons,
    deriveCaseA,
    buildDemoData,
    renderPreflight,
    gather,
    applyChanges,
    SQL
};

// ─── Main ────────────────────────────────────────────────────────────────────

if (require.main === module) {
    (async () => {
        if (process.argv.slice(2).includes('--demo')) {
            renderPreflight(buildDemoData());
            console.log('\nDEMO ONLY — fabricated data, no DB touched.');
            return;
        }

        require('dotenv').config();
        const pool = require('../config/database').createPool();
        try {
            const data = await gather(pool);
            renderPreflight(data);
            if (process.env.APPLY === '1') {
                await applyChanges(pool, data);
            } else {
                console.log('\nPREFLIGHT ONLY — nothing written. Re-run with APPLY=1 to execute.');
            }
        } finally {
            await pool.end().catch(() => {});
        }
    })().catch(err => {
        console.error('salesperson-painter-unify failed:', err.message);
        process.exit(1);
    });
}
