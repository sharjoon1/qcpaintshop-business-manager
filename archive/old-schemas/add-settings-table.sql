-- Migration script to add settings table
-- Run this to fix the "Table 'settings' doesn't exist" error

USE qc_business_manager;

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    category VARCHAR(50) DEFAULT 'general',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (setting_key),
    INDEX idx_category (category)
);

-- Insert default settings
INSERT INTO settings (setting_key, setting_value, category, description) VALUES
    ('business_name', 'Quality Colours (குவாலிட்டி கலர்ஸ்)', 'business', 'Business name'),
    ('business_type', 'both', 'business', 'Business type: retail, wholesale, or both'),
    ('business_address', 'Ramanathapuram, Tamil Nadu, India', 'business', 'Business address'),
    ('business_phone', '+91 7418831122', 'business', 'Business phone number'),
    ('business_email', 'info@qcpaintshop.com', 'business', 'Business email'),
    ('business_logo', NULL, 'business', 'Business logo URL'),
    ('gst_number', NULL, 'tax', 'GST Number (GSTIN)'),
    ('pan_number', NULL, 'tax', 'PAN Number'),
    ('enable_gst', 'true', 'tax', 'Enable GST in estimates'),
    ('cgst_rate', '9', 'tax', 'CGST rate percentage'),
    ('sgst_rate', '9', 'tax', 'SGST rate percentage'),
    ('igst_rate', '18', 'tax', 'IGST rate percentage'),
    ('estimate_prefix', 'EST', 'estimate', 'Estimate number prefix'),
    ('estimate_validity', '30', 'estimate', 'Estimate validity in days'),
    ('estimate_terms', '1. All prices are subject to change without prior notice.\n2. This estimate is valid for 30 days from the date of issue.\n3. Payment terms: As per agreement.\n4. Delivery time: As per discussion.\n5. For any queries, please contact us.', 'estimate', 'Terms and conditions'),
    ('show_brand_logo', 'true', 'estimate', 'Show brand logos in estimates')
ON DUPLICATE KEY UPDATE
    setting_value = VALUES(setting_value);

SELECT '✅ Settings table created successfully!' as status;
SELECT COUNT(*) as total_settings FROM settings;
