/**
 * E-1 regression tests: uploads are validated by CONTENT (magic bytes), not
 * just mimetype/extension.
 *
 *  - isImageContent / isPdfContent / isCsvOrTextContent match real signatures
 *  - a text file renamed .png is rejected as image content
 *  - magicByteStorage rejects a stream whose head is not a valid image and
 *    persists nothing; a valid PNG stream is written to disk
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const {
    isImageContent,
    isPdfContent,
    isCsvOrTextContent,
    matchesMagic,
    magicByteStorage
} = require('../../config/uploads');

describe('E-1 magic-byte validation', () => {
    test('recognizes a real PNG header', () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
        expect(isImageContent(png)).toBe(true);
    });

    test('recognizes a real JPEG header', () => {
        expect(isImageContent(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(true);
    });

    test('recognizes a real PDF header', () => {
        expect(isPdfContent(Buffer.from('%PDF-1.7'))).toBe(true);
        expect(isPdfContent(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBe(true);
    });

    test('rejects text content masquerading as an image', () => {
        const fakePng = Buffer.from('this is not an image at all......');
        expect(isImageContent(fakePng)).toBe(false);
        expect(matchesMagic(fakePng, [Buffer => false])).toBe(false);
    });

    test('csv/text detection rejects binary content with NUL bytes', () => {
        expect(isCsvOrTextContent(Buffer.from('sku,price\nA,10\n'))).toBe(true);
        const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]);
        expect(isCsvOrTextContent(binary)).toBe(false);
    });

    test('magicByteStorage writes a valid PNG and rejects a fake one', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-magic-'));
        const storage = magicByteStorage({ destDir: tmp, prefix: 'img', matchers: [Buffer => Buffer.length >= 8 && Buffer[0] === 0x89] });

        // valid: first byte 0x89
        await new Promise((resolve, reject) => {
            const stream = new PassThrough();
            stream.write(Buffer.from([0x89, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
            stream.end();
            storage._handleFile({}, { originalname: 'ok.png', stream }, (err, info) => {
                if (err) return reject(err);
                expect(fs.existsSync(info.path)).toBe(true);
                resolve();
            });
        });

        // invalid: first byte 0x41 ('A')
        await new Promise((resolve) => {
            const stream = new PassThrough();
            stream.write(Buffer.from([0x41, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
            stream.end();
            storage._handleFile({}, { originalname: 'fake.png', stream }, (err) => {
                expect(err).toBeTruthy();
                expect(err.message).toContain('does not match');
                resolve();
            });
        });

        // nothing persisted for the rejected file
        const files = fs.readdirSync(tmp).filter(f => f.includes('fake'));
        expect(files.length).toBe(0);
        fs.rmSync(tmp, { recursive: true, force: true });
    });
});
