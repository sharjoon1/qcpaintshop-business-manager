// tests/unit/vendors.test.js
const { z } = require('zod');

describe('Vendor System', () => {
    const createVendorSchema = z.object({
        vendor_name: z.string().min(1),
        contact_person: z.string().optional().default(''),
        phone: z.string().optional().default(''),
        email: z.string().optional().default(''),
        address: z.string().optional().default(''),
        gst_number: z.string().optional().default(''),
        payment_terms: z.number().int().min(0).optional().default(30),
        notes: z.string().optional().default(''),
    });

    const billItemSchema = z.object({
        zoho_item_id: z.string().optional().nullable().default(null),
        item_name: z.string().min(1),
        quantity: z.number().positive(),
        unit_price: z.number().min(0),
        ai_matched: z.boolean().optional().default(false),
        ai_confidence: z.number().min(0).max(1).optional().default(0),
    });

    const createBillSchema = z.object({
        vendor_id: z.number().int().positive(),
        bill_number: z.string().optional().default(''),
        bill_date: z.string().optional().nullable(),
        due_date: z.string().optional().nullable(),
        items: z.array(billItemSchema).min(1),
        tax_amount: z.number().min(0).optional().default(0),
        notes: z.string().optional().default(''),
    });

    const recordPaymentSchema = z.object({
        vendor_id: z.number().int().positive(),
        bill_id: z.number().int().positive().optional().nullable(),
        amount: z.number().positive(),
        payment_method: z.enum(['bank_transfer', 'cheque', 'upi', 'cash']),
        payment_reference: z.string().optional().default(''),
        payment_date: z.string().min(1),
        notes: z.string().optional().default(''),
    });

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
        function verifyBillItems(staffItems, aiExtractedData) {
            if (!aiExtractedData || !aiExtractedData.items) {
                return { status: 'verified', differences: [] };
            }
            const differences = [];
            const aiItems = aiExtractedData.items;

            if (staffItems.length !== aiItems.length) {
                differences.push({ field: 'item_count', expected: aiItems.length, actual: staffItems.length });
            }

            const maxLen = Math.min(staffItems.length, aiItems.length);
            for (let i = 0; i < maxLen; i++) {
                if (aiItems[i].quantity != null && Math.abs(parseFloat(staffItems[i].quantity) - aiItems[i].quantity) > 0.01) {
                    differences.push({ field: `item_${i + 1}_quantity`, expected: aiItems[i].quantity, actual: parseFloat(staffItems[i].quantity) });
                }
                if (aiItems[i].rate != null && Math.abs(parseFloat(staffItems[i].unit_price) - aiItems[i].rate) > 0.01) {
                    differences.push({ field: `item_${i + 1}_rate`, expected: aiItems[i].rate, actual: parseFloat(staffItems[i].unit_price) });
                }
            }

            return { status: differences.length === 0 ? 'verified' : 'mismatch', differences };
        }

        it('should verify matching items', () => {
            const staff = [{ quantity: 5, unit_price: 2000, line_total: 10000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('verified');
            expect(result.differences).toHaveLength(0);
        });

        it('should detect quantity mismatch', () => {
            const staff = [{ quantity: 10, unit_price: 500, line_total: 5000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
            expect(result.differences[0].field).toBe('item_1_quantity');
        });

        it('should detect rate mismatch', () => {
            const staff = [{ quantity: 5, unit_price: 600, line_total: 3000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
        });

        it('should verify when no AI data', () => {
            const staff = [{ quantity: 5, unit_price: 500, line_total: 2500 }];
            const result = verifyBillItems(staff, null);
            expect(result.status).toBe('verified');
        });

        it('should detect item count mismatch', () => {
            const staff = [
                { quantity: 5, unit_price: 500, line_total: 2500 },
                { quantity: 3, unit_price: 200, line_total: 600 }
            ];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
        });
    });
});
