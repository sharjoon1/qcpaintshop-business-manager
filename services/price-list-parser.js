/**
 * Price List PDF Parser Service
 * Parses brand-specific dealer price list PDFs into a unified format:
 * { brand, product, packSize, dpl }
 *
 * Supported brands: Asian Paints, Berger, Birla Opus, Gem/Astral, JSW, Nippon
 */

const pdf = require('pdf-parse');

// ============ UNIFIED OUTPUT FORMAT ============
// Each parser returns: [{ brand, product, packSize, dpl, baseCode?, category? }]

// ============ BRAND DETECTION ============
function detectBrand(text, filename) {
    const fn = (filename || '').toUpperCase();
    const t = text.substring(0, 2000).toUpperCase();

    if (fn.includes('ASIAN') || t.includes('ASIAN PAINTS')) return 'asian';
    if (fn.includes('BERGER') && (fn.includes('NON XP') || fn.includes('NON-XP'))) return 'berger-nonxp';
    if (fn.includes('BERGER') && (fn.includes(' XP') || fn.includes('-XP'))) return 'berger-xp';
    if (fn.includes('BERGER')) return 'berger-nonxp'; // default berger
    if (fn.includes('BIRLAOPUS') || fn.includes('BIRLA') || t.includes('BIRLA OPUS') || t.includes('BIRLAOPUS')) return 'birlaopus';
    if (fn.includes('GEM') || t.includes('GEM ') || t.includes('ASTRAL')) return 'gem';
    if (fn.includes('JSW') || t.includes('JSW PAINTS')) return 'jsw';
    if (fn.includes('NIPPON') || t.includes('NIPPON')) return 'nippon';
    return 'unknown';
}

// ============ HELPERS ============
function cleanPrice(s) {
    if (!s || s === 'x' || s === '-' || s === '--' || s.trim() === '') return null;
    const cleaned = String(s).replace(/,/g, '').replace(/[^\d.]/g, '').trim();
    const num = parseFloat(cleaned);
    return (num > 0 && !isNaN(num)) ? num : null;
}

function normalizePackSize(size) {
    if (!size) return size;
    let s = String(size).trim().toLowerCase();
    // Normalize common patterns
    s = s.replace(/litres?|ltrs?|liter/gi, 'L')
         .replace(/\bml\b/gi, 'ml')
         .replace(/\bkg\b/gi, 'Kg')
         .replace(/\bgm\b/gi, 'gm')
         .replace(/\bno\b\.?/gi, 'No');
    // "0.050" → "50ml", "0.100" → "100ml", "0.200" → "200ml", "0.500" → "500ml"
    s = s.replace(/^0\.0*(\d+)\s*$/i, (_, d) => d + 'ml');
    return s;
}

// ============ ASIAN PAINTS PARSER ============
function parseAsian(text) {
    const results = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let currentProduct = '';
    let currentShadeGroup = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip headers and page markers
        if (line.includes('Internal Consolidated') || line.includes('Price List') ||
            line.includes('Checked by') || line.includes('Approved by') ||
            line.includes('Amit Syngle') || line.includes('NOT to be given') ||
            line.match(/^Page\s+\d/) || line.match(/^ProdProduct/) ||
            line.match(/^CodeCode/) || line === '___________________             .' ||
            line.includes('This Price List is for Internal Circulation')) continue;

        // Product name line: starts with 4-digit code + "ASIAN PAINTS"
        const productMatch = line.match(/^(\d{4})(ASIAN PAINTS .+)/);
        if (productMatch) {
            currentProduct = productMatch[2].trim();
            continue;
        }

        // Shade group line (text after product code)
        const shadeMatch = line.match(/^(\d{4})\s*$/);
        if (shadeMatch) continue; // just a code alone

        // Price line: code + pack info + price
        // Format: CODE SHADE_GROUP PACK_CODE \n PRICE
        // Or: CODE + PACK_CODE on same/next line + PRICE
        const packPriceMatch = line.match(/^(\d{4})(\d)(\d\.\d{3})(\d{2,3})\s*$/);
        if (packPriceMatch && currentProduct) {
            // e.g., "002610.050050" → prod=0026, shade_group=1, pack=0.050, pack_code=050
            const shadeGroup = packPriceMatch[2];
            const packLitres = parseFloat(packPriceMatch[3]);

            // Next line should be price
            if (i + 1 < lines.length) {
                const price = cleanPrice(lines[i + 1]);
                if (price) {
                    let packSize;
                    if (packLitres < 0.001) continue;
                    if (packLitres < 1) {
                        packSize = Math.round(packLitres * 1000) + 'ml';
                    } else {
                        packSize = packLitres + 'L';
                    }
                    results.push({
                        brand: 'Asian Paints',
                        product: currentProduct,
                        packSize: packSize,
                        dpl: price,
                        category: 'Shade Group ' + shadeGroup
                    });
                    i++; // skip price line
                }
            }
            continue;
        }

        // Alternative format: just price on its own (continuation)
        const priceOnly = line.match(/^(\d+\.\d{2})$/);
        if (priceOnly) continue; // already handled above

        // Shade description lines (colors listed)
        if (line.match(/^(Brilliant White|Blazing White|Ad\.|Imperial|Golden|Mint|Dawn|Deep|EB\s+\d)/)) {
            currentShadeGroup = line;
        }
    }

    return results;
}

