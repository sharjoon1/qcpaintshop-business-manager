/**
 * Unit tests for config modules
 */

describe('Config: database', () => {
    it('should export createPool function', () => {
        const { createPool } = require('../../config/database');
        expect(typeof createPool).toBe('function');
    });
});

describe('Config: uploads', () => {
    const uploads = require('../../config/uploads');
    
    it('should export ensureUploadDirs function', () => {
        expect(typeof uploads.ensureUploadDirs).toBe('function');
    });

    it('should export uploadLogo multer instance', () => {
        expect(uploads.uploadLogo).toBeDefined();
        expect(typeof uploads.uploadLogo.single).toBe('function');
    });

    it('should export uploadProfile multer instance', () => {
        expect(uploads.uploadProfile).toBeDefined();
        expect(typeof uploads.uploadProfile.single).toBe('function');
    });

    it('should export uploadAadhar multer instance', () => {
        expect(uploads.uploadAadhar).toBeDefined();
        expect(typeof uploads.uploadAadhar.single).toBe('function');
    });

    it('should export designRequestUpload multer instance', () => {
        expect(uploads.designRequestUpload).toBeDefined();
        expect(typeof uploads.designRequestUpload.single).toBe('function');
    });
});
