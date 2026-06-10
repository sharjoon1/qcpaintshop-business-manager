/**
 * Unit tests for billing schemas and calculations.
 *
 * T2: tests the REAL routes/billing.js exports (createEstimateSchema,
 * recordPaymentSchema, calculateTotals) — previously this file re-implemented
 * mirrored copies of the schemas/math. Behavioral expectations are unchanged.
 */
const { createEstimateSchema, recordPaymentSchema, calculateTotals } = require('../../routes/billing');

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
            const result = createEstimateSchema.safeParse(input);
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
            const result = createEstimateSchema.safeParse(input);
            expect(result.success).toBe(true);
            expect(result.data.painter_id).toBe(5);
        });

        it('should reject empty items array', () => {
            const input = {
                customer_type: 'customer',
                customer_name: 'John Doe',
                items: []
            };
            const result = createEstimateSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it('should reject missing customer_name', () => {
            const input = {
                customer_type: 'customer',
                items: [
                    { zoho_item_id: 'Z001', item_name: 'Paint', quantity: 1, unit_price: 100 }
                ]
            };
            const result = createEstimateSchema.safeParse(input);
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
            const result = createEstimateSchema.safeParse(input);
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
            const result = createEstimateSchema.safeParse(input);
            expect(result.success).toBe(false);
        });
    });

    describe('Payment Schema Validation', () => {

        it('should accept valid cash payment', () => {
            const result = recordPaymentSchema.safeParse({ amount: 1500, payment_method: 'cash' });
            expect(result.success).toBe(true);
        });

        it('should accept UPI with reference', () => {
            // Real schema field is payment_reference (the mirror used "reference")
            const result = recordPaymentSchema.safeParse({
                amount: 2000,
                payment_method: 'upi',
                payment_reference: 'UPI-REF-12345'
            });
            expect(result.success).toBe(true);
            expect(result.data.payment_reference).toBe('UPI-REF-12345');
        });

        it('should reject zero amount', () => {
            const result = recordPaymentSchema.safeParse({ amount: 0, payment_method: 'cash' });
            expect(result.success).toBe(false);
        });

        it('should reject invalid payment method', () => {
            const result = recordPaymentSchema.safeParse({ amount: 500, payment_method: 'bitcoin' });
            expect(result.success).toBe(false);
        });
    });

    describe('Billing Calculations', () => {

        it('should calculate simple total: 2 x 500 = 1000', () => {
            const items = [{ quantity: 2, unit_price: 500 }];
            const result = calculateTotals(items);
            expect(result.subtotal).toBe(1000);
            expect(result.grandTotal).toBe(1000);
        });

        it('should apply discount: 3 x 1000 - 500 = 2500', () => {
            const items = [{ quantity: 3, unit_price: 1000 }];
            const result = calculateTotals(items, 500);
            expect(result.subtotal).toBe(3000);
            expect(result.grandTotal).toBe(2500);
        });

        it('should sum multiple items: [2x500, 1x1200, 5x300] = 3700', () => {
            const items = [
                { quantity: 2, unit_price: 500 },
                { quantity: 1, unit_price: 1200 },
                { quantity: 5, unit_price: 300 }
            ];
            const result = calculateTotals(items);
            expect(result.grandTotal).toBe(3700);
        });

        it('should handle decimal quantities: 2.5 x 400 = 1000', () => {
            const items = [{ quantity: 2.5, unit_price: 400 }];
            const result = calculateTotals(items);
            expect(result.grandTotal).toBe(1000);
        });

        it('should compute exact decimals: 3 x 33.33 = 99.99', () => {
            const items = [{ quantity: 3, unit_price: 33.33 }];
            const result = calculateTotals(items);
            expect(result.grandTotal).toBe(99.99);
        });

        it('floors the grand total at 0 when the discount exceeds the subtotal', () => {
            const result = calculateTotals([{ quantity: 1, unit_price: 100 }], 500);
            expect(result.subtotal).toBe(100);
            expect(result.grandTotal).toBe(0); // never a negative grand_total
        });
    });
});