// ============ BIRLA OPUS PARSER (cleanest format) ============
function parseBirlaOpus(text) {
    const results = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let currentProduct = '';
    let currentCategory = '';
    let sizeHeaders = []; // e.g., ['200 ML', '0.9L', '1L', '3.6L', '4L', '9L', '10L', '18L', '20L']

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip headers/footers
        if (line.includes('Grasim Industries') || line.includes('Nagda') ||
            line.includes('REGD. OFFICE') || line.includes('Applicable from') ||
            line.includes('Dealer') && line.includes('Price List') ||
            line.includes('Note:') || line.includes('E.g.,') ||
            line.includes('All samplers') || line.includes('*Available only')) continue;

        // Category header: "01", "02", "Interior Category", "Exterior Category"
        const catMatch = line.match(/^(\d{2})\s*$/) || line.match(/^(Interior|Exterior)\s+Category\s*$/i);
        if (catMatch) continue;

        // Sub-category: LUXURY, PREMIUM, ECONOMY etc.
        if (line.match(/^(LUXURY|PREMIUM|ECONOMY|STANDARD|ULTRA PREMIUM|SPECIALITY|DESIGNER|UNDERCOATS|OTHERS)\s*$/i)) {
            currentCategory = line.trim();
            continue;
        }

        // Product name line: "One Pure Elegance (941001)" or "Opus Protek (961001)"
        const prodMatch = line.match(/^(.+?)\s*\(\d{6}\)\s*(?:\*\s*)?$/);
        if (prodMatch) {
            currentProduct = prodMatch[1].trim();
            continue;
        }

        // Size header line: "Base Code/Name Prod - Base Code 200 ML 0.9L 1L 3.6L 4L 9L 10L 18L 20L"
        const headerMatch = line.match(/Base Code\/Name\s+Prod\s*-\s*Base Code\s+(.+)/);
        if (headerMatch) {
            sizeHeaders = headerMatch[1].trim().split(/\s+/).map(s => {
                // Merge "200 ML" into "200ML"
                return s;
            });
            // Re-parse: group "200" + "ML" together
            const raw = headerMatch[1].trim();
            sizeHeaders = [];
            const sizeTokens = raw.split(/\s+/);
            for (let j = 0; j < sizeTokens.length; j++) {
                if (sizeTokens[j] === 'ML' && j > 0) {
                    sizeHeaders[sizeHeaders.length - 1] += 'ml';
                } else {
                    sizeHeaders.push(sizeTokens[j]);
                }
            }
            continue;
        }

        // Data line: "9900 - White PE White   490  1,930  4,783  9,478"
        // Or: "9901 - Pastel PE 1 104  484  1,902  4,740  9,390"
        const dataMatch = line.match(/^(\d{4})\s*-\s*(.+?)\s+(PE[A-Z]*|DE|PR|SH|EX|OT|FL|WP|WD|UC|DN|VE|SE|CE|ME|HC|HB|GP|PG|PL|SP|DS|AC|TE|EP|SG|SM|GT|ST|PU|MR|AR|BR|IR|ER|CR|LR|OR)\s*(.+)$/);
        if (dataMatch && sizeHeaders.length > 0 && currentProduct) {
            const baseName = dataMatch[2].trim();
            const prodCode = dataMatch[3].trim();
            const rest = dataMatch[4].trim();

            // Parse the rest into base code suffix + prices
            // e.g., "White   490  1,930  4,783  9,478"
            // or "1 104  484  1,902  4,740  9,390"
            const tokens = rest.split(/\s+/);

            // First token is ALWAYS the base code suffix (e.g., "White", "1", "2", "99", "13")
            // Skip it — everything after is prices
            const priceStart = 1;

            const prices = tokens.slice(priceStart).map(t => cleanPrice(t)).filter(p => p > 0);

            // PDF text extraction loses column alignment — empty cells disappear.
            // Use price VALUE RANGES to determine pack size instead of column position.
            // Typical Birla Opus price ranges:
            //   200ml: 50-250, 1L: 250-1000, 4L: 1000-3500, 10L: 3500-13000, 20L: 6000-25000
            // Available sizes from header (for reference only, not used for positional mapping)
            const availableSizes = sizeHeaders.map(s => {
                if (s.match(/^\d+ml$/i)) return s;
                return s.includes('L') || s.includes('l') ? s : s + 'L';
            });
            const has200ml = availableSizes.some(s => /200ml/i.test(s));

            for (const price of prices) {
                let packSize;
                if (price < 250 && has200ml) {
                    packSize = '200ml';
                } else if (price >= 250 && price < 1000) {
                    // Could be 0.9L or 1L — prefer 1L if available in header
                    packSize = availableSizes.some(s => /^1L$/i.test(s)) ? '1L' : '0.9L';
                } else if (price >= 1000 && price < 3500) {
                    // Could be 3.6L or 4L — prefer 4L if available
                    packSize = availableSizes.some(s => /^4L$/i.test(s)) ? '4L' : '3.6L';
                } else if (price >= 3500 && price < 7000) {
                    // Could be 9L or 10L — prefer 10L if available
                    packSize = availableSizes.some(s => /^10L$/i.test(s)) ? '10L' : '9L';
                } else if (price >= 7000) {
                    // Could be 18L or 20L — prefer 20L if available
                    packSize = availableSizes.some(s => /^20L$/i.test(s)) ? '20L' : '18L';
                } else {
                    // Small price but no 200ml in header — treat as 1L
                    packSize = '1L';
                }

                results.push({
                    brand: 'Birla Opus',
                    product: currentProduct + ' - ' + baseName,
                    packSize: packSize,
                    dpl: price,
                    baseCode: dataMatch[1],
                    category: currentCategory
                });
            }
            continue;
        }
    }

    return results;
}

