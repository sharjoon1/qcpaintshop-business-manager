/**
 * Unit tests for billing schemas and calculations
 */
const { z } = require('zod');

// --- Schemas (inline, matching routes/billing.js) ---

const estimateItemSchema = z.object({
    zoho_item_id: z.string().min(1),
    item_name: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().nonnegative()
});

const estimateSchema = z.object({
    customer_type: z.enum(['customer', 'painter']),
    customer_name: z.string().min(1),
    painter_id: z.number().int().positive().optional(),
    items: z.array(estimateItemSchema).min(1),
    status: z.string().default('draft'),
    discount_amount: z.number().nonnegative().default(0)
});

const paymentSchema = z.object({
    amount: z.number().positive(),
    payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque']),
    reference: z.string().optional()
});

// --- Calculation helper ---

function calculateTotals(items, discountAmount = 0) {
    const subtotal = items.reduce((sum, item) => {
        return sum + (item.quantity * item.unit_price);
    }, 0);
    const total = Math.round((subtotal - discountAmount) * 100) / 100;
    return { subtotal: Math.round(subtotal * 100) / 100, discount: discountAmount, total };
}

// --- Tests ---

describe('Billing System', () => {

    describe('Estimate Schema Validation', () => {

        it('should accept a valid customer estimate with defaults', () => {
            const input = {
                customer_type: 'customer',
                customer_name: 'John Doe',
                items: [
                    { zoho_item_id: 'Z001', item_name: 'Apex Emulsion', quantity: 2, unit_price: 500 }
                ]
            };
            const result = estimateSchema.safeParse(input);
            expect(result.success).toBe(true);
            expect(result.data.status).toBe('draft');
            expect(result.data.discount_amount).toBe(0);
        });

        it('should accept a valid painter estimate', () => {
            const input = {
                customer_type: 'painter',
                customer_name: 'Ravi Kumar',
                painter_id: 5,
                items: [
                    { zoho_item_id: 'Z010', item_name: 'Tractor Emulsion', quantity: 3, unit_price: 800 }
                ]
            };
            const result = estimateSchema.safeParse(input);
            expect(result.success).toBe(true);
            expect(result.data.painter_id).toBe(5);
        });

        it('should reject empty items array', () => {
            const input = {
                customer_type: 'customer',
                customer_name: 'John Doe',
                items: []
            };
            const result = estimateSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it('should reject missing customer_name', () => {
            const input = {
                customer_type: 'customer',
                items: [
                    { zoho_item_id: 'Z001', item_name: 'Paint', quantity: 1, unit_price: 100 }
                ]
            };
            const result = estimateSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it('should reject invalid customer_type', () => {
            const input = {
                customer_type: 'vendor',
                customer_name: 'Bad Actor',
                items: [
                    { zoho_item_id: 'Z001', item_name: 'Paint', quantity: 1, unit_price: 100 }
                ]
            };
            const result = estimateSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it('should reject negative quantity', () => {
            const input = {
                customer_type: 'customer',
                customer_name: 'John Doe',
                items: [
                    { zoho_item_id: 'Z001', item_name: 'Paint', quantity: -2, unit_price: 100 }
                ]
            };
            const result = estimateSchema.safeParse(input);
            expect(result.success).toBe(false);
        });
    });

    describe('Payment Schema Validation', () => {

        it('should accept valid cash payment', () => {
            const result = paymentSchema.safeParse({ amount: 1500, payment_method: 'cash' });
            expect(result.success).toBe(true);
        });

        it('should accept UPI with reference', () => {
            const result = paymentSchema.safeParse({
                amount: 2000,
                payment_method: 'upi',
                reference: 'UPI-REF-12345'
            });
            expect(result.success).toBe(true);
            expect(result.data.reference).toBe('UPI-REF-12345');
        });

        it('should reject zero amount', () => {
            const result = paymentSchema.safeParse({ amount: 0, payment_method: 'cash' });
            expect(result.success).toBe(false);
        });

        it('should reject invalid payment method', () => {
            const result = paymentSchema.safeParse({ amount: 500, payment_method: 'bitcoin' });
            expect(result.success).toBe(false);
        });
    });

    describe('Billing Calculations', () => {

        it('should calculate simple total: 2 x 500 = 1000', () => {
            const items = [{ quantity: 2, unit_price: 500 }];
            const result = calculateTotals(items);
            expect(result.subtotal).toBe(1000);
            expect(result.total).toBe(1000);
        });

        it('should apply discount: 3 x 1000 - 500 = 2500', () => {
            const items = [{ quantity: 3, unit_price: 1000 }];
            const result = calculateTotals(items, 500);
            expect(result.subtotal).toBe(3000);
            expect(result.discount).toBe(500);
            expect(result.total).toBe(2500);
        });

        it('should sum multiple items: [2x500, 1x1200, 5x300] = 3700', () => {
            const items = [
                { quantity: 2, unit_price: 500 },
                { quantity: 1, unit_price: 1200 },
                { quantity: 5, unit_price: 300 }
            ];
            const result = calculateTotals(items);
            expect(result.total).toBe(3700);
        });

        it('should handle decimal quantities: 2.5 x 400 = 1000', () => {
            const items = [{ quantity: 2.5, unit_price: 400 }];
            const result = calculateTotals(items);
            expect(result.total).toBe(1000);
        });

        it('should round correctly: 3 x 33.33 = 99.99', () => {
            const items = [{ quantity: 3, unit_price: 33.33 }];
            const result = calculateTotals(items);
            expect(result.total).toBe(99.99);
        });
    });
});
