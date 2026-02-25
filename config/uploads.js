/**
 * File Upload Configuration
 * Multer storage configs and upload directory setup
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
    'public/uploads/website',
    'uploads/attendance/break',
    'uploads/stock-check',
    'uploads/wa-marketing',
    'uploads/whatsapp'
];

function ensureUploadDirs() {
    uploadDirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// Helper: create disk storage with prefix
function createDiskStorage(destDir, prefix) {
    return multer.diskStorage({
        destination: (req, file, cb) => cb(null, destDir),
        filename: (req, file, cb) => {
            const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, prefix + '-' + uniqueName + path.extname(file.originalname));
        }
    });
}

// Helper: image-only file filter
function imageFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files allowed'));
    }
}

// Logo upload (2MB, images only)
const uploadLogo = multer({
    storage: createDiskStorage('public/uploads/logos/', 'logo'),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Profile picture upload (5MB, images only)
const uploadProfile = multer({
    storage: createDiskStorage('public/uploads/profiles/', 'profile'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Aadhar proof upload (5MB, images + PDF)
const uploadAadhar = multer({
    storage: createDiskStorage('public/uploads/aadhar/', 'aadhar'),
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
    fileFilter: imageFilter
});

module.exports = {
    ensureUploadDirs,
    uploadLogo,
    uploadProfile,
    uploadAadhar,
    designRequestUpload
};