// ============ BERGER PARSER ============
function parseBerger(text, isXP) {
    const results = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const brandSuffix = isXP ? ' XP' : '';

    let currentSizeHeaders = [];
    let currentProducts = []; // product names collected after price data
    let priceRows = [];
    let currentCategory = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip headers
        if (line.includes('Decorative') || line.includes('DealerPrice') ||
            line.includes('With effect') || line.includes('28th Jun')) continue;

        // Size header line: "Code20lt10lt4lt1lt500ml" or "Code200ml100ml50ml"
        const sizeHeaderMatch = line.match(/^Code(.+)/);
        if (sizeHeaderMatch) {
            // Parse size columns from compressed header
            const sizeStr = sizeHeaderMatch[1];
            currentSizeHeaders = [];
            const sizeRegex = /(\d+(?:\.\d+)?)\s*(lt|ltr|kg|gm|ml|L)/gi;
            let m;
            while ((m = sizeRegex.exec(sizeStr)) !== null) {
                const val = parseFloat(m[1]);
                const unit = m[2].toLowerCase();
                if (unit === 'lt' || unit === 'ltr' || unit === 'l') {
                    currentSizeHeaders.push(val + 'L');
                } else if (unit === 'kg') {
                    currentSizeHeaders.push(val + 'Kg');
                } else if (unit === 'gm') {
                    currentSizeHeaders.push(val + 'gm');
                } else {
                    currentSizeHeaders.push(val + 'ml');
                }
            }
            // Reset price collection
            if (priceRows.length > 0 && currentProducts.length > 0) {
                assignBergerProducts(results, priceRows, currentProducts, currentSizeHeaders, brandSuffix, currentCategory);
            }
            priceRows = [];
            currentProducts = [];
            continue;
        }

        // Price data line: starts with code or comma-separated numbers
        // "4,4002,255935241125.50" or "0034,3352,230939245127.5"
        const priceLineMatch = line.match(/^([A-Z0-9]{2,4})?([\d,x.]+(?:[\d,x.]+)*)$/);
        if (priceLineMatch && currentSizeHeaders.length > 0) {
            const code = priceLineMatch[1] || '';
            const priceStr = priceLineMatch[2] || line;

            // Try to split prices - they're concatenated without spaces
            const prices = splitBergerPrices(priceStr, currentSizeHeaders.length);
            if (prices.length > 0) {
                priceRows.push({ code, prices });
            }
            continue;
        }

        // Product name lines (come after price blocks)
        if (line.match(/^(White|Black|Snow|Dazzling|Super|Light|Dark|Red|French|Mahogany|Group|Standard|Special|Interior|Exterior|Bison|Silk|Easy|Luxol|Butterfly|BP\s|Gold|Silver)/i) ||
            line.match(/^[A-Z][a-z]/) || line.match(/^[A-Z][A-Z].*[a-z]/)) {
            currentProducts.push(line);
        }
    }

    return results;
}

