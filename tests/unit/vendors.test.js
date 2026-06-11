// tests/unit/vendors.test.js
//
// T2: tests the REAL modules — Zod schemas from routes/vendors.js and
// verifyBillItems from services/vendor-bill-ai-service.js. Previously this
// file re-implemented mirrored copies of both.
//
// NOTE (T2 finding, FIXED 2026-06-12): verifyBillItems used to read only
// staff.rate, but POST /bills/:id/verify feeds it vendor_bill_items rows
// whose cost column is unit_price — the rate comparison always saw 0 and
// false-flagged any AI-extracted rate. Owner vocabulary (2026-06-12):
// unit price = DPL (cost); "rate" = sales price (DPL + 18% GST + 10%
// margin). A vendor bill's printed line price IS the cost, so the AI's
// ai.rate compares against unit_price on DB rows (staff.rate kept for
// AI-shaped callers).
const { createVendorSchema, createBillSchema, recordPaymentSchema, listQuerySchema, computeBillTotals } = require('../../routes/vendors');
const { verifyBillItems, matchProductsToZoho, setPool, buildReconciliation, normalizeScan } = require('../../services/vendor-bill-ai-service');

describe('Vendor System', () => {

    describe('Vendor Schema', () => {
        it('should accept valid vendor', () => {
            const result = createVendorSchema.safeParse({ vendor_name: 'Asian Paints' });
            expect(result.success).toBe(true);
            expect(result.data.payment_terms).toBe(30);
        });

        it('should reject missing vendor_name', () => {
            const result = createVendorSchema.safeParse({ phone: '9876543210' });
            expect(result.success).toBe(false);
        });
    });

    describe('Bill Schema', () => {
        it('should accept valid bill', () => {
            const result = createBillSchema.safeParse({
                vendor_id: 1,
                items: [{ item_name: 'Emulsion 10L', quantity: 5, unit_price: 2000 }]
            });
            expect(result.success).toBe(true);
        });

        it('should accept bill with AI-matched items', () => {
            const result = createBillSchema.safeParse({
                vendor_id: 1,
                items: [{
                    zoho_item_id: 'Z001',
                    item_name: 'Primer',
                    quantity: 10,
                    unit_price: 500,
                    ai_matched: true,
                    ai_confidence: 0.85
                }]
            });
            expect(result.success).toBe(true);
            expect(result.data.items[0].ai_matched).toBe(true);
        });

        it('should reject empty items', () => {
            const result = createBillSchema.safeParse({ vendor_id: 1, items: [] });
            expect(result.success).toBe(false);
        });
    });

    describe('List Query Schema (limit cap)', () => {
        // This cap silently 400'd every limit=999 fetch the page used to make
        // (vendor dropdowns, View/Edit PO, the Outstanding stat). The UI now
        // uses /all, /stats and /purchase-orders/:id instead — these tests
        // lock the cap so any future "fetch the whole list" call fails loudly
        // in review, not silently in prod.
        it('rejects limit above 100', () => {
            const result = listQuerySchema.safeParse({ limit: '999' });
            expect(result.success).toBe(false);
        });

        it('accepts limit of exactly 100', () => {
            const result = listQuerySchema.safeParse({ limit: '100' });
            expect(result.success).toBe(true);
            expect(result.data.limit).toBe(100);
        });

        it('defaults page=1 limit=20 and coerces string params', () => {
            const result = listQuerySchema.safeParse({});
            expect(result.success).toBe(true);
            expect(result.data.page).toBe(1);
            expect(result.data.limit).toBe(20);

            const coerced = listQuerySchema.safeParse({ page: '3', limit: '50' });
            expect(coerced.success).toBe(true);
            expect(coerced.data.page).toBe(3);
            expect(coerced.data.limit).toBe(50);
        });
    });

    describe('Payment Schema', () => {
        it('should accept valid bank payment', () => {
            const result = recordPaymentSchema.safeParse({
                vendor_id: 1,
                amount: 50000,
                payment_method: 'bank_transfer',
                payment_date: '2026-04-01'
            });
            expect(result.success).toBe(true);
        });

        it('should reject invalid payment method', () => {
            const result = recordPaymentSchema.safeParse({
                vendor_id: 1, amount: 100, payment_method: 'credit', payment_date: '2026-04-01'
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Bill Verification Logic', () => {
        // Staff items shaped per the real function's contract: quantity/rate/amount.
        it('should verify matching items', () => {
            const staff = [{ item_name: 'Paint', quantity: 5, rate: 2000, amount: 10000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000 }], total: 10000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('verified');
            expect(result.differences).toHaveLength(0);
        });

        it('accepts vendor_bill_items DB rows (unit_price cost column, no rate) and verifies clean on match', () => {
            // shape produced by POST /bills/:id/verify — raw DB rows
            const staff = [{ item_name: 'Paint', quantity: 5, unit_price: 2000, amount: 10000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000 }], total: 10000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('verified');
            expect(result.differences).toHaveLength(0);
        });

        it('still flags a real cost mismatch on DB-shaped rows', () => {
            const staff = [{ item_name: 'Paint', quantity: 5, unit_price: 1800, amount: 9000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000 }], total: 9000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
            expect(result.differences.some(d => d.field === 'rate')).toBe(true);
        });

        it('matchProductsToZoho attaches the catalog HSN to matched lines and keeps the bill HSN otherwise', async () => {
            setPool({
                query: jest.fn(async (sql) => {
                    if (/FROM zoho_items_map/i.test(sql)) {
                        return [[{ zoho_item_id: 'Z1', zoho_item_name: 'apex ultima 10l', sku: 'AP1', brand: 'Asian', rate: 2000, hsn_or_sac: '3209' }]];
                    }
                    return [[]];
                }),
            });
            const out = await matchProductsToZoho([
                { name: 'APEX ULTIMA 10L', hsn_or_sac: '9999', quantity: 1, rate: 1800, amount: 1800 },
                { name: 'totally unknown thing', hsn_or_sac: '3208', quantity: 1, rate: 100, amount: 100 },
            ], null);
            // matched line: catalog HSN WINS over what the AI read off the bill
            expect(out[0].zoho_item_id).toBe('Z1');
            expect(out[0].hsn_or_sac).toBe('3209');
            expect(out[0].zoho_hsn).toBe('3209');
            // unmatched line: keeps the bill's printed HSN so the staff can fix the match
            expect(out[1].zoho_item_id).toBeNull();
            expect(out[1].hsn_or_sac).toBe('3208');
            expect(out[1].ai_matched).toBe(false);
        });

        it('should detect quantity mismatch', () => {
            const staff = [{ item_name: 'Paint', quantity: 10, rate: 500, amount: 5000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }], total: 5000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
            expect(result.differences[0].field).toBe('quantity');
        });

        it('should detect rate mismatch', () => {
            const staff = [{ item_name: 'Paint', quantity: 5, rate: 600, amount: 3000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }], total: 3000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
        });

        it('should verify when no AI data', () => {
            const staff = [{ item_name: 'Paint', quantity: 5, rate: 500, amount: 2500 }];
            const result = verifyBillItems(staff, null);
            expect(result.status).toBe('verified');
        });

        it('should detect item count mismatch', () => {
            const staff = [
                { item_name: 'Paint', quantity: 5, rate: 500, amount: 2500 },
                { item_name: 'Brush', quantity: 3, rate: 200, amount: 600 }
            ];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }], total: 3100 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
        });

        it('flags an HSN mismatch when both staff and AI lines carry one and they differ', () => {
            const staff = [{ item_name: 'Paint', quantity: 5, rate: 2000, amount: 10000, hsn_or_sac: '3209' }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000, hsn_or_sac: '3208' }], total: 10000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
            const hsnDiff = result.differences.find(d => d.field === 'hsn');
            expect(hsnDiff).toBeDefined();
            expect(hsnDiff.expected).toBe('3208');
            expect(hsnDiff.actual).toBe('3209');
        });

        it('does NOT flag HSN when either side is missing one (absence is the gate’s job)', () => {
            const staffNoHsn = [{ item_name: 'Paint', quantity: 5, rate: 2000, amount: 10000 }];
            const aiWithHsn = { items: [{ name: 'Paint', quantity: 5, rate: 2000, hsn_or_sac: '3208' }], total: 10000 };
            expect(verifyBillItems(staffNoHsn, aiWithHsn).status).toBe('verified');

            const staffWithHsn = [{ item_name: 'Paint', quantity: 5, rate: 2000, amount: 10000, hsn_or_sac: '3209' }];
            const aiNoHsn = { items: [{ name: 'Paint', quantity: 5, rate: 2000 }], total: 10000 };
            expect(verifyBillItems(staffWithHsn, aiNoHsn).status).toBe('verified');
        });

        it('still verifies clean when matching HSNs are present on both sides', () => {
            const staff = [{ item_name: 'Paint', quantity: 5, rate: 2000, amount: 10000, hsn_or_sac: '3209' }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000, hsn_or_sac: '3209' }], total: 10000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('verified');
        });

        it('computes the staff total from line_total on DB-shaped rows (no amount column)', () => {
            // vendor_bill_items rows have line_total, NOT amount — before the
            // fix the staff total computed 0 and false-flagged every verify.
            const staff = [{ item_name: 'Paint', quantity: 5, unit_price: 2000, line_total: 10000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000 }], total: 10000 };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('verified');
            expect(result.differences).toHaveLength(0);
        });

        it('verifies a real GST bill: Σline_total (pre-tax) vs AI subtotal, NOT post-tax total (BILL-20260611-001)', () => {
            // Owner's stuck bill: one line 5 × 3740 = 18700 pre-tax subtotal.
            // AI printed subtotal 18700, discount 1823.25, GST 3037.82, total
            // 19914.57 (post-tax grand). The OLD code compared 18700 vs 19914.57
            // → permanent 'total' mismatch → un-pushable. Must be 'verified'.
            const staff = [{ item_name: 'SEAL O PRIMER 20 L', quantity: 5, unit_price: 3740, line_total: 18700, hsn_or_sac: '32091090' }];
            const ai = {
                items: [{ name: 'SEAL O PRIMER 20 L', quantity: 5, rate: 3740, hsn_or_sac: '32091090' }],
                subtotal: 18700, discount: 1823.25, tax: 3037.82, total: 19914.57
            };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('verified');
            expect(result.differences).toHaveLength(0);
        });

        it('still flags a genuine subtotal mismatch (line sum disagrees with AI subtotal)', () => {
            const staff = [{ item_name: 'Paint', quantity: 5, unit_price: 3740, line_total: 18700 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 3740 }], subtotal: 17000, tax: 3060, total: 20060 };
            const result = verifyBillItems(staff, ai);
            // qty 5=5, rate 3740=3740 match; only the subtotal disagrees (18700 vs 17000)
            expect(result.status).toBe('mismatch');
            expect(result.differences.some(d => d.field === 'subtotal')).toBe(true);
        });
    });

    describe('migrations export up()', () => {
        it.each([
            '20260612_vendor_po_bill_link.js',
            '20260612_vendor_bill_discount.js',
            '20260612_zoho_location_salesperson.js',
        ])('%s exports an up() function', (file) => {
            expect(typeof require(`../../migrations/${file}`).up).toBe('function');
        });
    });

    describe('normalizeScan (pack-count quantity + numeric discount/tax)', () => {
        it('corrects qty from total-volume to pack count via amount/rate (Berger 100→5)', () => {
            const d = normalizeScan({ items: [{ name: 'SEAL-O-PRIME 20L', quantity: 100, rate: 3740, amount: 18700 }] });
            expect(d.items[0].quantity).toBe(5); // 18700 / 3740
        });

        it('leaves a consistent line alone (qty×rate already = amount)', () => {
            const d = normalizeScan({ items: [{ name: 'X', quantity: 5, rate: 3740, amount: 18700 }] });
            expect(d.items[0].quantity).toBe(5);
        });

        it('does not "correct" when amount/rate is not a clean integer', () => {
            const d = normalizeScan({ items: [{ name: 'Y', quantity: 3, rate: 100, amount: 257 }] });
            expect(d.items[0].quantity).toBe(3); // 2.57 → not clean, keep
        });

        it('coerces bill-level discount/tax/total to numbers', () => {
            const d = normalizeScan({ items: [], discount: '1823.25', tax: '3037.82', total: '19914.57' });
            expect(d.discount).toBe(1823.25);
            expect(d.tax).toBe(3037.82);
            expect(d.total).toBe(19914.57);
        });

        it('recovers a missing discount from subtotal/tax/total (owner: "GST applied but discount didn\'t")', () => {
            // AI read GST + totals but returned no discount. taxable = total − tax,
            // discount = subtotal − taxable → the printed 1823.25 is recovered.
            const d = normalizeScan({ items: [], subtotal: 18700, discount: 0, tax: 3037.82, total: 19914.57 });
            expect(d.discount).toBe(1823.25);
        });

        it('does NOT invent a discount on a tax-inclusive bill (subtotal already = taxable)', () => {
            const d = normalizeScan({ items: [], subtotal: 1000, discount: 0, tax: 180, total: 1180 });
            expect(d.discount).toBe(0);
        });

        it('keeps an AI-read discount instead of recomputing it', () => {
            const d = normalizeScan({ items: [], subtotal: 18700, discount: 1823.25, tax: 3037.82, total: 19914.57 });
            expect(d.discount).toBe(1823.25);
        });

        it('ignores an implausible (negative or ≥ subtotal) derived discount', () => {
            // total > subtotal+tax would imply a negative discount → ignore
            const d = normalizeScan({ items: [], subtotal: 1000, discount: 0, tax: 180, total: 1300 });
            expect(d.discount).toBe(0);
        });
    });

    describe('computeBillTotals (DPL subtotal − discount → +GST)', () => {
        it('reproduces a real Berger bill: 18700 − 1823.25 = 16876.75 → +18% = 19914.57', () => {
            // line: SEAL-O-PRIME 20L, 5 packs @ 3740 DPL = 18700 subtotal
            const t = computeBillTotals([{ quantity: 5, unit_price: 3740 }], 1823.25);
            expect(t.subtotal).toBe(18700);
            expect(t.discount).toBe(1823.25);
            expect(t.taxable).toBe(16876.75);
            expect(t.tax).toBe(3037.82);   // 16876.75 × 0.18 = 3037.815 → 3037.82
            expect(t.grand).toBe(19914.57);
        });

        it('auto-computes 18% GST when no explicit tax is given', () => {
            const t = computeBillTotals([{ quantity: 1, unit_price: 1000 }]);
            expect(t.taxable).toBe(1000);
            expect(t.tax).toBe(180);
            expect(t.grand).toBe(1180);
        });

        it('uses an explicit tax amount when supplied (IGST / odd bills)', () => {
            const t = computeBillTotals([{ quantity: 1, unit_price: 1000 }], 0, 175.5);
            expect(t.tax).toBe(175.5);
            expect(t.grand).toBe(1175.5);
        });

        it('discount cannot exceed the subtotal', () => {
            const t = computeBillTotals([{ quantity: 1, unit_price: 100 }], 500);
            expect(t.discount).toBe(100);
            expect(t.taxable).toBe(0);
            expect(t.grand).toBe(0);
        });
    });

    describe('buildReconciliation (line-by-line diff model for the UI)', () => {
        it('flags qty/rate/hsn diffs per line and what each line needs', () => {
            const billItems = [
                // line 0: qty + rate differ, matched + hsn present
                { item_name: 'Primer', quantity: 1, unit_price: 4699, hsn_or_sac: '3208', zoho_item_id: 'Z1', ai_matched: 1, ai_confidence: 0.9 },
                // line 1: unmatched + no hsn
                { item_name: 'Putty', quantity: 3, unit_price: 1200, hsn_or_sac: '', zoho_item_id: null, ai_matched: 0, ai_confidence: 0 },
            ];
            const aiData = { items: [
                { name: 'Primer 20L', quantity: 2, rate: 4699, hsn_or_sac: '321130' },
                { name: 'Putty', quantity: 3, rate: 1200, hsn_or_sac: '3214' },
            ], total: 13598 };

            const r = buildReconciliation(billItems, aiData);
            expect(r.lines).toHaveLength(2);
            expect(r.lines[0].diffs).toEqual({ quantity: true, rate: false, hsn: true });
            expect(r.lines[0].ai).toEqual({ name: 'Primer 20L', quantity: 2, rate: 4699, hsn_or_sac: '321130' });
            expect(r.lines[0].needs_match).toBe(false);
            expect(r.lines[1].needs_match).toBe(true);
            expect(r.lines[1].needs_hsn).toBe(true);
            // a missing HSN on the bill side is NOT a 'hsn diff' (gate handles absence)
            expect(r.lines[1].diffs.hsn).toBe(false);
            expect(r.summary).toMatchObject({ quantity: 1, hsn: 1, needs_match: 1, needs_hsn: 1, count_diff: false });
        });

        it('reports AI lines beyond the bill count as ai_extra', () => {
            const r = buildReconciliation(
                [{ item_name: 'A', quantity: 1, unit_price: 100, hsn_or_sac: '1', zoho_item_id: 'Z' }],
                { items: [{ name: 'A', quantity: 1, rate: 100, hsn_or_sac: '1' }, { name: 'B', quantity: 2, rate: 50, hsn_or_sac: '2' }] }
            );
            expect(r.summary.count_diff).toBe(true);
            expect(r.ai_extra).toEqual([{ name: 'B', quantity: 2, rate: 50, hsn_or_sac: '2' }]);
        });

        it('uses unit_price (DB cost column) for the rate comparison', () => {
            // line matches on rate when unit_price === ai.rate
            const r = buildReconciliation(
                [{ item_name: 'X', quantity: 1, unit_price: 999, hsn_or_sac: '1', zoho_item_id: 'Z' }],
                { items: [{ name: 'X', quantity: 1, rate: 999, hsn_or_sac: '1' }] }
            );
            expect(r.lines[0].diffs.rate).toBe(false);
            expect(r.lines[0].bill.unit_price).toBe(999);
        });
    });

    describe('billItemSchema persists hsn_or_sac (Zod no longer strips it)', () => {
        it('keeps hsn_or_sac through createBillSchema item parsing', () => {
            const parsed = createBillSchema.safeParse({
                vendor_id: 1,
                items: [{ item_name: 'P', quantity: 1, unit_price: 10, hsn_or_sac: '3208' }],
            });
            expect(parsed.success).toBe(true);
            expect(parsed.data.items[0].hsn_or_sac).toBe('3208');
        });
    });
});
