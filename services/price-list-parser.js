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
    let currentMainCategory = ''; // e.g. "Interior Emulsions", "Exterior Emulsions", "Enamel"
    let currentSubCategory  = ''; // e.g. "PREMIUM", "LUXURY", "ECONOMY"
    let sizeHeaders = []; // e.g., ['200 ML', '0.9L', '1L', '3.6L', '4L', '9L', '10L', '18L', '20L']
    let expectMainCat = false;   // true right after a section-number line

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip headers/footers
        if (line.includes('Grasim Industries') || line.includes('Nagda') ||
            line.includes('REGD. OFFICE') || line.includes('Applicable from') ||
            line.includes('Dealer') && line.includes('Price List') ||
            line.includes('Note:') || line.includes('E.g.,') ||
            line.includes('All samplers') || line.includes('*Available only')) continue;

        // Section number: "01", "02", … signals that the next content line is the main category
        if (line.match(/^(\d{2})\s*$/)) { expectMainCat = true; continue; }

        // Sub-category tier: LUXURY, PREMIUM, ECONOMY etc.
        if (line.match(/^(LUXURY|PREMIUM|ECONOMY|STANDARD|ULTRA\s+PREMIUM|SPECIALITY|DESIGNER|UNDERCOATS|OTHERS|SUPER\s+PREMIUM|ECONOMY\s+PLUS)\s*$/i)) {
            currentSubCategory = line.trim().toUpperCase();
            expectMainCat = false;
            continue;
        }

        // Main category line (immediately after a section number)
        if (expectMainCat) {
            currentMainCategory = line.trim();
            currentSubCategory  = '';
            expectMainCat = false;
            continue;
        }

        // Legacy "Interior/Exterior Category" header — treat as main category reset
        if (line.match(/^(Interior|Exterior)\s+Category\s*$/i)) {
            currentMainCategory = line.trim();
            currentSubCategory  = '';
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
        // Or (other products): "9900 - White SDB White 490 1,930..." — allow any 2-5 uppercase code.
        const dataMatch = line.match(/^(\d{4})\s*-\s*(.+?)\s+([A-Z]{2,5})\s+(.+)$/);
        // Skip data rows that belong to an "Annexure" section — these contain
        // colorant/tint prices which are not the main 1L/4L/10L/20L SKU prices.
        const isAnnexureSection = /^ANNEXURE\b/i.test(currentProduct);
        if (dataMatch && sizeHeaders.length > 0 && currentProduct && !isAnnexureSection) {
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
            // Don't guess pack size here. Emit a single group with all row prices and
            // let the matcher use Zoho's actual SKUs/rates as ground truth to assign
            // prices to sizes by ascending rate-ratio.
            if (prices.length > 0) {
                const fullCat = currentMainCategory
                    ? (currentSubCategory ? currentMainCategory + ' - ' + currentSubCategory : currentMainCategory)
                    : currentSubCategory;
                results.push({
                    brand: 'Birla Opus',
                    product: currentProduct + ' - ' + baseName,
                    _prices: prices,
                    baseCode: dataMatch[1],
                    category: fullCat
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

// ============ SKU STRUCTURE PARSER ============
// Our naming convention for emulsion products (e.g., Birla Opus):
//   SKU prefix: "EC101" = EC (product abbrev: EverClear) + 1 (base number) + 01 (pack size code)
//   Full SKU:   "EC101 EVER CLEAR BIRLA OPUS 01 L"
// Pack size code: 01=1L, 04=4L, 09=9L, 10=10L, 18=18L, 20=20L, 2M=200ml, etc.
function parseSkuStructure(skuOrName) {
    if (!skuOrName) return null;
    const firstTok = String(skuOrName).trim().split(/\s+/)[0] || '';
    // Primary pattern: 2-3 letters + base digit + 2-digit pack code (e.g., EC101, CS204, OPE301)
    const m1 = firstTok.match(/^([A-Z]{2,3})(\d)(\d{2})$/);
    if (m1) return { abbrev: m1[1], base: m1[2], packCode: m1[3], raw: firstTok };
    // Alt pattern: 2 letters + 2-digit pack (no base, for non-tinted products)
    const m2 = firstTok.match(/^([A-Z]{2,4})(\d{2})$/);
    if (m2) return { abbrev: m2[1], base: null, packCode: m2[2], raw: firstTok };
    return null;
}

// Clean a Zoho item name: strip the leading SKU-like token, brand noise, pack numerals,
// and unit tokens — leaving just the product name words for abbrev extraction.
// "OP05 STYLE SUPER BRIGHT DISTEMPER BIRLA OPUS 05 L" → "STYLE SUPER BRIGHT DISTEMPER"
// "OP01 ODE99 ONE DREAM EFFECT 01 L" → "ONE DREAM EFFECT"
function cleanZohoName(name) {
    const noiseWords = new Set([
        'BIRLA', 'OPUS', 'ASIAN', 'PAINTS', 'PAINT', 'BERGER', 'NIPPON',
        'GEM', 'ASTRAL', 'JSW', 'LIMITED', 'LTD', 'PRIVATE', 'PVT', 'L', 'ML', 'KG', 'GM', 'NO'
    ]);
    const tokens = String(name || '').toUpperCase().trim().split(/\s+/);
    const kept = [];
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        // Drop up to first 2 leading SKU-like tokens (e.g., "OP05" or "OP01 ODE99")
        if (kept.length === 0 && i < 2 && /^[A-Z]{1,4}\d{1,5}[A-Z]*$/.test(tok)) continue;
        if (kept.length === 0 && /^[A-Z]{2,6}WT$/.test(tok)) continue; // drop WT-base SKU prefix (e.g. "ECWT" after "ECWT01")
        if (noiseWords.has(tok)) continue;
        if (/^\d+(?:\.\d+)?$/.test(tok)) continue;         // pure numeric (pack sizes)
        if (/^\d+ML$/.test(tok)) continue;                  // "200ML"
        if (/^\d+L$/.test(tok)) continue;                   // "5L"
        if (/^\d+KG$/.test(tok)) continue;                  // "20KG"
        kept.push(tok);
    }
    return kept.join(' ');
}

// Extract a pack code from a Zoho item: try SKU parse first, then look for size tokens in name.
function extractZohoPackCode(zi) {
    const skuText = (zi.sku || zi.zoho_sku || '').toUpperCase();
    const nameText = (zi.name || zi.zoho_item_name || '').toUpperCase();
    // Try parsing all space-separated tokens of SKU+name
    const allTokens = (skuText + ' ' + nameText).split(/\s+/);
    for (const tok of allTokens) {
        const s = parseSkuStructure(tok);
        if (s && s.packCode) return s.packCode;
    }
    // Fallback: find explicit size in name: "... 200 ML", "... 10 L", "... 01 L"
    const mlMatch = nameText.match(/\b(\d{2,4})\s*ML\b/);
    if (mlMatch) return packSizeToCode(mlMatch[1] + 'ml');
    const lMatch = nameText.match(/\b(\d{1,2}(?:\.\d+)?)\s*L\b/);
    if (lMatch) return packSizeToCode(lMatch[1] + 'L');
    return null;
}

// Convert a pack code like "01", "04", "20", "10M" to ml value for sorting/compare.
// packSizeToCode encodes ml as substr(0,2)+"M" (200ml→"20M", 100ml→"10M"). Reverse: ×10.
function packCodeToMl(pc) {
    if (!pc) return 0;
    const s = String(pc).toUpperCase();
    const mlMatch = s.match(/^(\d+)M$/);
    if (mlMatch) return parseInt(mlMatch[1], 10) * 10;  // 20M → 200ml, 10M → 100ml
    const lMatch = s.match(/^(\d+)$/);
    if (lMatch) return parseInt(lMatch[1], 10) * 1000;  // 20 → 20000ml, 04 → 4000ml, 09 → 9000ml
    return 0;
}

// Reverse of packSizeToCode — for display in matched output.
function packCodeToSize(pc) {
    if (!pc) return '?';
    const s = String(pc).toUpperCase();
    const mlMatch = s.match(/^(\d+)M$/);
    if (mlMatch) return (parseInt(mlMatch[1], 10) * 10) + 'ml';   // 20M → 200ml
    const lMatch = s.match(/^(\d+)$/);
    if (lMatch) return parseInt(lMatch[1], 10) + 'L';             // 01 → 1L, 20 → 20L
    return s;
}

// Format pack size for canonical display in item names: "4L"→"04 L", "500ml"→"500 ML", "20Kg"→"20 KG"
function formatPackDisplay(packSize) {
    const s = String(packSize || '').toUpperCase().replace(/\s+/g, '');
    const ml = s.match(/^(\d+(?:\.\d+)?)ML$/);
    if (ml) return ml[1] + ' ML';
    const lt = s.match(/^(\d+(?:\.\d+)?)(L|LT|LTR|LITRE|LITER|LITRES)?$/);
    if (lt) {
        const n = parseFloat(lt[1]);
        const int = Math.floor(n);
        return (int < 10 ? '0' + int : String(int)) + ' L';
    }
    const kg = s.match(/^(\d+(?:\.\d+)?)KG$/);
    if (kg) {
        const n = parseFloat(kg[1]);
        const int = Math.floor(n);
        return (int < 10 ? '0' + int : String(int)) + ' KG';
    }
    return packSize;
}

// Extract leading alphabetic prefix from a SKU: "PFP04"→"PFP", "CSTBLK01"→"CSTBLK", "PE04"→"PE"
function extractSkuPrefix(sku) {
    const m = String(sku || '').toUpperCase().match(/^([A-Z]+)/);
    return m ? m[1] : null;
}

const BRAND_DISPLAY_NAMES = {
    birlaopus: 'BIRLA OPUS',
    'berger-xp': 'BERGER PAINTS',
    'berger-nonxp': 'BERGER PAINTS',
    asian: 'ASIAN PAINTS',
    nippon: 'NIPPON PAINT',
    jsw: 'JSW PAINTS',
    gem: 'GEM PAINTS'
};

// Map normalized brand name to internal brand key
function brandKeyFromName(brandName) {
    const n = normalizeBrand(brandName);
    if (n.includes('BIRLA') || n === 'OPUS' || n === 'BIRLAOPUS') return 'birlaopus';
    if (n.includes('BERGER') && (n.includes('XP') || n.includes('EXPRESSPAINTS'))) return 'berger-xp';
    if (n.includes('BERGER')) return 'berger-nonxp';
    if (n.includes('ASIAN')) return 'asian';
    if (n.includes('NIPPON')) return 'nippon';
    if (n.includes('JSW')) return 'jsw';
    if (n.includes('GEM') || n.includes('ASTRAL')) return 'gem';
    return null;
}

// Strip trailing pack-code suffix from a SKU for use as a description prefix.
// Real Birla Opus SKUs end with one of:
//   - 2 digits: ESWT01, PE204
//   - 3 digits: CME500, CST200
//   - 2-3 digits + ML/KG/L: CSTSBK500ML, AWPUEM01L
//   - 3 digits + color tag: CST200BGN, CST200GYL (treat the 3-digit part as pack code; let color stay)
// We try patterns longest-first; whichever matches strips the pack code.
// If nothing matches we return the SKU unchanged.
function stripPackSuffixForDescription(sku) {
    if (!sku) return sku;
    const s = String(sku).toUpperCase();
    const patterns = [
        /^(.+?)\d{2,3}(?:ML|KG)$/,       // CSTSBK500ML, AWPUEM01L (with ML/KG)
        /^(.+?)\d{2,3}L$/,                 // AWPUEM01L (with single L)
        /^(.+?)\d{3}[A-Z]{2,3}$/,          // CST200BGN — 3 digits then color tag
        /^(.+?)\d{3}$/,                    // CME500
        /^(.+?)\d{2}$/,                    // ESWT01, PE204
    ];
    for (const p of patterns) {
        const m = s.match(p);
        if (m && m[1] && m[1].length >= 2) return m[1];
    }
    return s;
}

// Compute proposed Name / SKU / Description / Rate based on brand naming rules.
// Selling Price rule (all brands): ceil(DPL × 1.18 × 1.10)
// Birla Opus name rule: [ABBREV+PACKCODE] PRODUCT BIRLA OPUS PACK_FORMATTED
function computeProposedFields(pdfItem, zohoItem, brandKey) {
    const dpl = parseFloat(pdfItem.dpl || 0);
    const proposedRate = dpl > 0 ? Math.ceil(dpl * 1.18 * 1.10) : null;

    const currentSku  = String(zohoItem.sku  || '').trim();
    const currentDesc = String(zohoItem.description || '').trim();
    const currentCat  = String(zohoItem.category || '').toUpperCase().trim();

    const base = { proposed_rate: proposedRate, current_sku: currentSku, current_description: currentDesc };

    if (brandKey !== 'birlaopus') return base;

    const skuUpper = currentSku.toUpperCase();
    // Preserve the Zoho SKU verbatim — it's the source of truth.
    // (Auto-deriving from prefix+packCode broke ml-pack SKUs and was unwanted.)
    const proposedSku = skuUpper;
    // Derive a name-prefix by stripping any trailing pack-code suffix.
    // Used only for `proposedDescription`. Pack codes seen in real SKUs:
    //   2 digits (01, 04, 20), 3 digits (500, 200, 100), trailing ML/KG, or color-suffixed.
    const skuPrefix = stripPackSuffixForDescription(skuUpper);
    // Normalize near-equivalent pack sizes (0.9L→1L, 9L→10L…) before encoding
    const normPack  = normalizeBirlaPackSize(pdfItem.packSize);
    const packCode  = packSizeToCode(normPack);
    if (!skuPrefix || !packCode) return base;

    const packFormatted = formatPackDisplay(normPack);
    // Use the resolved Zoho category if present, else fall back to PDF category.
    const categoryForRouting = (zohoItem.category || zohoItem.zoho_category_name || pdfItem.category || '').toString();

    const proposedName = buildBirlaName({
        sku: proposedSku,
        pdfProduct: pdfItem.product,
        category: categoryForRouting,
        packFormatted,
    });

    if (!proposedName) return base;

    const brandDisplay        = BRAND_DISPLAY_NAMES[brandKey] || 'BIRLA OPUS';
    const proposedDescription = `${skuPrefix} ${currentCat} ${brandDisplay} ${packFormatted}`.replace(/\s+/g, ' ').trim();

    return { ...base, proposed_name: proposedName, proposed_sku: proposedSku, proposed_description: proposedDescription };
}

// Normalize a PDF pack-size string to our 2-char pack code.
// "1L" → "01", "4L" → "04", "0.9L" → "09" (treated as 0.9 → 0.9), "200ml" → "2M", "20L" → "20"
function packSizeToCode(sz) {
    if (!sz) return null;
    const s = String(sz).toUpperCase().trim().replace(/\s+/g, '');
    const ml = s.match(/^(\d+(?:\.\d+)?)ML$/);
    if (ml) return (ml[1].replace('.', '')).substr(0, 2) + 'M';
    const lt = s.match(/^(\d+(?:\.\d+)?)(?:L|LT|LTR|LITRE|LITER|LITRES)?$/);
    if (lt) {
        const n = parseFloat(lt[1]);
        if (n < 1) return '0' + Math.round(n * 10); // 0.9 → 09
        const int = Math.floor(n);
        return int < 10 ? '0' + int : String(int);
    }
    const kg = s.match(/^(\d+(?:\.\d+)?)KG$/);
    if (kg) {
        const n = parseFloat(kg[1]);
        return (n < 10 ? '0' + Math.floor(n) : String(Math.floor(n)));
    }
    return null;
}

// Extract product abbreviation from a PDF product name.
// Strategy: split by " - " into parts; pick the part with the most significant words
// (this naturally skips metadata like "Annexure" or trailing base like "White").
// "One Pure Elegance - White"       → mainPart="One Pure Elegance"       → "OPE"
// "Annexure - Calista Sparkle Gl"   → mainPart="Calista Sparkle Gl"      → "CSG"
// "Calista Sparkle PU - Brown"      → mainPart="Calista Sparkle PU"      → "CSP"
function extractProductAbbrev(productName) {
    if (!productName) return null;
    const stopWords = new Set([
        'THE', 'AND', 'OF', 'FOR', 'BASE', 'PAINT', 'PAINTS', 'ANNEXURE', 'EMULSION',
        'ENAMEL', 'PRIMER', 'WHITE', 'SUPER', 'SHADE', 'CODE', 'NAME', 'PROD'
    ]);
    const parts = String(productName).split(/\s*-\s*/);
    let bestAbbrev = null;
    let bestCount = 0;
    for (const part of parts) {
        const words = part.toUpperCase()
            .replace(/[^A-Z ]/g, ' ')
            .split(/\s+/)
            .filter(w => w && !stopWords.has(w) && w.length >= 2);
        if (words.length > bestCount) {
            bestCount = words.length;
            bestAbbrev = words.slice(0, Math.min(3, words.length)).map(w => w[0]).join('');
        }
    }
    return bestAbbrev;
}

// Detect base number from PDF product/baseName.
// "White" → "W", "Super White" → "W", "Base 1" → "1", "1" → "1", "- 5" → "5"
function extractBase(productName, baseCode) {
    const text = String(productName || '').toUpperCase();
    if (/\bSUPER\s*WHITE\b|\bWHITE\b|\bDEEP\s*WHITE\b/.test(text)) return 'W';
    // Tail after "-"
    const tail = text.split(/\s*-\s*/).slice(1).join(' ');
    const m = tail.match(/\b(?:BASE\s*)?([1-9])\b/);
    if (m) return m[1];
    // From 4-digit baseCode last digit (e.g., 9901 → base 1)
    if (baseCode && /^\d{4}$/.test(String(baseCode))) {
        const last = String(baseCode).slice(-1);
        if (last === '0') return 'W';
        return last;
    }
    return null;
}

// Normalize brand names for comparison: "Birla Opus" / "birlaopus" / "BIRLA-OPUS" → "BIRLAOPUS"
function normalizeBrand(b) {
    return String(b || '').toUpperCase().replace(/[^A-Z]/g, '');
}

// Birla Opus non-standard pack sizes map to canonical sizes for matching:
// 0.9L or 900ml ≈ 1L, 3.6L ≈ 4L, 9L ≈ 10L, 18L ≈ 20L
function normalizeBirlaPackSize(sz) {
    const s = String(sz || '').replace(/\s+/g, '').toUpperCase();
    const ml = s.match(/^(\d+(?:\.\d+)?)ML$/);
    if (ml) {
        const v = parseFloat(ml[1]);
        if (v >= 800 && v <= 1050) return '1L';
    }
    const lt = s.match(/^(\d+(?:\.\d+)?)(L|LT|LTR|LITRES?|LITERS?)?$/i);
    if (lt) {
        const n = parseFloat(lt[1]);
        if (n >= 0.8 && n <= 1.05) return '1L';
        if (n > 3.0 && n < 4.5) return '4L';
        if (n > 8.0 && n < 11.0) return '10L';
        if (n > 16.0 && n <= 20.0) return '20L';
    }
    return sz;
}

// Check if PDF category and Zoho category are compatible for matching.
// Prevents cross-category false positives (e.g., EXTERIOR vs INTERIOR EMULSION).
// Returns false only when BOTH sides have a category AND they share no meaningful word.
function catCompatible(pdfCat, zohoCat) {
    if (!pdfCat || !zohoCat) return true;
    const p = String(pdfCat).toUpperCase();
    const z = String(zohoCat).toUpperCase();
    if (p === z) return true;
    // If pdfCat contains a numeric product code (3+ consecutive digits), it's a product-line
    // name like "ALLDRY WALLNROOF 10 (936003)" — can't reliably gate on this, pass through.
    if (/\d{3,}/.test(p)) return true;
    const pIsIntExtCat = /\b(INTERIOR|EXTERIOR)\s+CATEGORY\b/.test(p);
    // Use word-set matching so "WALLNROOF" doesn't trigger the "WALL" check.
    const pWordSet = new Set(p.split(/[\s&,\/\-\(\)]+/).filter(w => w.length >= 3));
    const zWordSet = new Set(z.split(/[\s&,\/\-\(\)]+/).filter(w => w.length >= 3));
    const MAIN = ['EMULSION','ENAMEL','PRIMER','PUTTY','WOOD','METAL','PAINT','FINISH','COAT','WALL','CEIL','DISTEMPER','DISTEMPAR'];
    const pHasMain = MAIN.some(w => pWordSet.has(w)) || pIsIntExtCat;
    if (!pHasMain) return true; // tier-only (PREMIUM/LUXURY) — no gating
    const zHasMain = MAIN.some(w => zWordSet.has(w));
    if (!zHasMain) return true;
    // Interior/Exterior Category (emulsion) must not match Enamel or Distemper items
    if (pIsIntExtCat && (zWordSet.has('ENAMEL') || zWordSet.has('DISTEMPAR') || zWordSet.has('DISTEMPER'))) return false;
    const pWords = p.split(/[\s&,\/\-]+/).filter(w => w.length >= 4);
    const zWords = z.split(/[\s&,\/\-]+/).filter(w => w.length >= 4);
    return pWords.some(pw => zWords.includes(pw));
}

// Map a PDF base variant name to the Zoho SKU base key.
// Birla Opus: White→"WT", Pastel→"1", Mid Tone→"2",
//   Clear→"99", Organic Yellow→"5", Organic Red→"6"
// Returns null for unrecognised variant names (no gating applied).
function emulsionBaseKey(variantName) {
    const v = String(variantName || '').toUpperCase();
    if (/\bWHITE\b/.test(v)) return 'WT';
    if (/\bPASTEL\b/.test(v)) return '1';
    if (/\bMID[\s-]*TONE\b/.test(v)) return '2';
    if (/\bCLEAR\b/.test(v)) return '99';
    if (/ORGANIC[\s-]*YELLOW|\bYELLOW\b/.test(v)) return '5';
    if (/ORGANIC[\s-]*RED|\bRED\b/.test(v)) return '6';
    return null;
}

// Extract the base indicator from a Zoho SKU.
// "ESWT01"→"WT", "ES101"→"1", "ES9901"→"99", "ES501"→"5"
function zohoSkuBase(skuInput) {
    const s = String(skuInput || '').toUpperCase();
    if (/^[A-Z]{2,5}WT\d{2}$/.test(s)) return 'WT';
    const m99 = s.match(/^[A-Z]{2,5}(99)\d{2}$/);
    if (m99) return '99';
    const md = s.match(/^[A-Z]{2,5}(\d)\d{2}$/);
    if (md) return md[1];
    return null;
}

// Base-variant gate using the "- Variant" suffix in the PDF product name and the
// base indicator in the Zoho SKU.  Applied regardless of isEmulsion flag because
// exterior products (e.g. "Exterior Category - Economy") also carry base variants
// (White/Pastel/Mid Tone) and the category text may not contain "Emulsion".
function baseVariantCompatible(pdfProduct, zohoSku, isEmulsion) {
    const variantM = String(pdfProduct || '').match(/\s*-\s*(.+)$/);
    if (!variantM) return true; // no base suffix in PDF name — no gating
    const pdfBase = emulsionBaseKey(variantM[1]);
    if (!pdfBase) return true; // unrecognised variant — no gating
    const zohoBase = zohoSkuBase(zohoSku);
    if (!zohoBase) return true; // SKU doesn't encode base — no gating
    return pdfBase === zohoBase;
}

// Detect finish/type keyword in a name — so Glossy items don't match Matte items of same family.
// Returns one of: 'GLOSS' | 'MATTE' | 'SATIN' | 'SEMIGLOSS' | null
function detectFinish(name) {
    const up = String(name || '').toUpperCase();
    if (/\bSEMI[\s-]*GLOSS\b|\bSEMIGLOSS\b/.test(up)) return 'SEMIGLOSS';
    if (/\bGLOS{1,2}Y\b|\bGLOSS\b|\bGLOOSY\b/.test(up)) return 'GLOSS';  // typos incl.
    if (/\bMATT?E?\b/.test(up)) return 'MATTE';
    if (/\bSATIN\b/.test(up)) return 'SATIN';
    return null;
}

// ============ BIRLA OPUS NAMING HELPERS ============

// Category routing for proposed-name format selection.
function isEmulsionCategory(cat) {
    return /\bEMULSION\b/i.test(String(cat || ''));
}

function isEnamelCategory(cat) {
    return /\bENAMEL\b/i.test(String(cat || ''));
}

// Emulsion product name = PDF product name with variant suffix stripped,
// ALL CAPS. If the leading "- " segment is "ANNEXURE", use the next segment
// instead (matches the existing `extractProductAbbrev` strategy).
function extractEmulsionProductName(pdfProduct) {
    if (!pdfProduct) return '';
    const parts = String(pdfProduct).split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    // Skip a leading ANNEXURE-style label if there is at least one more part
    let main = parts[0];
    if (/^ANNEXURE\b/i.test(main) && parts.length > 1) {
        main = parts[1];
    }
    return main.toUpperCase();
}

// Enamel product+color split — preserves the color (the part after " - ").
// Returns { productName, color }, both ALL CAPS. Color is empty if no dash.
function extractEnamelProductAndColor(pdfProduct) {
    if (!pdfProduct) return { productName: '', color: '' };
    const parts = String(pdfProduct).split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return { productName: '', color: '' };
    const productName = parts[0].toUpperCase();
    const color = parts.length > 1 ? parts.slice(1).join(' ').toUpperCase() : '';
    return { productName, color };
}

// Remove leading tokens of `name` that duplicate the SKU.
// Strips: (a) full SKU exact match, (b) leading [A-Z]+ run of SKU followed by
// digits (e.g. "CSWT" from SKU "CSWT20"), (c) one dangling unit token (L/ML/KG)
// only when it follows a stripped SKU-like token. Stops at the first non-matching
// token. Pure function — no side effects.
function stripDuplicateSkuPrefix(name, sku) {
    if (!name || !sku) return name || '';
    const skuU = String(sku).toUpperCase();
    const skuAlphaMatch = skuU.match(/^[A-Z]+/);
    if (!skuAlphaMatch) return name;
    const skuAlpha = skuAlphaMatch[0]; // e.g. "CSWT", "CSTSBK", "AWPUEM"

    const tokens = String(name).trim().split(/\s+/);
    let stripped = false;
    while (tokens.length) {
        const t = tokens[0].toUpperCase();
        // Case (a): exact SKU match
        if (t === skuU) { tokens.shift(); stripped = true; continue; }
        // Case (b): starts with skuAlpha and contains only [A-Z0-9] (e.g. "CSWT", "CSTSBK500", "CSWT20")
        if (t.startsWith(skuAlpha) && /^[A-Z0-9]+$/.test(t) && t.length >= skuAlpha.length) {
            tokens.shift(); stripped = true; continue;
        }
        // Case (c): dangling unit token immediately after a strip
        if (stripped && /^(L|ML|KG)$/.test(t)) {
            tokens.shift();
            stripped = false; // only consume one trailing unit
            continue;
        }
        break;
    }
    return tokens.join(' ');
}

// Build the canonical Birla Opus proposed name.
// Routes to emulsion vs enamel format based on category.
// Returns null if `sku` or `packFormatted` is empty (caller falls back to base output).
function buildBirlaName({ sku, pdfProduct, category, packFormatted }) {
    if (!sku || !packFormatted) return null;
    const skuU = String(sku).toUpperCase();
    const brand = 'BIRLA OPUS';

    let body;
    if (isEnamelCategory(category)) {
        const { productName, color } = extractEnamelProductAndColor(pdfProduct);
        const cleanedProduct = stripDuplicateSkuPrefix(productName, skuU);
        body = color
            ? `${cleanedProduct} ENAMEL ${color}`
            : `${cleanedProduct} ENAMEL`;
    } else {
        // Emulsion (default): also covers any non-enamel category for now
        const productName = extractEmulsionProductName(pdfProduct);
        body = stripDuplicateSkuPrefix(productName, skuU);
    }

    // Collapse any accidental whitespace runs and assemble final string.
    return `${skuU} ${body} ${brand} ${packFormatted}`.replace(/\s+/g, ' ').trim();
}

// ============ MATCH WITH ZOHO ITEMS ============
function matchWithZohoItems(parsedItems, zohoItems) {
    const matched = [];
    const unmatched = [];

    // Scope to same brand as PDF items to prevent cross-brand false matches.
    // If the PDF carries no brand info, fall back to the full zoho list.
    const pdfBrandSet = new Set(
        parsedItems.map(p => normalizeBrand(p.brand)).filter(Boolean)
    );
    let scopedZoho = zohoItems;
    if (pdfBrandSet.size > 0) {
        scopedZoho = zohoItems.filter(zi => {
            let zb = normalizeBrand(zi.brand || zi.zoho_brand);
            if (!zb) {
                // Fallback: extract brand from item name (e.g. "... BIRLA OPUS 01 L")
                const nm = (zi.name || zi.zoho_item_name || '').toUpperCase();
                zb = (nm.includes('BIRLA') || nm.includes('OPUS')) ? 'BIRLAOPUS'
                   : nm.includes('ASIAN')  ? 'ASIANPAINTS'
                   : nm.includes('BERGER') ? 'BERGERPAINTS'
                   : nm.includes('NIPPON') ? 'NIPPON'
                   : nm.includes('JSW')    ? 'JSW'
                   : '';
            }
            if (!zb) return true; // truly unknown brand — keep to avoid losing candidates
            // Match if any PDF brand's normalized form is contained or equals
            for (const pb of pdfBrandSet) {
                if (zb === pb || zb.includes(pb) || pb.includes(zb)) return true;
            }
            return false;
        });
    }

    // ============ GROUP EXPANSION (Birla Opus style parsers emit _prices arrays) ============
    // Pre-build a Zoho family index keyed by PRODUCT NAME abbrev (exact). This is more
    // reliable than SKU-first-token parsing because some Zoho SKUs have brand prefixes
    // like "OP01" that collide across unrelated product families.
    const zohoFamilyIndex = new Map();  // abbrev → Array<{ zi, packCode, rate, name, finish }>
    for (const zi of scopedZoho) {
        const nameText = (zi.name || zi.zoho_item_name || '').toUpperCase();
        const cleaned = cleanZohoName(nameText);
        const abbr = extractProductAbbrev(cleaned);
        if (!abbr) continue;
        const packCode = extractZohoPackCode(zi);
        if (!packCode) continue;
        const rate = parseFloat(zi.rate || 0);
        const finish = detectFinish(nameText);
        if (!zohoFamilyIndex.has(abbr)) zohoFamilyIndex.set(abbr, []);
        zohoFamilyIndex.get(abbr).push({ zi, packCode, rate, name: nameText, finish });
    }

    // For rows where we have multiple prices but unknown column alignment, use Zoho's
    // actual rates as ground truth. Assign each parsed price to the Zoho family member
    // whose rate is closest by ratio.
    const expandedParsed = [];
    for (const p of parsedItems) {
        if (Array.isArray(p._prices) && p._prices.length > 0) {
            const abbrev = extractProductAbbrev(p.product);
            const pdfFinish = detectFinish(p.product);
            // Exact abbrev lookup in family index
            const candidates = abbrev ? (zohoFamilyIndex.get(abbrev) || []) : [];
            const family = [];
            const isEmulExpand = /EMULSION/i.test(p.category || '');
            const pdfHasShine = /\bSHINE\b/i.test(p.product);
            for (const ent of candidates) {
                const entHasShine = /\bSHINE\b/i.test(ent.name || '');
                if (pdfHasShine !== entHasShine) continue;
                if (pdfFinish && ent.finish && pdfFinish !== ent.finish) continue;
                if (!baseVariantCompatible(p.product, ent.zi.sku || ent.zi.zoho_sku || '', isEmulExpand)) continue;
                family.push({ zi: ent.zi, struct: { packCode: ent.packCode }, rate: ent.rate });
            }

            // Fallback: keyword-overlap scan. Handles cases where PDF and Zoho use
            // slightly different product wording (e.g. "Effects" vs "Metallic" trimmed).
            // Strict: excludes brand/series noise, requires ≥60% of PDF keywords to hit,
            // and requires both sides to have ≥2 distinguishing words.
            let fromFallback = false;
            if (family.length === 0) {
                // Noise = brand names + marketing/tier words that don't distinguish products.
                // We INTENTIONALLY keep product-line words (ALLWOOD, STYLE, INTERIOR, EXTERIOR)
                // because they are distinguishing features within a brand.
                const SERIES_NOISE = new Set([
                    'BIRLA', 'OPUS', 'ASIAN', 'BERGER', 'NIPPON', 'JSW', 'GEM', 'ASTRAL',
                    'PAINT', 'PAINTS', 'BRAND',
                    'PREMIUM', 'LUXURY', 'ECONOMY', 'STANDARD', 'ULTRA', 'DESIGNER', 'PROFESSIONAL',
                    'PRIMER', 'ENAMEL', 'EMULSION'
                ]);
                const pdfProductBase = p.product.toUpperCase().split(/\s*-\s*/)[0];
                const pdfKeywords = extractKeywords(pdfProductBase)
                    .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !SERIES_NOISE.has(w));
                const pCat = (p.category || '').toUpperCase();
                const isEmulFb = /EMULSION/i.test(pCat);
                if (pdfKeywords.length >= 2) {
                    const requiredHits = Math.max(2, Math.ceil(pdfKeywords.length * 0.6));
                    const scored = [];
                    for (const zi of scopedZoho) {
                        // Category gate: skip cross-category mismatches
                        if (!catCompatible(pCat, zi.category || zi.zoho_category_name || '')) continue;
                        // Base variant gate: emulsion White must not match non-White Zoho and vice versa
                        if (!baseVariantCompatible(p.product, zi.sku || zi.zoho_sku || '', isEmulFb)) continue;
                        const nameText = (zi.name || zi.zoho_item_name || '').toUpperCase();
                        const cleaned = cleanZohoName(nameText);
                        let hits = 0;
                        for (const kw of pdfKeywords) {
                            if (cleaned.includes(kw)) hits++;
                        }
                        if (hits < requiredHits) continue;
                        const finish = detectFinish(nameText);
                        if (pdfFinish && finish && pdfFinish !== finish) continue;
                        const packCode = extractZohoPackCode(zi);
                        if (!packCode) continue;
                        const groupKey = extractProductAbbrev(cleaned) || 'UNKNOWN';
                        scored.push({ zi, score: hits, packCode, rate: parseFloat(zi.rate || 0), groupKey });
                    }
                    const groups = new Map();
                    for (const s of scored) {
                        if (!groups.has(s.groupKey)) groups.set(s.groupKey, []);
                        groups.get(s.groupKey).push(s);
                    }
                    let best = null, bestTotal = 0, secondTotal = 0;
                    for (const [, members] of groups) {
                        const total = members.reduce((a, m) => a + m.score, 0);
                        if (total > bestTotal) { secondTotal = bestTotal; bestTotal = total; best = members; }
                        else if (total > secondTotal) { secondTotal = total; }
                    }
                    // Require a clear winner — best must beat runner-up by >1 point
                    if (best && (bestTotal - secondTotal) >= 1) {
                        for (const m of best) {
                            family.push({ zi: m.zi, struct: { packCode: m.packCode }, rate: m.rate });
                        }
                        fromFallback = true;
                    }
                }
            }

            if (family.length === 0) {
                for (const price of p._prices) {
                    unmatched.push({
                        ...p, dpl: price, packSize: '?',
                        _reject_reason: `No Zoho family found for abbrev ${abbrev || '(unknown)'}`
                    });
                }
                continue;
            }
            // Rate-anchored assignment: smallest price → smallest-rate family member, ascending.
            // If rates are missing/zero, fall back to ascending pack size.
            const famSorted = family.slice().sort((x, y) => {
                if (x.rate > 0 && y.rate > 0) return x.rate - y.rate;
                return packCodeToMl(x.struct.packCode) - packCodeToMl(y.struct.packCode);
            });
            const pricesSorted = p._prices.slice().sort((a, b) => a - b);

            // Skip Zoho sizes that clearly don't appear in PDF: if PDF's min price is
            // >2x the Zoho rate for the smallest family member, that member is skipped.
            let startIdx = 0;
            while (
                startIdx < famSorted.length - pricesSorted.length &&
                famSorted[startIdx].rate > 0 &&
                pricesSorted[0] > famSorted[startIdx].rate * 2
            ) {
                startIdx++;
            }
            const take = Math.min(pricesSorted.length, famSorted.length - startIdx);
            for (let i = 0; i < take; i++) {
                const fam = famSorted[startIdx + i];
                const price = pricesSorted[i];
                expandedParsed.push({
                    brand: p.brand,
                    product: p.product,
                    packSize: packCodeToSize(fam.struct.packCode),
                    dpl: price,
                    baseCode: p.baseCode,
                    category: p.category,
                    _assignedZohoId: fam.zi.zoho_item_id || fam.zi.item_id,
                    _fuzzy: fromFallback || undefined
                });
            }
            // Any leftover prices (more prices than family members) → unmatched
            for (let i = take; i < pricesSorted.length; i++) {
                unmatched.push({
                    ...p, dpl: pricesSorted[i], packSize: '?',
                    _reject_reason: `Extra price in PDF row — family has ${famSorted.length - startIdx} sizes, PDF row has ${pricesSorted.length}`
                });
            }
        } else {
            expandedParsed.push(p);
        }
    }

    const zohoByName = new Map();
    const zohoByWords = [];
    const zohoBySku = []; // [{item, struct:{abbrev,base,packCode}, name, sku, finish}]

    scopedZoho.forEach(zi => {
        const name = (zi.name || zi.zoho_item_name || '').toUpperCase().trim();
        const sku = (zi.sku || zi.zoho_sku || '').toUpperCase().trim();
        const finish = detectFinish(name);
        if (name) {
            zohoByName.set(name, zi);
            zohoByWords.push({ words: name.split(/\s+/), item: zi, name, finish });
        }
        // Prefer SKU-parse; fall back to parsing first token of name
        const struct = parseSkuStructure(sku) || parseSkuStructure(name);
        if (struct) zohoBySku.push({ item: zi, struct, name, sku, finish });
    });

    // Build a quick lookup by Zoho item id for shortcut path (group-expanded rows
    // already know their target Zoho item — skip all fallback matching).
    const zohoById = new Map();
    scopedZoho.forEach(zi => {
        const id = zi.zoho_item_id || zi.item_id;
        if (id) zohoById.set(String(id), zi);
    });

    for (const parsed of expandedParsed) {
        const productName = parsed.product.toUpperCase().trim();
        const sizePatterns = normalizeSizeForMatch(parsed.packSize);
        const pdfFinish = detectFinish(productName);

        // Shortcut: rate-anchored expansion already picked the Zoho target.
        let match = null;
        if (parsed._assignedZohoId) {
            match = zohoById.get(String(parsed._assignedZohoId)) || null;
        }

        if (!match) match = zohoByName.get(productName);
        // Exact-name match still ok — but refuse if finishes disagree (e.g., glossy vs matte)
        if (match) {
            const mFin = detectFinish(match.name || match.zoho_item_name || '');
            if (pdfFinish && mFin && pdfFinish !== mFin) match = null;
        }

        // Strategy 0: SKU-structure match — abbrev + pack + optional base + finish
        if (!match) {
            const pdfAbbrev = extractProductAbbrev(parsed.product);
            const pdfPack = packSizeToCode(normalizeBirlaPackSize(parsed.packSize));
            const pdfBase = extractBase(parsed.product, parsed.baseCode);

            if (pdfAbbrev && pdfPack) {
                const pdfCatStr = (parsed.category || '').toUpperCase();
                const isEmulS0 = /EMULSION/i.test(pdfCatStr);
                const strictCandidates = [];
                const looseCandidates = [];
                for (const ent of zohoBySku) {
                    if (ent.struct.packCode !== pdfPack) continue;
                    // Finish must agree when both specify it
                    if (pdfFinish && ent.finish && pdfFinish !== ent.finish) continue;
                    // Category must be compatible (e.g. EXTERIOR can't match INTERIOR EMULSION)
                    if (!catCompatible(pdfCatStr, ent.item.category || ent.item.zoho_category_name || '')) continue;
                    const a = ent.struct.abbrev, b = pdfAbbrev;
                    // startsWith only allowed when both sides have ≥3 chars (prevents "OP"↔"OPE" cross-match)
                    const abbrevMatch = a === b ||
                        (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
                    if (!abbrevMatch) continue;
                    // For emulsions: base variant check (White↔non-White segregation)
                    if (isEmulS0) {
                        if (!baseVariantCompatible(parsed.product, ent.sku, true)) continue;
                    } else {
                        if (pdfBase && ent.struct.base && pdfBase !== ent.struct.base) continue;
                    }
                    if (a === b && (!pdfBase || !ent.struct.base || pdfBase === ent.struct.base)) {
                        strictCandidates.push(ent.item);
                    } else {
                        looseCandidates.push(ent.item);
                    }
                }
                if (strictCandidates.length === 1) match = strictCandidates[0];
                else if (strictCandidates.length > 1) match = strictCandidates[0];
                else if (looseCandidates.length === 1) match = looseCandidates[0];

                // Strategy 0b: zohoFamilyIndex fallback — handles cases where the Zoho SKU
                // abbreviation is shorter than the PDF abbreviation (e.g. "PE" vs "OPE").
                // The family index is keyed by the PRODUCT NAME abbreviation (not SKU), so
                // "OPE" finds PE101/PE104/PE110/PE120 even though their SKU abbrev is "PE".
                if (!match && pdfAbbrev) {
                    const famEntries = zohoFamilyIndex.get(pdfAbbrev) || [];
                    const pdfCatStr0b = (parsed.category || '').toUpperCase();
                    const isEmul0b = /EMULSION/i.test(pdfCatStr0b);
                    const hits = [];
                    for (const ent of famEntries) {
                        if (ent.packCode !== pdfPack) continue;
                        if (pdfFinish && ent.finish && pdfFinish !== ent.finish) continue;
                        if (!catCompatible(pdfCatStr0b, ent.zi.category || ent.zi.zoho_category_name || '')) continue;
                        if (!baseVariantCompatible(parsed.product, ent.zi.sku || ent.zi.zoho_sku || '', isEmul0b)) continue;
                        hits.push(ent.zi);
                    }
                    if (hits.length === 1) match = hits[0];
                    else if (hits.length > 1) match = hits[0];
                }
            }
        }

        // Strategy 2: fallback keyword match — finish + category enforced, minimum score raised
        if (!match) {
            const keywords = extractKeywords(productName.split(/\s*-\s*/)[0]);
            const pdfCatStr2 = (parsed.category || '').toUpperCase();
            // Numeric size from PDF for approximate unit-mismatch matching (e.g. PDF "4L" ↔ Zoho "05 KG")
            const pPackNumM = (parsed.packSize || '').match(/^(\d+(?:\.\d+)?)/);
            const pPackNum  = pPackNumM ? parseFloat(pPackNumM[1]) : null;
            let bestScore = 0;
            let bestMatch = null;
            for (const entry of zohoByWords) {
                // Hard-require pack size to match (not just substring anywhere).
                // Fallback: approximate numeric match within 25% handles L↔KG unit mismatch.
                const hasSize = sizePatterns.some(sp => entry.name.includes(sp));
                if (!hasSize && sizePatterns.length > 0) {
                    const zNumM = entry.name.match(/\b(\d+(?:\.\d+)?)\s*(?:KGS?|L\b|LT\b|LTR\b|ML\b)/i);
                    const zNum  = zNumM ? parseFloat(zNumM[1]) : null;
                    const approxOk = pPackNum && zNum && Math.abs(pPackNum - zNum) / Math.max(pPackNum, zNum) <= 0.25;
                    if (!approxOk) continue;
                }
                // Finish must agree when both sides declare it
                if (pdfFinish && entry.finish && pdfFinish !== entry.finish) continue;
                // Category gate: skip if categories are incompatible
                const ziCat = entry.item.category || entry.item.zoho_category_name || '';
                if (!catCompatible(pdfCatStr2, ziCat)) continue;
                // Base variant gate: White must not match non-White Zoho items and vice versa
                if (!baseVariantCompatible(parsed.product, entry.item.sku || entry.item.zoho_sku || '', false)) continue;
                // SHINE gate: "Product X" must not match "Product X Shine" and vice versa
                { const ph = /\bSHINE\b/i.test(parsed.product); const zh = /\bSHINE\b/i.test(entry.name); if (ph !== zh) continue; }
                let score = 0;
                for (const kw of keywords) if (entry.name.includes(kw)) score++;
                // Raise the bar: need ≥3 matching keywords (or all if name short) to avoid cross-family leaks
                const minRequired = keywords.length <= 2 ? keywords.length : 3;
                if (score >= minRequired && score > bestScore) {
                    bestScore = score;
                    bestMatch = entry.item;
                }
            }
            if (bestMatch && bestScore >= (bestMatch && keywords.length <= 2 ? keywords.length : 3)) match = bestMatch;
        }

        if (match) {
            // Advisory sanity check: if DPL is <25% of the current rate on a priced item,
            // flag it for review but DON'T drop the match — the admin can eyeball in the
            // review panel and uncheck before applying.
            const matchRate = parseFloat(match.rate || 0);
            const parsedDpl = parseFloat(parsed.dpl || 0);
            const brandKey = brandKeyFromName(parsed.brand || '');
            const proposed = computeProposedFields(parsed, match, brandKey);
            const out = {
                ...parsed,
                zoho_item_id: match.zoho_item_id || match.item_id,
                zoho_item_name: match.name || match.zoho_item_name,
                currentDpl: match.cf_dpl || match.zoho_cf_dpl,
                currentRate: match.rate,
                ...proposed
            };
            if (matchRate >= 100 && parsedDpl > 0 && parsedDpl < matchRate * 0.25) {
                out._warning = `DPL ₹${parsedDpl} is <25% of rate ₹${matchRate} — verify before applying`;
            }
            if (parsed._fuzzy) {
                out._warning = (out._warning ? out._warning + '; ' : '') + 'Fuzzy keyword match — verify';
            }
            matched.push(out);
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

    // Birla Opus near-equivalents: 0.9L≈1L, 9L≈10L, 18L≈20L, 3.6L≈4L
    const normSz = normalizeBirlaPackSize(packSize);
    if (normSz !== packSize) {
        for (const p of normalizeSizeForMatch(normSz)) {
            if (!patterns.includes(p)) patterns.push(p);
        }
    }

    return patterns;
}

function extractKeywords(name) {
    // PRIMER/ENAMEL/EMULSION identify product TYPE, not the specific product — exclude from matching
    const stopWords = new Set(['THE', 'AND', 'FOR', 'WITH', 'FROM', 'THAT', 'YOUR', 'ALL',
        'PAINTS', 'PAINT', 'BRAND', 'BASE', 'CODE', 'GROUP', '-', 'IN', 'OF', 'A', 'AN',
        'PRIMER', 'ENAMEL', 'EMULSION']);
    return name.split(/[\s\-()]+/)
        .filter(w => w.length >= 2 && !stopWords.has(w) && !w.match(/^\d+$/))
        .map(w => w.toUpperCase());
}

module.exports = {
    parsePriceList,
    matchWithZohoItems,
    detectBrand,
    // Helpers for SKU normalisation (reused by admin normalize-scan endpoint)
    parseSkuStructure,
    packSizeToCode,
    extractProductAbbrev,
    extractBase,
    detectFinish,
    normalizeBrand,
    // Birla Opus naming helpers
    isEmulsionCategory,
    isEnamelCategory,
    extractEmulsionProductName,
    extractEnamelProductAndColor,
    stripDuplicateSkuPrefix,
    buildBirlaName,
    // DPL import helpers
    computeProposedFields,
    brandKeyFromName,
    formatPackDisplay,
    // Export individual parsers for testing
    parseAsian,
    parseBirlaOpus,
    parseBerger,
    parseGem,
    parseJSW,
    parseNippon
};