function splitBergerPrices(str, expectedCount) {
    // Berger concatenates prices without separator
    // e.g., "4,4002,255935241125.50" → [4400, 2255, 935, 241, 125.50]
    const prices = [];
    let remaining = str;

    // Try splitting by comma-number patterns
    // Prices > 999 have commas: "4,400" "2,255" etc.
    // Prices < 1000 don't: "935" "241"
    const parts = remaining.split(/(?<=\d)(?=\d{4,})|(?<=\.\d{1,2})(?=\d)/);

    // Alternative: use regex to find price patterns
    const priceRegex = /(\d{1,2},\d{3}(?:\.\d{1,2})?|\d{1,4}(?:\.\d{1,2})?|x)/g;
    let m;
    while ((m = priceRegex.exec(str)) !== null) {
        prices.push(cleanPrice(m[1]));
    }

    return prices;
}

function assignBergerProducts(results, priceRows, products, sizeHeaders, brandSuffix, category) {
    // Berger format: price rows correspond to products listed after them
    // Simple mapping: each price row = one product variant
    for (let r = 0; r < priceRows.length; r++) {
        const row = priceRows[r];
        const productName = r < products.length ? products[r] : (products[0] || 'Unknown');

        for (let s = 0; s < Math.min(row.prices.length, sizeHeaders.length); s++) {
            if (row.prices[s]) {
                results.push({
                    brand: 'Berger' + brandSuffix,
                    product: productName,
                    packSize: sizeHeaders[s],
                    dpl: row.prices[s],
                    baseCode: row.code,
                    category: category
                });
            }
        }
    }
}

// ============ GEM/ASTRAL PARSER ============
function parseGem(text) {
    const results = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let currentProduct = '';
    let currentSizes = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip T&C, headers
        if (line.includes('T & C') || line.includes('TERMS AND') || line.includes('STANDARD CARTON') ||
            line.includes('w.e.f') || line.includes('DECORATIVE') || line.includes('Dealer\'s Price') ||
            line.includes('Prices ruling') || line.includes('The prices quoted') ||
            line.includes('The company') || line.includes('By placing') ||
            line.match(/^\d+\.\s/) || line.includes('INTERIOR EMULSIONS') ||
            line.includes('EXTERIOR EMULSIONS') || line.includes('ICE LIST') ||
            line.includes('DEALERS')) continue;

        // Product header: "20 LGem Elita Luxury" or "20 LGemlite"
        const prodMatch = line.match(/^(\d+)\s*L(.+)/);
        if (prodMatch) {
            const mainSize = prodMatch[1] + 'L';
            currentProduct = prodMatch[2].trim();
            continue;
        }

        // Size header line: "10 L4 L1 L" or "19.5 L9.75 L3.9 L975 ml"
        const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:L|ml)/g);
        if (sizeMatch && sizeMatch.length >= 2 && !line.match(/^\d{3,}/)) {
            currentSizes = sizeMatch.map(s => {
                const m = s.match(/(\d+(?:\.\d+)?)\s*(L|ml)/i);
                return m ? m[1] + m[2] : s;
            });
            continue;
        }

        // Price/data line: "Super White/EL Base 039478" or "EL - Base 05919446401872475"
        const dataMatch = line.match(/^(Super White|.+?(?:Base|White|Classic|Group)\s*\d*)\s*([\d]+)$/);
        if (dataMatch && currentProduct) {
            // The numbers are concatenated prices for the sizes
            const priceStr = dataMatch[2];
            const variant = dataMatch[1].trim();

            // Try to extract prices — they're concatenated
            // For Gem, typically: 20L(5dig) 10L(4-5dig) 4L(3-4dig) 1L(3dig)
            const prices = extractGemPrices(priceStr);

            const sizes = ['20L', '10L', '4L', '1L']; // Default sizes for main line
            for (let j = 0; j < Math.min(prices.length, sizes.length); j++) {
                if (prices[j]) {
                    results.push({
                        brand: 'Gem (Astral)',
                        product: currentProduct,
                        packSize: sizes[j],
                        dpl: prices[j],
                        category: variant
                    });
                }
            }
            continue;
        }
    }

    return results;
}

