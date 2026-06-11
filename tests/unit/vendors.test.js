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
const { createVendorSchema, createBillSchema, recordPaymentSchema } = require('../../routes/vendors');
const { verifyBillItems, matchProductsToZoho, setPool } = require('../../services/vendor-bill-ai-service');

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
    });
});
