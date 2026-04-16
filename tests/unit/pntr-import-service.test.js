// tests/unit/pntr-import-service.test.js
const { normalizePhone, parseBranchPrefix } = require('../../services/pntr-import-service');

describe('normalizePhone', () => {
    test('keeps 10-digit clean phone', () => {
        expect(normalizePhone('9876543210')).toBe('9876543210');
    });
    test('strips country code 91', () => {
        expect(normalizePhone('919876543210')).toBe('9876543210');
        expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    });
    test('strips formatting', () => {
        expect(normalizePhone('(987) 654-3210')).toBe('9876543210');
    });
    test('rejects empty / too short', () => {
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
        expect(normalizePhone('123')).toBeNull();
    });
    test('rejects 12-digit not starting with 91', () => {
        expect(normalizePhone('441234567890')).toBeNull();
    });
});

describe('parseBranchPrefix', () => {
    const branches = [
        { id: 1, code: 'RMD' }, { id: 2, code: 'TCM' },
        { id: 3, code: 'PKD' }, { id: 4, code: 'RMM' }, { id: 5, code: 'PBN' }
    ];
    test('parses PNTR RMD <name>', () => {
        expect(parseBranchPrefix('PNTR RMD Karthik', branches)).toEqual({ id: 1, code: 'RMD' });
    });
    test('case-insensitive', () => {
        expect(parseBranchPrefix('pntr tcm Mani', branches)).toEqual({ id: 2, code: 'TCM' });
    });
    test('handles extra spaces', () => {
        expect(parseBranchPrefix('PNTR  PKD  Ravi', branches)).toEqual({ id: 3, code: 'PKD' });
    });
    test('returns null when code unknown', () => {
        expect(parseBranchPrefix('PNTR XYZ Someone', branches)).toBeNull();
    });
    test('returns null when no PNTR prefix', () => {
        expect(parseBranchPrefix('RMD Karthik', branches)).toBeNull();
    });
});

const { matchSalesperson, levenshtein, parseSalespersonPhoneSuffix } = require('../../services/pntr-import-service');

describe('parseSalespersonPhoneSuffix', () => {
    test('extracts 10-digit suffix', () => {
        expect(parseSalespersonPhoneSuffix('Karthik 9876543210')).toBe('9876543210');
    });
    test('returns null when no suffix', () => {
        expect(parseSalespersonPhoneSuffix('Karthik')).toBeNull();
    });
});

describe('levenshtein', () => {
    test('identical strings → 0', () => {
        expect(levenshtein('karthik', 'karthik')).toBe(0);
    });
    test('one edit', () => {
        expect(levenshtein('karthik', 'kartik')).toBe(1);
    });
});

describe('matchSalesperson', () => {
    const painters = [
        { id: 10, full_name: 'Karthik', phone: '9876543210' },
        { id: 11, full_name: 'Ravi Kumar', phone: '9123456789' }
    ];
    test('exact phone match', () => {
        const res = matchSalesperson({ name: 'Karthik 9876543210' }, painters);
        expect(res).toEqual({ painter_id: 10, confidence: 'exact_phone' });
    });
    test('exact name match when phone missing', () => {
        const res = matchSalesperson({ name: 'Ravi Kumar' }, painters);
        expect(res).toEqual({ painter_id: 11, confidence: 'exact_name' });
    });
    test('fuzzy name (Levenshtein < 3)', () => {
        const res = matchSalesperson({ name: 'Kartik' }, painters);
        expect(res).toEqual({ painter_id: 10, confidence: 'fuzzy_name' });
    });
    test('unmatched returns null painter_id', () => {
        const res = matchSalesperson({ name: 'Completely Different' }, painters);
        expect(res).toEqual({ painter_id: null, confidence: 'unmatched' });
    });
});

const importService = require('../../services/pntr-import-service');

function makeMockPool(state) {
    return {
        query: jest.fn(async (sql, params) => {
            if (/FROM branches/i.test(sql)) return [state.branches];
            if (/FROM painters WHERE phone/i.test(sql)) {
                const phone = params[0];
                return [state.painters.filter(p => p.phone === phone)];
            }
            if (/FROM painter_leads WHERE phone/i.test(sql)) {
                const phone = params[0];
                return [state.leads.filter(l => l.phone === phone)];
            }
            if (/FROM zoho_customers_map.*zoho_contact_id/i.test(sql)) {
                return [state.custMap.filter(c => c.zoho_contact_id === params[0])];
            }
            if (/INTO painter_leads/i.test(sql)) {
                state.inserts.push({ table: 'painter_leads', params });
                return [{ insertId: state.inserts.length }];
            }
            if (/INTO painter_lead_duplicate_queue/i.test(sql)) {
                state.inserts.push({ table: 'duplicate_queue', params });
                return [{ insertId: 1 }];
            }
            if (/UPDATE painters/i.test(sql)) {
                state.inserts.push({ table: 'painters_update', params });
                return [{ affectedRows: 1 }];
            }
            if (/INSERT INTO painter_pntr_import_runs/i.test(sql)) return [{ insertId: 42 }];
            if (/UPDATE painter_pntr_import_runs/i.test(sql)) return [{ affectedRows: 1 }];
            return [[]];
        })
    };
}

describe('runBulkImport pipeline', () => {
    test('new PNTR customer → painter_leads INSERT with branch from prefix', async () => {
        const state = {
            branches: [{ id: 1, code: 'RMD', name: 'Ramanathapuram' }],
            painters: [],
            leads: [],
            custMap: [],
            inserts: []
        };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z100', contact_name: 'PNTR RMD Karthik', mobile: '9876543210' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.imported_count).toBe(1);
        const leadInsert = state.inserts.find(i => i.table === 'painter_leads');
        expect(leadInsert).toBeDefined();
        // params: [zoho_customer_id, full_name, phone, email, branch_id, branch_detected_via]
        expect(leadInsert.params[0]).toBe('Z100');
        expect(leadInsert.params[2]).toBe('9876543210');
        expect(leadInsert.params[4]).toBe(1); // branch_id RMD
    });

    test('matching existing painter → scenario 1: link, no lead INSERT for marketing', async () => {
        const state = {
            branches: [{ id: 1, code: 'RMD', name: 'Ramanathapuram' }],
            painters: [{ id: 50, phone: '9876543210', full_name: 'Karthik' }],
            leads: [],
            custMap: [],
            inserts: []
        };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z100', contact_name: 'PNTR RMD Karthik', mobile: '9876543210' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.linked_existing_painter).toBe(1);
        expect(state.inserts.some(i => i.table === 'painters_update')).toBe(true);
    });

    test('duplicate phone in leads → duplicate_queue INSERT', async () => {
        const state = {
            branches: [{ id: 1, code: 'RMD', name: 'Ramanathapuram' }],
            painters: [],
            leads: [{ id: 5, phone: '9876543210' }],
            custMap: [],
            inserts: []
        };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z200', contact_name: 'PNTR RMD DuplicateGuy', mobile: '9876543210' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.duplicates_queued).toBe(1);
        expect(state.inserts.some(i => i.table === 'duplicate_queue')).toBe(true);
    });

    test('invalid phone → errors_count++', async () => {
        const state = { branches: [], painters: [], leads: [], custMap: [], inserts: [] };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z300', contact_name: 'PNTR RMD NoPhone', mobile: '' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.errors_count).toBe(1);
        expect(result.imported_count).toBe(0);
    });
});