function extractGemPrices(str) {
    // Gem prices are concatenated: "039478" could be "0 3947 8" or "03 9478"
    // Typically: 5-digit 4-digit 3-4digit 3digit pattern
    const prices = [];

    // Try common patterns for 20L/10L/4L/1L
    // 20L: 3000-15000 (4-5 digits)
    // 10L: 1500-8000 (4 digits)
    // 4L: 600-3500 (3-4 digits)
    // 1L: 150-1000 (3 digits)

    if (str.length >= 4) {
        // Just store raw for now — too complex to reliably split without structure
        // Better to use the line-by-line approach
    }

    return prices;
}

// ============ JSW PARSER ============
function parseJSW(text) {
    const results = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let currentCategory = '';

    // JSW has a clear structure:
    // CATEGORY\nVARIANT SIZE1 SIZE2 SIZE3 SIZE4 SIZE5
    // The sizes are: 250ML, 1L, 4L, 10L, 20L (or 0.65L, 3.25L, 6.5L, 13L for distemper)

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip headers
        if (line.includes('RETAILER PRICE LIST') || line.includes('Effective from') ||
            line.includes('Eective') || line.includes('PRICE / PACK') ||
            line.includes('Distemper equivalent') || line.includes('All Colours') ||
            line.includes('available in') || line.includes('WALL FINISHES') ||
            line.includes('White &')) continue;

        // Category line
        if (line.match(/^(MAJESTIC|REGAL|ELEGANT|LONGLASTING|CLASSIC|MEGA|GOOD BYE)/)) {
            if (line.includes('INTERIORS')) currentCategory = line.replace(/\s+/g, ' ');
            else if (line.includes('EXTERIORS')) currentCategory = line.replace(/\s+/g, ' ');
            else currentCategory = line;
            continue;
        }

        // Product line with prices: "LUXGLO –              540                2100                5200              10300"
        const prodPriceMatch = line.match(/^([A-Z][A-Z\s]+?)\s+(\d[\d\s–\-]+)$/);
        if (prodPriceMatch) {
            const variant = prodPriceMatch[1].trim();
            const priceStr = prodPriceMatch[2].trim();
            const prices = priceStr.split(/\s+/).map(p => p === '–' || p === '-' ? null : cleanPrice(p)).filter((_, idx) => true);

            // Map to standard sizes: 250ML, 1L, 4L, 10L, 20L
            const sizes = ['250ml', '1L', '4L', '10L', '20L'];
            let priceIdx = 0;
            for (let s = 0; s < sizes.length && priceIdx < prices.length; s++) {
                if (prices[priceIdx] !== null && prices[priceIdx] !== undefined) {
                    results.push({
                        brand: 'JSW Paints',
                        product: (currentCategory ? currentCategory + ' ' : '') + variant,
                        packSize: sizes[s],
                        dpl: prices[priceIdx],
                        category: currentCategory
                    });
                }
                priceIdx++;
            }
            continue;
        }

        // Single variant line with inline prices
        const simpleMatch = line.match(/^([A-Z]+)\s+([\d\s]+)$/);
        if (simpleMatch && currentCategory) {
            const variant = simpleMatch[1].trim();
            const nums = simpleMatch[2].trim().split(/\s+/).map(cleanPrice);
            const sizes = ['250ml', '1L', '4L', '10L', '20L'];
            let pi = 0;
            for (let s = 0; s < sizes.length && pi < nums.length; s++) {
                if (nums[pi]) {
                    results.push({
                        brand: 'JSW Paints',
                        product: (currentCategory ? currentCategory + ' ' : '') + variant,
                        packSize: sizes[s],
                        dpl: nums[pi],
                        category: currentCategory
                    });
                }
                pi++;
            }
        }
    }

    return results;
}

