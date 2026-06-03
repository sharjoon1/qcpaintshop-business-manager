/**
 * One-off: convert a LONG Birla Opus price CSV
 *   Category,SubCategory,Product,ProductCode,BaseCode,BaseName,ProdBaseCode,Unit,Price_excl_GST
 * into the WIDE "sparse matrix" CSV that services/price-list-parser.js::parseBirlaOpusCsv accepts
 *   Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,<size cols...>
 * Then VERIFY by running the real parser on the output.
 *
 * Usage: node scripts/convert-birla-long-to-wide.js <input.csv> <output.csv>
 */
const fs = require('fs');
const { parseBirlaOpusCsv } = require('../services/price-list-parser');

// Canonical size column names the parser recognises (from BIRLA_OPUS_SIZE_COLUMNS).
const SIZE_COLS = [
    '50ML','100ML','200ML','400ML','500ML',
    '0.2L','0.5L','0.9L','1L','2.5L','3.6L','4L','5L','6L','7.5L','9L',
    '10L','12.5L','18L','20L','25L','30L','37.5L',
    '0.5KG','1KG','2KG','3KG','5KG','10KG','12KG','15KG','20KG','25KG','30KG',
    'Per Unit','Per Tube','Per Sheet',
];
const SIZE_SET = new Set(SIZE_COLS);

function normUnit(u) {
    const t = String(u == null ? '' : u).trim();
    for (const cand of [t, t.replace(/\s+/g, ''), t.replace(/\s+/g, '').toUpperCase()]) {
        if (SIZE_SET.has(cand)) return cand;
    }
    return null; // unknown → caller warns
}

function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('Usage: node convert-birla-long-to-wide.js <in> <out>'); process.exit(1); }

let raw = fs.readFileSync(inPath, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const lines = raw.split(/\r?\n/).filter(l => l.trim());
const header = lines[0].split(',').map(h => h.trim());
const idx = {};
header.forEach((h, i) => { idx[h] = i; });

const need = ['Category', 'SubCategory', 'Product', 'ProductCode', 'BaseCode', 'BaseName', 'ProdBaseCode', 'Unit', 'Price_excl_GST'];
for (const n of need) if (idx[n] == null) { console.error('Input missing column:', n); process.exit(1); }

const groups = new Map();   // key: ProductCode|ProdBaseCode -> { meta, sizes: {sizeCol: price} }
const unknownUnits = new Set();
let dataRows = 0, valuesPlaced = 0, droppedNoPrice = 0;

for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const productCode = (c[idx.ProductCode] || '').trim();
    const prodBaseCode = (c[idx.ProdBaseCode] || '').trim();
    const product = (c[idx.Product] || '').trim();
    if (!product || !prodBaseCode) continue;
    dataRows++;

    const unitRaw = (c[idx.Unit] || '').trim();
    const sizeCol = normUnit(unitRaw);
    if (!sizeCol) { unknownUnits.add(unitRaw); continue; }

    const priceRaw = (c[idx.Price_excl_GST] || '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(priceRaw) || parseFloat(priceRaw) <= 0) { droppedNoPrice++; continue; }

    const key = productCode + '|' + prodBaseCode;
    if (!groups.has(key)) {
        groups.set(key, {
            Category: (c[idx.Category] || '').trim(),
            Segment: (c[idx.SubCategory] || '').trim(),
            'Product Name': product,
            'Product Code': productCode,
            'Base Code (SKU)': prodBaseCode,
            'Base / Colour Name': ((c[idx.BaseCode] || '').trim() + ' - ' + (c[idx.BaseName] || '').trim()),
            sizes: {},
        });
    }
    groups.get(key).sizes[sizeCol] = priceRaw;
    valuesPlaced++;
}

// Only emit size columns that actually appear, in canonical order.
const usedSizes = SIZE_COLS.filter(s => [...groups.values()].some(g => g.sizes[s] != null));
const outHeader = ['Category', 'Segment', 'Product Name', 'Product Code', 'Base Code (SKU)', 'Base / Colour Name', ...usedSizes];

const outLines = [outHeader.join(',')];
for (const g of groups.values()) {
    const row = [g.Category, g.Segment, g['Product Name'], g['Product Code'], g['Base Code (SKU)'], g['Base / Colour Name'],
        ...usedSizes.map(s => g.sizes[s] != null ? g.sizes[s] : '')];
    outLines.push(row.map(csvCell).join(','));
}
fs.writeFileSync(outPath, outLines.join('\n') + '\n', 'utf8');

console.log('=== CONVERSION ===');
console.log('input data rows (product+base+size):', dataRows);
console.log('wide rows (product+base groups):    ', groups.size);
console.log('price values placed:                ', valuesPlaced);
console.log('size columns used:                  ', usedSizes.join(', '));
if (droppedNoPrice) console.log('rows skipped (no/invalid price):   ', droppedNoPrice);
if (unknownUnits.size) console.log('!! UNKNOWN UNITS (data LOST):       ', [...unknownUnits].join(', '));

console.log('\n=== VERIFY with the REAL parser (parseBirlaOpusCsv) ===');
const buf = fs.readFileSync(outPath);
const parsed = parseBirlaOpusCsv(buf, '2026-06-03');
console.log('parsed rows:', parsed.length, '(expected ==', valuesPlaced, parsed.length === valuesPlaced ? 'OK)' : 'MISMATCH!)');
console.log('sample parsed rows (catalog-relevant fields):');
parsed.slice(0, 4).forEach(p => console.log('  ', JSON.stringify({
    productCode: p.productCode, baseCode: p.baseCode, colourName: p.colourName, packSize: p.packSize, dpl: p.dpl,
})));
