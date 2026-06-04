/**
 * Characterization tests for the estimate pricing engine.
 *
 * These lock the CURRENT behavior of routes/estimates.js so that any future
 * change (including the planned fixes for the double-₹10-rounding and the
 * hardcoded gst_amount=0) is a deliberate, visible diff — not an accident.
 *
 * Where an assertion encodes a KNOWN DEFECT, it is labelled so. Do not "fix"
 * the assertion to match a corrected value without also changing the engine
 * and getting business sign-off (see CLAUDE.md §6 / COMPLETION_STATUS.md §4).
 */
const { calculateItemPricing, calculateEstimateTotals } = require('../../routes/estimates');

describe('calculateItemPricing', () => {
    it('plain item: base 100 × qty 2, no markup/discount → line 200', () => {
        const r = calculateItemPricing({ base_price: 100, quantity: 2 });
        expect(r.final_price).toBe(100);
        expect(r.unit_price).toBe(100);
        expect(r.line_total).toBe(200);
        expect(r.markup_amount).toBe(0);
        expect(r.discount_amount).toBe(0);
    });

    it('falls back to unit_price when base_price absent', () => {
        const r = calculateItemPricing({ unit_price: 250, quantity: 1 });
        expect(r.final_price).toBe(250);
        expect(r.line_total).toBe(250);
    });

    it('defaults quantity to 1 when missing', () => {
        const r = calculateItemPricing({ base_price: 80 });
        expect(r.line_total).toBe(80);
    });

    it('price_pct markup adds % to unit price', () => {
        const r = calculateItemPricing({ base_price: 100, quantity: 1, markup_type: 'price_pct', markup_value: 10 });
        expect(r.markup_amount).toBe(10);
        expect(r.price_after_markup).toBe(110);
        expect(r.final_price).toBe(110); // r10(110)
    });

    it('price_pct discount subtracts % from price-after-markup', () => {
        const r = calculateItemPricing({ base_price: 100, quantity: 1, discount_type: 'price_pct', discount_value: 10 });
        expect(r.discount_amount).toBe(10);
        expect(r.final_price).toBe(90); // r10(90)
    });

    it('total_value discount divides total by quantity', () => {
        const r = calculateItemPricing({ base_price: 100, quantity: 4, discount_type: 'total_value', discount_value: 40 });
        // 40 total / 4 qty = 10 per unit → 90 each → r10(90)=90 → line r10(360)=360
        expect(r.discount_amount).toBe(10);
        expect(r.final_price).toBe(90);
        expect(r.line_total).toBe(360);
    });

    it('rounds unit price UP to nearest ₹10', () => {
        const r = calculateItemPricing({ base_price: 121, quantity: 1 });
        expect(r.final_price).toBe(130); // ceil(121/10)*10
    });

    // --- KNOWN DEFECT (P0-1): double ₹10 rounding overcharges ---
    it('[KNOWN BUG] double-rounds unit AND line total → systematic overcharge', () => {
        const r = calculateItemPricing({ base_price: 127.5, quantity: 5 });
        // Engine: unit r10(127.5)=130, then line r10(130*5)=r10(650)=650.
        // Correct (single round at line level) would be r10(127.5*5)=r10(637.5)=640.
        expect(r.final_price).toBe(130);
        expect(r.line_total).toBe(650); // <-- documents the ₹10 overcharge vs 640
    });
});

describe('calculateEstimateTotals', () => {
    it('sums product line totals into subtotal and adds labor into grand_total', () => {
        const totals = calculateEstimateTotals([
            { item_type: 'product', line_total: 200, markup_amount: 0, discount_amount: 0, quantity: 2 },
            { item_type: 'labor', line_total: 500 },
        ]);
        expect(totals.subtotal).toBe(200);
        expect(totals.total_labor).toBe(500);
        expect(totals.grand_total).toBe(700);
    });

    it('multiplies per-unit markup/discount by quantity in totals', () => {
        const totals = calculateEstimateTotals([
            { item_type: 'product', line_total: 360, markup_amount: 5, discount_amount: 10, quantity: 4 },
        ]);
        expect(totals.total_markup).toBe(20);   // 5 × 4
        expect(totals.total_discount).toBe(40); // 10 × 4
    });

    // --- KNOWN BEHAVIOUR (P0-2): GST is hardcoded to 0 ---
    it('[CONFIRM INTENT] gst_amount is always 0 (Zoho prices assumed GST-inclusive)', () => {
        const totals = calculateEstimateTotals([
            { item_type: 'product', line_total: 1180, markup_amount: 0, discount_amount: 0, quantity: 1 },
        ]);
        expect(totals.gst_amount).toBe(0);          // do NOT change without business sign-off
        expect(totals.grand_total).toBe(1180);      // grand_total excludes any separate GST line
    });
});