// ============ NIPPON PARSER ============
function parseNippon(text) {
    const results = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let currentCategory = '';
    let currentProduct = '';
    let currentSizes = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip headers/footers
        if (line.includes('Dealer Price List') || line.includes('International quality') ||
            line.includes('with effect from') || line.includes('DNP W.E.F') ||
            line.includes('ALL INDIA DEALER')) continue;

        // Category line
        if (line.match(/^CATEGORY\s+PRODUCT/)) continue;
        if (line.match(/^(INTERIOR EMULSION|EXTERIOR EMULSION|DESIGNER FINISH|WOOD FINISH|METAL FINISH|UNDERCOAT|DISTEMPER|PUTTY|PRIMER|FLOOR COAT|WATERPROOFING|CONSTRUCTION)/i)) {
            currentCategory = line.trim();
            continue;
        }

        // Product name with sizes: "MOMENTO ELEGANT900 ml"
        // Or: "SATINGLO PRIME20 Ltrs.10 Ltrs.4 Ltrs.1 Ltr."
        const prodSizeMatch = line.match(/^([A-Z][A-Za-z\s\+\(\)]+?)(\d+(?:\.\d+)?\s*(?:Ltrs?\.?|ml|Kg|gm|No\.)(?:\s*\d+(?:\.\d+)?\s*(?:Ltrs?\.?|ml|Kg|gm|No\.))*)\s*$/);
        if (prodSizeMatch) {
            currentProduct = prodSizeMatch[1].trim();
            const sizeStr = prodSizeMatch[2];
            currentSizes = [];
            const sizeRegex = /(\d+(?:\.\d+)?)\s*(Ltrs?\.?|ml|Kg|gm|No\.)/gi;
            let m;
            while ((m = sizeRegex.exec(sizeStr)) !== null) {
                const val = parseFloat(m[1]);
                const unit = m[2].toLowerCase().replace(/\./g, '');
                if (unit.startsWith('ltr') || unit === 'l') {
                    currentSizes.push(val + 'L');
                } else if (unit === 'ml') {
                    currentSizes.push(val + 'ml');
                } else if (unit === 'kg') {
                    currentSizes.push(val + 'Kg');
                } else {
                    currentSizes.push(val + unit);
                }
            }
            continue;
        }

        // Size-only line: "20 Ltrs.10 Ltrs.4 Ltrs.1 Ltr."
        const sizeOnlyMatch = line.match(/^(\d+(?:\.\d+)?\s*(?:Ltrs?\.?|ml|Kg|gm)(?:\s*\d+(?:\.\d+)?\s*(?:Ltrs?\.?|ml|Kg|gm))*)\s*$/);
        if (sizeOnlyMatch && !line.match(/^\d+$/)) {
            const sizeStr = sizeOnlyMatch[1];
            currentSizes = [];
            const sizeRegex = /(\d+(?:\.\d+)?)\s*(Ltrs?\.?|ml|Kg|gm)/gi;
            let m;
            while ((m = sizeRegex.exec(sizeStr)) !== null) {
                const val = parseFloat(m[1]);
                const unit = m[2].toLowerCase().replace(/\./g, '');
                if (unit.startsWith('ltr') || unit === 'l') {
                    currentSizes.push(val + 'L');
                } else if (unit === 'ml') {
                    currentSizes.push(val + 'ml');
                } else if (unit === 'kg') {
                    currentSizes.push(val + 'Kg');
                } else {
                    currentSizes.push(val + unit);
                }
            }
            continue;
        }

        // Price/variant line: "White1109057702396618134" or "B31034054632275601"
        // variant name + concatenated prices
        const priceMatch = line.match(/^([A-Za-z\s\/\(\)]+?)(\d{3,})$/);
        if (priceMatch && currentProduct && currentSizes.length > 0) {
            const variant = priceMatch[1].trim();
            const priceStr = priceMatch[2];

            // Split concatenated prices by expected count
            const prices = splitNipponPrices(priceStr, currentSizes.length);

            for (let j = 0; j < Math.min(prices.length, currentSizes.length); j++) {
                if (prices[j]) {
                    results.push({
                        brand: 'Nippon',
                        product: currentProduct + (variant && variant !== 'White' ? ' ' + variant : ''),
                        packSize: currentSizes[j],
                        dpl: prices[j],
                        category: currentCategory
                    });
                }
            }
            continue;
        }

        // Garbled text lines (unicode issues in PDF) — skip
        if (line.match(/[ĂĞŚ]/)) continue;
    }

    return results;
}

