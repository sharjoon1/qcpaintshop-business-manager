// Unit tests for estimate search helpers
// Tests the pure calculatePackCombo() function used in area mode

function calculatePackCombo(litersNeeded, packSizes) {
    if (!packSizes || packSizes.length === 0) return [];
    const sorted = [...packSizes].sort((a, b) => b.size - a.size);
    const result = [];
    let remaining = litersNeeded;
    for (const pack of sorted) {
        if (remaining <= 0.001) break;
        const count = Math.floor(remaining / pack.size);
        if (count > 0) {
            result.push({ zoho_item_id: pack.zoho_item_id, name: pack.name, size: pack.size, rate: pack.rate, quantity: count });
            remaining -= count * pack.size;
        }
    }
    if (remaining > 0.001) {
        const smallest = sorted[sorted.length - 1];
        const existing = result.find(r => r.zoho_item_id === smallest.zoho_item_id);
        if (existing) existing.quantity += 1;
        else result.push({ zoho_item_id: smallest.zoho_item_id, name: smallest.name, size: smallest.size, rate: smallest.rate, quantity: 1 });
    }
    return result;
}

describe('calculatePackCombo', () => {
    const packs = [
        { zoho_item_id: 'Z20', name: 'Apex 20L', size: 20, rate: 6250 },
        { zoho_item_id: 'Z10', name: 'Apex 10L', size: 10, rate: 3250 },
        { zoho_item_id: 'Z4',  name: 'Apex 4L',  size: 4,  rate: 1400 },
        { zoho_item_id: 'Z1',  name: 'Apex 1L',  size: 1,  rate: 400  },
    ];

    it('exact fit: 20L uses exactly 1×20L', () => {
        const result = calculatePackCombo(20, packs);
        expect(result).toEqual([{ zoho_item_id: 'Z20', name: 'Apex 20L', size: 20, rate: 6250, quantity: 1 }]);
    });

    it('31.25L → 1×20L + 1×10L + 2×1L', () => {
        const result = calculatePackCombo(31.25, packs);
        const z20 = result.find(r => r.zoho_item_id === 'Z20');
        const z10 = result.find(r => r.zoho_item_id === 'Z10');
        const z1  = result.find(r => r.zoho_item_id === 'Z1');
        expect(z20?.quantity).toBe(1);
        expect(z10?.quantity).toBe(1);
        expect(z1?.quantity).toBe(2);
    });

    it('returns empty array for empty packs', () => {
        expect(calculatePackCombo(10, [])).toEqual([]);
    });

    it('rounds up remainder to 1 extra smallest pack', () => {
        const result = calculatePackCombo(5, [{ zoho_item_id: 'Z4', name: 'Apex 4L', size: 4, rate: 1400 }]);
        expect(result[0].quantity).toBe(2);
    });

    it('single pack type: 45L with only 20L packs → 3×20L', () => {
        const result = calculatePackCombo(45, [{ zoho_item_id: 'Z20', name: 'Apex 20L', size: 20, rate: 6250 }]);
        expect(result[0].quantity).toBe(3);
    });
});
