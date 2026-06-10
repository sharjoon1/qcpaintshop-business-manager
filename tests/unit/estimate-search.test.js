// Unit tests for estimate area-mode pack combination.
//
// T2: tests the REAL calculatePackCombo() — the production implementation
// lives in the inline <script> of public/estimate-create-new.html (frontend
// only; there is no server-side copy). Previously this file re-implemented a
// mirrored copy. We extract the actual function source from the page and
// evaluate it, so the assertions run against production code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCalculatePackCombo() {
    const html = fs.readFileSync(
        path.join(__dirname, '..', '..', 'public', 'estimate-create-new.html'), 'utf8'
    );
    const start = html.indexOf('function calculatePackCombo');
    if (start === -1) throw new Error('calculatePackCombo not found in estimate-create-new.html');
    let depth = 0, end = -1;
    for (let i = html.indexOf('{', start); i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end === -1) throw new Error('calculatePackCombo: unbalanced braces');
    const sandbox = {};
    vm.runInNewContext(`${html.slice(start, end)}; __fn = calculatePackCombo;`, sandbox);
    return sandbox.__fn;
}

const calculatePackCombo = loadCalculatePackCombo();

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
