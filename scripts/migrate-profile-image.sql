-- Migration: Expand profile_image_url column to support base64 encoded images
-- Run this on the qc_business_manager database

ALTER TABLE users MODIFY COLUMN profile_image_url LONGTEXT NULL;

-- Verify the change
DESCRIBE users;
