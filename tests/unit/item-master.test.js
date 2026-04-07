/**
 * Item Master Management — Unit Tests
 * Tests: pricing formula, size padding, name generation, health check, Zod schemas
 */

const { z } = require('zod');

// ─── Pure functions (duplicated from route for isolated testing) ────────

const CATEGORY_CODES = {
    'IE': 'INTERIOR EMULSION',
    'EE': 'EXTERIOR EMULSION',
    'EP': 'EXTERIOR PRIMER',
    'IP': 'INTERIOR PRIMER',
    'EN': 'ENAMEL',
    'WC': 'WOOD COATING',
    'WP': 'WATERPROOFING',
    'TX': 'TEXTURE',
    'PT': 'PUTTY',
    'ST': 'STAINER',
    'TH': 'THINNER',
    'AD': 'ADHESIVE'
};

const COLOR_MAP = {
    'WHITE': 'WH', 'BLACK': 'BL', 'RED': 'RD', 'BLUE': 'BU',
    'GREEN': 'GR', 'YELLOW': 'YL', 'GREY': 'GY', 'BROWN': 'BR',
    'CREAM': 'CR', 'IVORY': 'IV', 'SILVER': 'SL', 'GOLD': 'GD',
    'ORANGE': 'OR', 'PINK': 'PK', 'PURPLE': 'PR', 'MAROON': 'MR'
};

function padSize(size) {
    return String(size).padStart(2, '0');
}

function calculateSalesPrice(dpl) {
    return Math.ceil(dpl * 1.298);
}

function generateItemName(rule, size, base, color) {
    const paddedSize = padSize(size);
    let code = rule.product_short;
    if (base) code += base;
    if (color) code += COLOR_MAP[color.toUpperCase()] || color.substring(0, 2).toUpperCase();
    const name = rule.product_name.toUpperCase();
    return `${rule.category_code}${paddedSize} ${code} ${name} ${paddedSize} L`;
}

function generateDescription(rule, size, base) {
    const categoryFull = CATEGORY_CODES[rule.category_code] || rule.category_code;
    const paddedSize = padSize(size);
    const brand = 'BIRLA OPUS';
    let desc = `${categoryFull} ${brand} ${paddedSize} L (${rule.product_short}`;
    if (base) desc += base;
    desc += ')';
    return desc;
}

function generateSku(rule, size, base, color) {
    let code = rule.product_short;
    if (base) code += base;
    if (color) code += COLOR_MAP[color.toUpperCase()] || color.substring(0, 2).toUpperCase();
    return `${code}${padSize(size)}`;
}

function checkItemHealth(item) {
    const issues = [];
    if (!item.zoho_sku) {
        issues.push({ type: 'missing_sku', message: 'Item has no SKU code' });
    }
    if (!item.zoho_cf_dpl || Number(item.zoho_cf_dpl) === 0) {
        issues.push({ type: 'missing_dpl', message: 'DPL price not set' });
    }
    if (item.zoho_cf_dpl && item.zoho_purchase_rate &&
        Math.abs(Number(item.zoho_cf_dpl) - Number(item.zoho_purchase_rate)) > 0.01) {
        issues.push({ type: 'dpl_purchase_mismatch', message: 'DPL does not match purchase rate' });
    }
    if (item.zoho_cf_dpl && item.zoho_rate) {
        const expectedSales = calculateSalesPrice(Number(item.zoho_cf_dpl));
        if (Math.abs(expectedSales - Number(item.zoho_rate)) > 0.01) {
            issues.push({ type: 'sales_price_mismatch', message: `Sales price should be ${expectedSales} but is ${item.zoho_rate}` });
        }
    }
    if (item.zoho_item_name && !/^[A-Z]{2}\d{2}\s/.test(item.zoho_item_name)) {
        issues.push({ type: 'bad_name_format', message: 'Name does not follow XX00 convention' });
    }
    return issues;
}

// ─── Zod schemas ────────────────────────────────────────────────────────

const bulkEditSchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().or(z.number()),
        zoho_item_name: z.string().optional(),
        zoho_sku: z.string().optional(),
        zoho_cf_dpl: z.number().optional(),
        zoho_rate: z.number().optional(),
        zoho_purchase_rate: z.number().optional(),
        zoho_description: z.string().optional()
    })).min(1).max(100)
});

const dplApplySchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().or(z.number()),
        dpl: z.number().positive(),
        version_id: z.number().optional()
    })).min(1).max(500),
    version_id: z.number().optional()
});

const namingRuleSchema = z.object({
    brand: z.string().min(1),
    product_name: z.string().min(1),
    product_short: z.string().min(1).max(6),
    category_code: z.string().length(2)
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Item Master Management', () => {

    // ── Pricing Formula ─────────────────────────────────────────────────

    describe('calculateSalesPrice', () => {
        it('should calculate 285 → 370', () => {
            expect(calculateSalesPrice(285)).toBe(370);
        });

        it('should calculate 410 → 533', () => {
            expect(calculateSalesPrice(410)).toBe(533);
        });

        it('should calculate 1000 → 1298', () => {
            expect(calculateSalesPrice(1000)).toBe(1298);
        });

        it('should calculate 0 → 0', () => {
            expect(calculateSalesPrice(0)).toBe(0);
        });

        it('should calculate 500 → 649', () => {
            expect(calculateSalesPrice(500)).toBe(649);
        });
    });

    // ── Size Padding ────────────────────────────────────────────────────

    describe('padSize', () => {
        it('should pad 1 → "01"', () => {
            expect(padSize(1)).toBe('01');
        });

        it('should pad 4 → "04"', () => {
            expect(padSize(4)).toBe('04');
        });

        it('should keep 10 → "10"', () => {
            expect(padSize(10)).toBe('10');
        });

        it('should keep 20 → "20"', () => {
            expect(padSize(20)).toBe('20');
        });
    });

    // ── Name Generation ─────────────────────────────────────────────────

    describe('Name Generation', () => {
        const primerRule = {
            category_code: 'EP',
            product_short: 'PSP',
            product_name: 'Perfect Start Primer'
        };

        const emulsionRule = {
            category_code: 'EE',
            product_short: 'PB',
            product_name: 'Power Bright Ext Emulsion'
        };

        const enamelRule = {
            category_code: 'EN',
            product_short: 'CM',
            product_name: 'Cover Max Enamel Black'
        };

        describe('generateItemName', () => {
            it('should generate primer name (no base, no color)', () => {
                expect(generateItemName(primerRule, 1, null, null))
                    .toBe('EP01 PSP PERFECT START PRIMER 01 L');
            });

            it('should generate emulsion name with base', () => {
                expect(generateItemName(emulsionRule, 1, '1', null))
                    .toBe('EE01 PB1 POWER BRIGHT EXT EMULSION 01 L');
            });

            it('should generate enamel name with color', () => {
                expect(generateItemName(enamelRule, 1, null, 'BLACK'))
                    .toBe('EN01 CMBL COVER MAX ENAMEL BLACK 01 L');
            });
        });

        describe('generateSku', () => {
            it('should generate primer SKU', () => {
                expect(generateSku(primerRule, 1, null, null)).toBe('PSP01');
            });

            it('should generate emulsion SKU with base', () => {
                expect(generateSku(emulsionRule, 1, '1', null)).toBe('PB101');
            });

            it('should generate enamel SKU with color', () => {
                expect(generateSku(enamelRule, 1, null, 'BLACK')).toBe('CMBL01');
            });
        });

        describe('generateDescription', () => {
            it('should generate primer description', () => {
                expect(generateDescription(primerRule, 1, null))
                    .toBe('EXTERIOR PRIMER BIRLA OPUS 01 L (PSP)');
            });

            it('should generate emulsion description with base', () => {
                expect(generateDescription(emulsionRule, 1, '1'))
                    .toBe('EXTERIOR EMULSION BIRLA OPUS 01 L (PB1)');
            });
        });
    });

    // ── Health Check ────────────────────────────────────────────────────

    describe('checkItemHealth', () => {
        it('should flag missing SKU', () => {
            const item = { zoho_sku: '', zoho_cf_dpl: '100', zoho_purchase_rate: '100', zoho_rate: '130', zoho_item_name: 'EP01 PSP TEST 01 L' };
            const issues = checkItemHealth(item);
            expect(issues.some(i => i.type === 'missing_sku')).toBe(true);
        });

        it('should flag missing DPL', () => {
            const item = { zoho_sku: 'PSP01', zoho_cf_dpl: null, zoho_purchase_rate: '100', zoho_rate: '130', zoho_item_name: 'EP01 PSP TEST 01 L' };
            const issues = checkItemHealth(item);
            expect(issues.some(i => i.type === 'missing_dpl')).toBe(true);
        });

        it('should flag DPL/purchase mismatch', () => {
            const item = { zoho_sku: 'PSP01', zoho_cf_dpl: '100', zoho_purchase_rate: '90', zoho_rate: '130', zoho_item_name: 'EP01 PSP TEST 01 L' };
            const issues = checkItemHealth(item);
            expect(issues.some(i => i.type === 'dpl_purchase_mismatch')).toBe(true);
        });

        it('should flag sales price mismatch', () => {
            const item = { zoho_sku: 'PSP01', zoho_cf_dpl: '100', zoho_purchase_rate: '100', zoho_rate: '999', zoho_item_name: 'EP01 PSP TEST 01 L' };
            const issues = checkItemHealth(item);
            expect(issues.some(i => i.type === 'sales_price_mismatch')).toBe(true);
        });

        it('should flag bad name format', () => {
            const item = { zoho_sku: 'PSP01', zoho_cf_dpl: '100', zoho_purchase_rate: '100', zoho_rate: '130', zoho_item_name: 'some random name' };
            const issues = checkItemHealth(item);
            expect(issues.some(i => i.type === 'bad_name_format')).toBe(true);
        });

        it('should return no issues for a complete item', () => {
            const item = {
                zoho_sku: 'PSP01',
                zoho_cf_dpl: '285',
                zoho_purchase_rate: '285',
                zoho_rate: '370',
                zoho_item_name: 'EP01 PSP PERFECT START PRIMER 01 L'
            };
            const issues = checkItemHealth(item);
            expect(issues).toHaveLength(0);
        });
    });

    // ── Zod Validation Schemas ──────────────────────────────────────────

    describe('Zod Validation Schemas', () => {

        describe('bulkEditSchema', () => {
            it('should accept valid bulk edit payload', () => {
                const data = {
                    items: [{ zoho_item_id: '123', zoho_sku: 'PSP01' }]
                };
                expect(() => bulkEditSchema.parse(data)).not.toThrow();
            });

            it('should reject empty items array', () => {
                const data = { items: [] };
                expect(() => bulkEditSchema.parse(data)).toThrow();
            });

            it('should reject more than 100 items', () => {
                const items = Array.from({ length: 101 }, (_, i) => ({ zoho_item_id: String(i) }));
                expect(() => bulkEditSchema.parse({ items })).toThrow();
            });
        });

        describe('dplApplySchema', () => {
            it('should accept valid DPL apply payload', () => {
                const data = {
                    items: [{ zoho_item_id: '123', dpl: 285 }]
                };
                expect(() => dplApplySchema.parse(data)).not.toThrow();
            });

            it('should reject zero DPL', () => {
                const data = {
                    items: [{ zoho_item_id: '123', dpl: 0 }]
                };
                expect(() => dplApplySchema.parse(data)).toThrow();
            });

            it('should reject negative DPL', () => {
                const data = {
                    items: [{ zoho_item_id: '123', dpl: -100 }]
                };
                expect(() => dplApplySchema.parse(data)).toThrow();
            });
        });

        describe('namingRuleSchema', () => {
            it('should accept valid naming rule', () => {
                const data = {
                    brand: 'Birla Opus',
                    product_name: 'Perfect Start Primer',
                    product_short: 'PSP',
                    category_code: 'EP'
                };
                expect(() => namingRuleSchema.parse(data)).not.toThrow();
            });

            it('should reject missing brand', () => {
                const data = {
                    brand: '',
                    product_name: 'Test',
                    product_short: 'TST',
                    category_code: 'EP'
                };
                expect(() => namingRuleSchema.parse(data)).toThrow();
            });

            it('should reject category_code not 2 chars', () => {
                const data = {
                    brand: 'Test',
                    product_name: 'Test',
                    product_short: 'TST',
                    category_code: 'EPX'
                };
                expect(() => namingRuleSchema.parse(data)).toThrow();
            });

            it('should reject product_short longer than 6 chars', () => {
                const data = {
                    brand: 'Test',
                    product_name: 'Test',
                    product_short: 'TOOLONG1',
                    category_code: 'EP'
                };
                expect(() => namingRuleSchema.parse(data)).toThrow();
            });
        });
    });
});