function splitNipponPrices(str, expectedCount) {
    const prices = [];

    // Nippon prices pattern: 20L(4-5 digits), 10L(4-5 digits), 4L(3-4 digits), 1L(3 digits), 200ml(2-3 digits)
    // Example: "1109057702396618134" for sizes [20L, 10L, 4L, 1L, 200ml]
    // = 11090, 5770, 2396, 618, 134

    // Strategy: work backwards from expected size prices
    // 200ml: 2-3 digits, 1L: 3 digits, 4L: 3-4 digits, 10L: 4 digits, 20L: 4-5 digits
    const digitPatterns = {
        5: [5, 4, 4, 3, 3],      // 20L,10L,4L,1L,200ml
        4: [5, 4, 4, 3],          // 20L,10L,4L,1L
        3: [4, 4, 3],             // 4L,1L,200ml or 10L,4L,1L
        2: [4, 3],                // 4L,1L
        1: [3]                    // single
    };

    const patterns = digitPatterns[expectedCount];
    if (!patterns) return prices;

    // Try to split using expected digit counts
    let pos = 0;
    for (let p = 0; p < patterns.length; p++) {
        const digits = patterns[p];
        if (pos + digits <= str.length) {
            const chunk = str.substring(pos, pos + digits);
            prices.push(cleanPrice(chunk));
            pos += digits;
        } else if (pos < str.length) {
            // Take remaining
            prices.push(cleanPrice(str.substring(pos)));
            pos = str.length;
        }
    }

    // If leftover, the split was wrong — try alternative
    if (pos < str.length && str.length - pos <= 3) {
        // Probably a small price at the end
        prices.push(cleanPrice(str.substring(pos)));
    }

    return prices;
}

// ============ MAIN PARSER ============
async function parsePriceList(pdfBuffer, filename) {
    const data = await pdf(pdfBuffer);
    const text = data.text;
    const brand = detectBrand(text, filename);

    let items = [];
    let parserUsed = brand;

    switch (brand) {
        case 'asian':
            items = parseAsian(text);
            break;
        case 'birlaopus':
            items = parseBirlaOpus(text);
            break;
        case 'berger-nonxp':
            items = parseBerger(text, false);
            parserUsed = 'berger';
            break;
        case 'berger-xp':
            items = parseBerger(text, true);
            parserUsed = 'berger';
            break;
        case 'gem':
            items = parseGem(text);
            break;
        case 'jsw':
            items = parseJSW(text);
            break;
        case 'nippon':
            items = parseNippon(text);
            break;
        default:
            throw new Error('Unknown brand format. Supported: Asian, Berger, Birla Opus, Gem/Astral, JSW, Nippon');
    }

    return {
        brand: brand,
        parser: parserUsed,
        pages: data.numpages,
        totalExtracted: items.length,
        items: items
    };
}

