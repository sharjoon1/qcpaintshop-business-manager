/**
 * Characterization tests for the salesperson ↔ painter unification matcher
 * (scripts/salesperson-painter-unify.js).
 *
 * Locks the PURE matching logic before the script ever runs against prod:
 *   - 10-digit Indian mobile extraction from Zoho salesperson names
 *   - phone normalization (last-10, +91/0 prefixes, placeholder guard)
 *   - PNTR/PAINTER token cleaning + Title Case display-name rule
 *   - conservative classification: LINK / CONFLICT / CREATE / AMBIGUOUS,
 *     single-candidate rule, never-overwrite rule
 *   - CREATE proposal shape (NOT NULL columns of `painters` satisfied)
 *   - APPLY SQL safety properties (guarded UPDATE, no destructive SQL)
 *
 * NO DB, NO network — pure functions only.
 */

const {
    FROM_DATE,
    normalizePhone,
    extractMobile,
    cleanDisplayName,
    nameTokens,
    tokenSubsetMatch,
    matchSalespersons,
    buildCreateProposal,
    buildDemoData,
    SQL
} = require('../../scripts/salesperson-painter-unify');

// ---------------------------------------------------------------------------
// Mobile extraction from salesperson names
// ---------------------------------------------------------------------------
describe('extractMobile', () => {
    test('name with trailing mobile after dash (owner example)', () => {
        expect(extractMobile('CHANDRAN PNTR - 9585833985')).toBe('9585833985');
    });

    test('bare 10-digit number as the whole name (owner example)', () => {
        expect(extractMobile('9965475554')).toBe('9965475554');
    });

    test('+91 prefix with space and hyphen separators', () => {
        expect(extractMobile('+91 98470-12345')).toBe('9847012345');
    });

    test('leading-0 11-digit format', () => {
        expect(extractMobile('KUMAR 09847012345')).toBe('9847012345');
    });

    test('spaced-out digit groups joined into one run', () => {
        expect(extractMobile('RAJU 99654 75554')).toBe('9965475554');
    });

    test('name with no phone (owner example)', () => {
        expect(extractMobile('MR BALAJI PNTR PKD')).toBeNull();
    });

    test('short numbers are not mobiles', () => {
        expect(extractMobile('SHOP 1234 KUMAR')).toBeNull();
    });

    test('10 digits not starting 6-9 rejected', () => {
        expect(extractMobile('5234567890')).toBeNull();
    });

    test('null / empty safe', () => {
        expect(extractMobile(null)).toBeNull();
        expect(extractMobile('')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Phone normalization (painters.phone side)
// ---------------------------------------------------------------------------
describe('normalizePhone', () => {
    test('"+91 98765 43210" → 9876543210', () => {
        expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    });

    test('"09876543210" → 9876543210', () => {
        expect(normalizePhone('09876543210')).toBe('9876543210');
    });

    test('plain 10-digit passes through', () => {
        expect(normalizePhone('9876543210')).toBe('9876543210');
    });

    test('placeholder phones with letters (ZSP-…) never match', () => {
        expect(normalizePhone('ZSP-1234567890123456')).toBeNull();
    });

    test('too short / invalid start / null → null', () => {
        expect(normalizePhone('12345')).toBeNull();
        expect(normalizePhone('5234567890')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Display-name cleaning (documented rule: strip phone runs, strip
// PNTR/PAINTER(S) tokens, punctuation → space, collapse, Title Case)
// ---------------------------------------------------------------------------
describe('cleanDisplayName', () => {
    test('"MR BALAJI PNTR PKD" → "Mr Balaji Pkd" (owner example)', () => {
        expect(cleanDisplayName('MR BALAJI PNTR PKD')).toBe('Mr Balaji Pkd');
    });

    test('"CHANDRAN PNTR - 9585833985" → "Chandran"', () => {
        expect(cleanDisplayName('CHANDRAN PNTR - 9585833985')).toBe('Chandran');
    });

    test('bare number name cleans to empty string', () => {
        expect(cleanDisplayName('9965475554')).toBe('');
    });

    test('PNTR/painter token variants stripped case-insensitively', () => {
        expect(cleanDisplayName('pntr SURESH painter')).toBe('Suresh');
        expect(cleanDisplayName('R.MANI PAINTERS')).toBe('R Mani');
    });
});

// ---------------------------------------------------------------------------
// Matching tokens
// ---------------------------------------------------------------------------
describe('nameTokens', () => {
    test('uppercased, PNTR + digits + honorific stop-tokens dropped', () => {
        expect(nameTokens('MR BALAJI PNTR PKD - 9585833985')).toEqual(['BALAJI', 'PKD']);
    });

    test('pure-digit tokens dropped even when short', () => {
        expect(nameTokens('KUMAR 12 PNTR')).toEqual(['KUMAR']);
    });

    test('empty for bare-number names', () => {
        expect(nameTokens('9965475554')).toEqual([]);
    });
});

describe('tokenSubsetMatch', () => {
    test('smaller set contained in bigger set matches (either direction)', () => {
        expect(tokenSubsetMatch(['BALAJI', 'PKD'], ['BALAJI'])).toBe(true);
        expect(tokenSubsetMatch(['BALAJI'], ['BALAJI', 'KUMAR'])).toBe(true);
    });

    test('non-subset does not match', () => {
        expect(tokenSubsetMatch(['BALAJI', 'PKD'], ['BALAJI', 'KUMAR'])).toBe(false);
    });

    test('requires at least one shared token of length >= 3 (initials never auto-match)', () => {
        expect(tokenSubsetMatch(['M', 'S'], ['M', 'S'])).toBe(false);
    });

    test('empty sets never match', () => {
        expect(tokenSubsetMatch([], ['BALAJI'])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Classification: LINK / CONFLICT / CREATE / AMBIGUOUS / already-linked
// ---------------------------------------------------------------------------
function painter(over) {
    return {
        id: 1, full_name: 'Test Painter', phone: '9000000000', status: 'approved',
        zoho_salesperson_id: null, zoho_customer_id: null, activated_at: null,
        ...over
    };
}
function sp(over) {
    return { zoho_salesperson_id: 'SP-X', salesperson_name: 'X', is_active: 1, ...over };
}

describe('matchSalespersons', () => {
    test('phone match → LINK via phone (normalized both sides)', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-1', salesperson_name: 'CHANDRAN PNTR - 9585833985' })],
            [painter({ id: 12, full_name: 'Chandran', phone: '+91 95858 33985' })]
        );
        expect(res.links).toHaveLength(1);
        expect(res.links[0]).toMatchObject({ via: 'phone' });
        expect(res.links[0].painter.id).toBe(12);
        expect(res.conflicts).toHaveLength(0);
        expect(res.creates).toHaveLength(0);
    });

    test('no phone → name token-subset match, single candidate → LINK via name', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-2', salesperson_name: 'MR BALAJI PNTR PKD' })],
            [
                painter({ id: 15, full_name: 'Balaji', phone: '9000000015' }),
                painter({ id: 16, full_name: 'Kumar', phone: '9000000016' })
            ]
        );
        expect(res.links).toHaveLength(1);
        expect(res.links[0]).toMatchObject({ via: 'name' });
        expect(res.links[0].painter.id).toBe(15);
    });

    test('phone extracted but matches no painter → falls through to name match', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-3', salesperson_name: 'CHANDRAN PNTR - 9585833985' })],
            [painter({ id: 12, full_name: 'Chandran', phone: '9111111111' })]
        );
        expect(res.links).toHaveLength(1);
        expect(res.links[0]).toMatchObject({ via: 'name' });
    });

    test('two painters with the same name → AMBIGUOUS, never auto-linked', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-4', salesperson_name: 'RAJU PAINTER' })],
            [
                painter({ id: 21, full_name: 'Raju', phone: '9111111111' }),
                painter({ id: 22, full_name: 'Raju', phone: '9222222222' })
            ]
        );
        expect(res.links).toHaveLength(0);
        expect(res.ambiguous).toHaveLength(1);
        expect(res.ambiguous[0].candidates.map(c => c.id).sort()).toEqual([21, 22]);
    });

    test('two painters sharing a normalized phone → AMBIGUOUS via phone', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-5', salesperson_name: 'ANYONE 9585833985' })],
            [
                painter({ id: 31, full_name: 'A One', phone: '9585833985' }),
                painter({ id: 32, full_name: 'B Two', phone: '+91 9585833985' })
            ]
        );
        expect(res.ambiguous).toHaveLength(1);
        expect(res.ambiguous[0].via).toBe('phone');
        expect(res.links).toHaveLength(0);
    });

    test('matched painter already carries a DIFFERENT salesperson id → CONFLICT, never overwritten', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-6', salesperson_name: 'KUMAR PNTR - 9847012345' })],
            [painter({ id: 18, full_name: 'Kumar', phone: '9847012345', zoho_salesperson_id: 'SP-OLD-9' })]
        );
        expect(res.links).toHaveLength(0);
        expect(res.conflicts).toHaveLength(1);
        expect(res.conflicts[0].painter.id).toBe(18);
        expect(res.conflicts[0].reason).toContain('SP-OLD-9');
    });

    test('salesperson id already on some painter → alreadyLinked, no proposals', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-7', salesperson_name: 'SELVAM PNTR' })],
            [painter({ id: 30, full_name: 'Selvam', phone: '9333333333', zoho_salesperson_id: 'SP-7' })]
        );
        expect(res.alreadyLinked).toHaveLength(1);
        expect(res.links).toHaveLength(0);
        expect(res.creates).toHaveLength(0);
    });

    test('no painter matches at all → CREATE with proposal', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-8', salesperson_name: '9965475554' })],
            [painter({ id: 1, full_name: 'Somebody Else', phone: '9000000001' })]
        );
        expect(res.creates).toHaveLength(1);
        expect(res.creates[0].proposal.zoho_salesperson_id).toBe('SP-8');
        expect(res.creates[0].proposal.phone).toBe('9965475554');
    });

    test('two unlinked salespersons resolving to the SAME painter → both CONFLICT, none linked', () => {
        const res = matchSalespersons(
            [
                sp({ zoho_salesperson_id: 'SP-9A', salesperson_name: 'CHANDRAN PNTR - 9585833985' }),
                sp({ zoho_salesperson_id: 'SP-9B', salesperson_name: 'CHANDRAN PAINTER' })
            ],
            [painter({ id: 12, full_name: 'Chandran', phone: '9585833985' })]
        );
        expect(res.links).toHaveLength(0);
        expect(res.conflicts).toHaveLength(2);
        expect(res.conflicts.every(c => c.painter.id === 12)).toBe(true);
    });

    test('initials-only names never auto-match (falls to CREATE)', () => {
        const res = matchSalespersons(
            [sp({ zoho_salesperson_id: 'SP-10', salesperson_name: 'M S PNTR' })],
            [painter({ id: 40, full_name: 'M S', phone: '9555555555' })]
        );
        expect(res.links).toHaveLength(0);
        expect(res.creates).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// CREATE proposal shape — must satisfy painters NOT NULL columns
// (full_name NOT NULL, phone NOT NULL UNIQUE; everything else defaulted)
// ---------------------------------------------------------------------------
describe('buildCreateProposal', () => {
    test('phone-bearing name: cleaned title-cased name + extracted phone', () => {
        const p = buildCreateProposal(sp({
            zoho_salesperson_id: 'SP-20', salesperson_name: 'MR BALAJI PNTR PKD - 9847012345'
        }));
        expect(p.full_name).toBe('Mr Balaji Pkd');
        expect(p.phone).toBe('9847012345');
        expect(p.phone_is_placeholder).toBe(false);
        expect(p.status).toBe('approved');
        expect(p.created_via).toBe('zoho_import');
        expect(p.zoho_salesperson_id).toBe('SP-20');
        expect(p.notes).toContain('SP-20');
        expect(p.notes).toContain('salesperson-painter-unify');
    });

    test('bare-number name: documented fallback full_name "Painter <mobile>"', () => {
        const p = buildCreateProposal(sp({ zoho_salesperson_id: 'SP-21', salesperson_name: '9965475554' }));
        expect(p.full_name).toBe('Painter 9965475554');
        expect(p.phone).toBe('9965475554');
    });

    test('no extractable mobile: deterministic ZSP- placeholder fits varchar(20)', () => {
        const p = buildCreateProposal(sp({
            zoho_salesperson_id: '1234567890123456789', salesperson_name: 'OFFICE COUNTER SALES'
        }));
        expect(p.phone).toBe('ZSP-4567890123456789'); // 'ZSP-' + last 16 of the id
        expect(p.phone.length).toBeLessThanOrEqual(20);
        expect(p.phone_is_placeholder).toBe(true);
        expect(p.full_name).toBe('Office Counter Sales');
        expect(normalizePhone(p.phone)).toBeNull(); // placeholder can never phone-match later
    });
});

// ---------------------------------------------------------------------------
// APPLY SQL safety properties (characterization of the write path — no DB)
// ---------------------------------------------------------------------------
describe('APPLY SQL', () => {
    test('backfill start date is the owner-fixed 2025-12-01 (routes/painters/admin.js:2688 convention)', () => {
        expect(FROM_DATE).toBe('2025-12-01');
    });

    test('LINK update is guarded — only fills NULL, never overwrites', () => {
        expect(SQL.LINK_PAINTER).toMatch(/AND\s+zoho_salesperson_id\s+IS\s+NULL/i);
        expect(SQL.LINK_PAINTER.trim()).toMatch(/^UPDATE painters SET zoho_salesperson_id = \?/);
    });

    test('CREATE insert stamps approved/zoho_import and activated_at (backfill precondition)', () => {
        expect(SQL.CREATE_PAINTER).toContain("'approved'");
        expect(SQL.CREATE_PAINTER).toContain("'zoho_import'");
        expect(SQL.CREATE_PAINTER).toMatch(/activated_at/);
        expect(SQL.CREATE_PAINTER).toMatch(/NOW\(\)/);
    });

    test('salesperson-map write is an idempotent upsert', () => {
        expect(SQL.UPSERT_SP_MAP).toMatch(/ON DUPLICATE KEY UPDATE/i);
    });

    test('no destructive SQL anywhere in the APPLY path', () => {
        for (const [key, stmt] of Object.entries(SQL)) {
            expect(`${key}: ${stmt}`).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);
        }
    });

    test('every statement is parameterized (no obvious string interpolation)', () => {
        for (const stmt of Object.values(SQL)) {
            expect(stmt).not.toContain('${');
        }
    });
});

// ---------------------------------------------------------------------------
// Demo fixture — locks the --demo preflight example the owner reviews
// ---------------------------------------------------------------------------
describe('buildDemoData', () => {
    test('demo classification is stable: 2 links, 1 conflict, 1 ambiguous, 2 creates, 1 already-linked', () => {
        const d = buildDemoData();
        expect(d.demo).toBe(true);
        expect(d.match.links).toHaveLength(2);
        expect(d.match.links.map(l => l.via).sort()).toEqual(['name', 'phone']);
        expect(d.match.conflicts).toHaveLength(1);
        expect(d.match.ambiguous).toHaveLength(1);
        expect(d.match.creates).toHaveLength(2);
        expect(d.match.alreadyLinked).toHaveLength(1);
        // Case A: approved painters still missing a salesperson id
        expect(d.caseA.length).toBeGreaterThan(0);
    });
});
