/**
 * Integrity tests for the git-tracked "Feature Index" data files:
 *   docs/feature-index/feature-index.json
 *   docs/feature-index/design-screens.json
 *
 * Pure data-shape tests — NO DB, NO network, NO server. These lock the
 * invariants the admin-docs API and the three admin pages rely on:
 * stable unique ids, a correct next_id, required fields present, legal
 * enum values, parseable dates, and a consistent design <-> screen-title
 * cross-reference.
 */

const fs = require('fs');
const path = require('path');

const FEATURE_INDEX_PATH = path.join(__dirname, '..', '..', 'docs', 'feature-index', 'feature-index.json');
const DESIGN_SCREENS_PATH = path.join(__dirname, '..', '..', 'docs', 'feature-index', 'design-screens.json');

const LEGAL_PLATFORMS = ['android', 'web-admin', 'web-staff', 'web-painter', 'web-public'];
const LEGAL_TYPES = ['page', 'section', 'button', 'tab', 'feature', 'field', 'state'];
const REQUIRED_STRING_FIELDS = ['page', 'platform', 'route', 'type', 'title', 'does'];

let featureIndex;
let designScreens;

beforeAll(() => {
    featureIndex = JSON.parse(fs.readFileSync(FEATURE_INDEX_PATH, 'utf8'));
    designScreens = JSON.parse(fs.readFileSync(DESIGN_SCREENS_PATH, 'utf8'));
});

describe('feature-index.json shape', () => {
    test('has entries array and a numeric next_id', () => {
        expect(Array.isArray(featureIndex.entries)).toBe(true);
        expect(featureIndex.entries.length).toBeGreaterThan(0);
        expect(typeof featureIndex.next_id).toBe('number');
        expect(Number.isInteger(featureIndex.next_id)).toBe(true);
    });

    test('every id is a unique positive integer', () => {
        const ids = featureIndex.entries.map(e => e.id);
        ids.forEach(id => {
            expect(Number.isInteger(id)).toBe(true);
            expect(id).toBeGreaterThan(0);
        });
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    test('next_id === max(id) + 1', () => {
        const maxId = Math.max(...featureIndex.entries.map(e => e.id));
        expect(featureIndex.next_id).toBe(maxId + 1);
    });

    test('required fields are non-empty strings on every entry', () => {
        featureIndex.entries.forEach(entry => {
            REQUIRED_STRING_FIELDS.forEach(field => {
                expect(typeof entry[field]).toBe('string');
                expect(entry[field].trim().length).toBeGreaterThan(0);
            });
        });
    });

    test('platform is always one of the legal enum values', () => {
        featureIndex.entries.forEach(entry => {
            expect(LEGAL_PLATFORMS).toContain(entry.platform);
        });
    });

    test('type is always one of the legal enum values', () => {
        featureIndex.entries.forEach(entry => {
            expect(LEGAL_TYPES).toContain(entry.type);
        });
    });

    test('updated parses as a valid date when present', () => {
        featureIndex.entries.forEach(entry => {
            if (entry.updated) {
                const parsed = new Date(entry.updated);
                expect(Number.isNaN(parsed.getTime())).toBe(false);
            }
        });
    });

    test('status, when present, is a non-empty string', () => {
        featureIndex.entries.forEach(entry => {
            if (entry.status !== undefined) {
                expect(typeof entry.status).toBe('string');
                expect(entry.status.trim().length).toBeGreaterThan(0);
            }
        });
    });
});

describe('design-screens.json shape', () => {
    test('has exactly 39 unique screen titles', () => {
        expect(Array.isArray(designScreens.screens)).toBe(true);
        expect(designScreens.screens.length).toBe(39);
        const titles = designScreens.screens.map(s => s.title);
        const uniqueTitles = new Set(titles);
        expect(uniqueTitles.size).toBe(39);
    });

    test('every screen has a non-empty title and a boolean pendingRefresh', () => {
        designScreens.screens.forEach(screen => {
            expect(typeof screen.title).toBe('string');
            expect(screen.title.trim().length).toBeGreaterThan(0);
            expect(typeof screen.pendingRefresh).toBe('boolean');
        });
    });
});

describe('feature-index <-> design-screens cross-reference', () => {
    test('every entry.design (when present) matches a title in design-screens.json', () => {
        const validTitles = new Set(designScreens.screens.map(s => s.title));
        featureIndex.entries.forEach(entry => {
            if (entry.design) {
                expect(validTitles.has(entry.design)).toBe(true);
            }
        });
    });

    test('every screen has at least one type:"page" entry pointing at it', () => {
        const pageDesigns = new Set(
            featureIndex.entries.filter(e => e.type === 'page').map(e => e.design)
        );
        designScreens.screens.forEach(screen => {
            expect(pageDesigns.has(screen.title)).toBe(true);
        });
    });
});
