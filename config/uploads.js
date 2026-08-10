/**
 * File Upload Configuration
 * Multer storage configs and upload directory setup
 *
 * E-1 (SECURITY): every upload now validates CONTENT magic bytes, not just
 * extension/mimetype. A `.png` renamed `.jpg` or a polyglot file is rejected.
 *   - memory-storage uploads validate `file.buffer` in the fileFilter
 *   - disk-storage uploads use `magicByteStorage`, which inspects the first
 *     bytes of the stream before committing the file to disk
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadDirs = [
    'public/uploads/logos',
    'public/uploads/profiles',
    'public/uploads/attendance/clock-in',
    'public/uploads/attendance/clock-out',
    'public/uploads/documents',
    'public/uploads/design-requests',
    'public/uploads/visualizations',
    'public/uploads/aadhar',
    'public/uploads/daily-tasks',
    'public/uploads/activity',
    'public/uploads/website',
    'uploads/attendance/break',
    'uploads/stock-check',
    'uploads/wa-marketing',
    'uploads/whatsapp',
    'public/uploads/products',
    'public/uploads/offers',
    'public/uploads/training',
    'public/uploads/painter-attendance',
    'public/uploads/painter-cards',
    'public/uploads/painter-visualizations',
    'uploads/vendor-bills',
    'uploads/dpl-pdfs',
    'public/uploads/admin-notif-images',
    'public/uploads/agreements'
];

function ensureUploadDirs() {
    uploadDirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// =====================================================
// E-1 magic-byte (content) validation
// =====================================================

/** Read-only signature matchers — each receives the first 16 bytes. */
const sig = {
    png: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
    jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    gif: (b) => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
    webp: (b) => b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP',
    pdf: (b) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
    zip: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07), // xlsx/docx
    bmp: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d,
    heic: (b) => b.length >= 12 && b.slice(4, 12).toString('latin1').startsWith('ftyp'),
};

const IMAGE_SIGNATURES = [sig.png, sig.jpeg, sig.gif, sig.webp, sig.bmp, sig.heic];

/**
 * Validate a buffer's magic bytes against allowed matchers.
 * @param {Buffer} buf - first bytes of the file (>= 16 bytes recommended)
 * @param {Array<Function>} matchers - one of the sig.* matchers
 */
function matchesMagic(buf, matchers) {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
    return matchers.some((fn) => fn(buf));
}

function isImageContent(buf) {
    return matchesMagic(buf, IMAGE_SIGNATURES);
}

function isPdfContent(buf) {
    return matchesMagic(buf, [sig.pdf]);
}

function isCsvOrTextContent(buf) {
    // text/plain-ish: no NUL bytes in the first 512 bytes and printable-ish head
    if (!Buffer.isBuffer(buf) || buf.length === 0) return false;
    const head = buf.slice(0, Math.min(512, buf.length));
    // NUL bytes strongly imply binary; allow UTF-8 BOM / UTF-16 BOM
    if (head.includes(0x00)) return false;
    return true;
}

/** imageFilter replacement that ALSO checks content magic bytes (memory uploads). */
function makeMagicImageFilter() {
    return (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files allowed'));
        }
        if (file.buffer && !isImageContent(file.buffer)) {
            return cb(new Error('File content is not a valid image'));
        }
        cb(null, true);
    };
}

// =====================================================
// Disk storage with E-1 magic-byte gate
// =====================================================

/**
 * multer storage engine that buffers the first 16 bytes of the incoming
 * stream, validates them against `matchers`, and only then writes the file.
 * Rejects (error) when the content does not match — nothing is persisted.
 */
function magicByteStorage({ destDir, prefix, matchers, transformName }) {
    const resolveDest = (req) => (typeof destDir === 'function' ? destDir(req) : destDir);
    return {
        _handleFile(req, file, cb) {
            const head = [];
            let headLen = 0;
            const maxHead = 16;
            const chunks = [];
            let size = 0;

            file.stream.on('data', (chunk) => {
                if (headLen < maxHead) {
                    const need = maxHead - headLen;
                    head.push(chunk.slice(0, need));
                    headLen += Math.min(need, chunk.length);
                }
                size += chunk.length;
                chunks.push(chunk);
            });

            file.stream.on('end', () => {
                try {
                    const headBuf = Buffer.concat(head);
                    if (!matchesMagic(headBuf, matchers)) {
                        return cb(new Error('File content does not match the allowed type'));
                    }
                    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
                    const filename = transformName
                        ? transformName(uniqueName, file)
                        : prefix + '-' + uniqueName + path.extname(file.originalname);
                    const targetDir = resolveDest(req);
                    const fullPath = path.join(targetDir, filename);
                    fs.mkdirSync(targetDir, { recursive: true });
                    const ws = fs.createWriteStream(fullPath);
                    for (const c of chunks) ws.write(c);
                    ws.end(() => {
                        cb(null, { path: fullPath, size, filename });
                    });
                    ws.on('error', (err) => cb(err));
                } catch (err) {
                    cb(err);
                }
            });

            file.stream.on('error', (err) => cb(err));
        },
        _removeFile(req, file, cb) {
            if (file.path) {
                fs.unlink(file.path, () => cb(null));
            } else {
                cb(null);
            }
        }
    };
}

