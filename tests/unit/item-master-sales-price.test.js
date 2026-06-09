/**
 * §6 — DPL sales-price formula must match the canonical parser/dpl-catalog rule
 * ceil(DPL × 1.18 × 1.10) (18% GST × 10% markup, owner-confirmed). routes/item-master.js
 * calculateSalesPrice used ceil(DPL × 1.298), which float-diverges by ₹1 on some DPL
 * values (e.g. 1500/2500/3000), so the route under-charged vs the catalog. Lock it to
 * the canonical expression so all surfaces agree.
 */
const { calculateSalesPrice } = require('../../routes/item-master');

const canonical = (dpl) => Math.ceil(dpl * 1.18 * 1.10);

describe('calculateSalesPrice (§6 DPL → sales price)', () => {
    test('matches canonical ceil(dpl*1.18*1.10) for the known float-divergent values', () => {
        // These differ from the old ceil(dpl*1.298): canonical is +1.
        expect(calculateSalesPrice(1500)).toBe(1948);
        expect(calculateSalesPrice(2500)).toBe(3246);
        expect(calculateSalesPrice(3000)).toBe(3895);
    });

    test('matches the canonical parser formula across the full DPL range', () => {
        for (let dpl = 1; dpl <= 5000; dpl++) {
            expect(calculateSalesPrice(dpl)).toBe(canonical(dpl));
        }
    });
});