// ============ MATCH WITH ZOHO ITEMS ============
function matchWithZohoItems(parsedItems, zohoItems) {
    const matched = [];
    const unmatched = [];

    // Build lookup maps for Zoho items
    // Zoho items use abbreviated names like "OP01 CF13 STYLE COLOR FRESH OPUS 01 L"
    // PDF items use full names like "One Pure Elegance - White"
    const zohoByName = new Map(); // uppercase name → zoho item
    const zohoByWords = []; // for fuzzy word matching

    zohoItems.forEach(zi => {
        const name = (zi.name || zi.zoho_item_name || '').toUpperCase().trim();
        if (name) {
            zohoByName.set(name, zi);
            zohoByWords.push({ words: name.split(/\s+/), item: zi, name });
        }
    });

    // Build keyword map from parsed product names
    for (const parsed of parsedItems) {
        const productName = parsed.product.toUpperCase().trim();
        const packSize = (parsed.packSize || '').toUpperCase().replace(/\s+/g, '');

        // Normalize pack size for matching: "4L" → "04 L", "500ml" → "500 ML", "1L" → "01 L"
        const sizePatterns = normalizeSizeForMatch(parsed.packSize);

        // Strategy 1: Exact full name match
        let match = zohoByName.get(productName);

        // Strategy 2: Match by significant keywords + size
        if (!match) {
            // Extract significant keywords from product name (skip common words)
            const keywords = extractKeywords(productName);

            let bestScore = 0;
            let bestMatch = null;

            for (const entry of zohoByWords) {
                // Check if pack size matches in the Zoho name
                const hasSize = sizePatterns.some(sp => entry.name.includes(sp));
                if (!hasSize && sizePatterns.length > 0) continue;

                // Count matching keywords
                let score = 0;
                for (const kw of keywords) {
                    if (entry.name.includes(kw)) score++;
                }

                // Require at least 2 keyword matches (or 1 if product name is short)
                const minRequired = keywords.length <= 2 ? 1 : 2;
                if (score >= minRequired && score > bestScore) {
                    bestScore = score;
                    bestMatch = entry.item;
                }
            }

            if (bestMatch && bestScore >= 2) {
                match = bestMatch;
            }
        }

        if (match) {
            matched.push({
                ...parsed,
                zoho_item_id: match.zoho_item_id || match.item_id,
                zoho_item_name: match.name || match.zoho_item_name,
                currentDpl: match.cf_dpl || match.zoho_cf_dpl,
                currentRate: match.rate
            });
        } else {
            unmatched.push(parsed);
        }
    }

    // Deduplicate: keep only the best match per zoho_item_id (prefer White/standard shades)
    const bestByZohoId = new Map();
    const dedupMatched = [];
    const demotedToUnmatched = [];

    for (const m of matched) {
        const zid = m.zoho_item_id;
        const existing = bestByZohoId.get(zid);
        if (!existing) {
            bestByZohoId.set(zid, m);
        } else {
            // Prefer White/Super White variants over colored ones
            const isWhite = /white|super\s*white/i.test(m.product);
            const existingIsWhite = /white|super\s*white/i.test(existing.product);
            if (isWhite && !existingIsWhite) {
                demotedToUnmatched.push(existing);
                bestByZohoId.set(zid, m);
            } else {
                demotedToUnmatched.push(m);
            }
        }
    }

    bestByZohoId.forEach(m => dedupMatched.push(m));

    return {
        matched: dedupMatched,
        unmatched: [...unmatched, ...demotedToUnmatched]
    };
}

function normalizeSizeForMatch(packSize) {
    if (!packSize) return [];
    const s = packSize.toUpperCase().replace(/\s+/g, '');
    const patterns = [];

    // "4L" → ["04 L", "4 L", "04L", "4L", "4 LT", "04 LT"]
    const litreMatch = s.match(/^(\d+(?:\.\d+)?)\s*L$/i);
    if (litreMatch) {
        const val = litreMatch[1];
        const padded = val.length === 1 ? '0' + val : val;
        patterns.push(padded + ' L', val + ' L', padded + 'L', val + 'L', val + ' LT', padded + ' LT');
    }

    // "500ml" → ["500 ML", "500ML"]
    const mlMatch = s.match(/^(\d+)\s*ML$/i);
    if (mlMatch) {
        patterns.push(mlMatch[1] + ' ML', mlMatch[1] + 'ML');
    }

    // "20Kg" → ["20KG", "20 KG"]
    const kgMatch = s.match(/^(\d+(?:\.\d+)?)\s*KG$/i);
    if (kgMatch) {
        patterns.push(kgMatch[1] + 'KG', kgMatch[1] + ' KG');
    }

    return patterns;
}

function extractKeywords(name) {
    const stopWords = new Set(['THE', 'AND', 'FOR', 'WITH', 'FROM', 'THAT', 'YOUR', 'ALL',
        'PAINTS', 'PAINT', 'BRAND', 'BASE', 'CODE', 'GROUP', '-', 'IN', 'OF', 'A', 'AN']);
    return name.split(/[\s\-()]+/)
        .filter(w => w.length >= 2 && !stopWords.has(w) && !w.match(/^\d+$/))
        .map(w => w.toUpperCase());
}

module.exports = {
    parsePriceList,
    matchWithZohoItems,
    detectBrand,
    // Export individual parsers for testing
    parseAsian,
    parseBirlaOpus,
    parseBerger,
    parseGem,
    parseJSW,
    parseNippon
};