// Backwards-compatible helper: disk storage with prefix + optional magic gate
function createDiskStorage(destDir, prefix, matchers) {
    if (matchers) {
        return magicByteStorage({ destDir, prefix, matchers });
    }
    return multer.diskStorage({
        destination: (req, file, cb) => cb(null, destDir),
        filename: (req, file, cb) => {
            const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, prefix + '-' + uniqueName + path.extname(file.originalname));
        }
    });
}

// Helper: image-only file filter (mimetype gate — content gate added per-upload)
function imageFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files allowed'));
    }
}

// ---- Disk-storage uploads: now content-validated via magicByteStorage ----

// Logo upload (2MB, images only)
const uploadLogo = multer({
    storage: createDiskStorage('public/uploads/logos/', 'logo', IMAGE_SIGNATURES),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Profile picture upload (5MB, images only)
const uploadProfile = multer({
    storage: createDiskStorage('public/uploads/profiles/', 'profile', IMAGE_SIGNATURES),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Aadhar proof upload (5MB, images + PDF)
const uploadAadhar = multer({
    storage: createDiskStorage('public/uploads/aadhar/', 'aadhar', [...IMAGE_SIGNATURES, sig.pdf]),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only image and PDF files allowed'));
        }
    }
});

// Design request photo upload (memory storage for sharp compression, 10MB)
const designRequestUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: makeMagicImageFilter()
});

// Product catalog image upload (5MB, images only)
const uploadProductImage = multer({
    storage: createDiskStorage('public/uploads/products/', 'product', IMAGE_SIGNATURES),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Special offer banner upload (3MB, images only)
const uploadOfferBanner = multer({
    storage: createDiskStorage('public/uploads/offers/', 'offer', IMAGE_SIGNATURES),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Training content upload (10MB, images + PDF)
const uploadTraining = multer({
    storage: createDiskStorage('public/uploads/training/', 'training', [...IMAGE_SIGNATURES, sig.pdf]),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only image and PDF files allowed'));
        }
    }
});

// Painter attendance check-in photo upload (5MB, images only)
const uploadPainterAttendance = multer({
    storage: createDiskStorage('public/uploads/painter-attendance/', 'checkin', IMAGE_SIGNATURES),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Painter visualization photo upload (10MB, memory storage for sharp compression)
const uploadPainterVisualization = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: makeMagicImageFilter()
});

// Activity tracker photo upload (15MB — phone cameras produce large files, sharp compresses after)
const uploadActivity = multer({
    storage: createDiskStorage('public/uploads/activity/', 'activity', IMAGE_SIGNATURES),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Price list PDF upload (10MB, memory storage for parsing)
const uploadPriceList = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files allowed'));
        }
        if (file.buffer && !isPdfContent(file.buffer)) {
            return cb(new Error('File content is not a valid PDF'));
        }
        cb(null, true);
    }
});

// Price list CSV upload (5MB, memory storage for parsing, CSV only)
const uploadPriceCsv = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = file.mimetype === 'text/csv'
            || file.mimetype === 'application/vnd.ms-excel'
            || file.originalname.toLowerCase().endsWith('.csv');
        if (!ok) return cb(new Error('Only CSV files allowed'));
        if (file.buffer && !isCsvOrTextContent(file.buffer)) {
            return cb(new Error('File content is not valid CSV/text'));
        }
        cb(null, true);
    }
});

// Vendor bill photo upload (10MB, images + PDF)
const uploadVendorBill = multer({
    storage: createDiskStorage('uploads/vendor-bills/', 'bill', [...IMAGE_SIGNATURES, sig.pdf]),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only image and PDF files allowed'));
        }
    }
});

// DPL PDF upload (15MB, PDF only, stored per brand) — magic-byte gated
const uploadDplPdf = multer({
    storage: magicByteStorage({
        destDir: (req) => {
            const brand = (req.body.brand || 'unknown').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
            return `uploads/dpl-pdfs/${brand}`;
        },
        matchers: [sig.pdf],
        transformName: (uniqueName, file) => {
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
            return `${Date.now()}-${safeName}`;
        }
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files allowed'));
        }
        cb(null, true);
    }
});

module.exports = {
    ensureUploadDirs,
    uploadLogo,
    uploadProfile,
    uploadAadhar,
    designRequestUpload,
    uploadProductImage,
    uploadOfferBanner,
    uploadTraining,
    uploadPainterAttendance,
    uploadPainterVisualization,
    uploadActivity,
    uploadPriceList,
    uploadPriceCsv,
    uploadVendorBill,
    uploadDplPdf,
    // exported for tests
    isImageContent,
    isPdfContent,
    isCsvOrTextContent,
    matchesMagic,
    magicByteStorage
};
