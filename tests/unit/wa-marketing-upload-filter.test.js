/**
 * KN-P2-5 — wa-marketing upload filter.
 * Locks the tightened allow-list: a file is accepted only when BOTH the
 * extension AND the MIME type are allowed. The previous filter accepted
 * ext OR mime and blanket-allowed any application/* — these tests pin the
 * spoof cases that used to slip through.
 */

const { isAllowedMarketingUpload } = require('../../routes/wa-marketing');

describe('wa-marketing upload filter (KN-P2-5)', () => {
    test.each([
        ['photo.jpg', 'image/jpeg'],
        ['photo.jpeg', 'image/jpeg'],
        ['logo.PNG', 'image/png'],
        ['anim.gif', 'image/gif'],
        ['pic.webp', 'image/webp'],
        ['flyer.pdf', 'application/pdf'],
        ['letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ['old.doc', 'application/msword'],
        ['old.xls', 'application/vnd.ms-excel'],
    ])('accepts legitimate %s (%s)', (name, mime) => {
        expect(isAllowedMarketingUpload(name, mime)).toBe(true);
    });

    test.each([
        ['malware.exe', 'application/x-msdownload'], // blanket application/* used to allow this
        ['evil.html', 'text/html'],
        ['shell.php.jpg', 'application/x-php'],       // good ext, bad mime → now rejected
        ['photo.jpg', 'application/x-msdownload'],    // good ext, bad mime → rejected
        ['malware.exe', 'image/png'],                 // bad ext, good mime → rejected (was accepted via mime)
        ['noext', 'application/pdf'],
        ['', ''],
    ])('rejects spoofed %s (%s)', (name, mime) => {
        expect(isAllowedMarketingUpload(name, mime)).toBe(false);
    });
});
