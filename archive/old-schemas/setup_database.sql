CREATE DATABASE IF NOT EXISTS qc_business_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE qc_business_manager;

CREATE TABLE brands (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    logo_url VARCHAR(255),
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    brand_id INT,
    category_id INT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    product_type ENUM('area_wise','unit_wise') NOT NULL,
    area_coverage DECIMAL(10,2) COMMENT 'sqft per liter',
    available_sizes JSON COMMENT '[1,4,10,20]',
    base_price DECIMAL(10,2) NOT NULL COMMENT 'Price INCLUDING GST',
    gst_percentage DECIMAL(5,2) DEFAULT 18.00,
    is_gst_inclusive BOOLEAN DEFAULT true,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id),
    FOREIGN KEY (category_id) REFERENCES categories(id),
    INDEX idx_status (status),
    INDEX idx_type (product_type)
);

CREATE TABLE customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(15),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    gst_number VARCHAR(50),
    status ENUM('pending','approved','inactive') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_phone (phone),
    INDEX idx_status (status)
);

CREATE TABLE estimates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    estimate_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INT,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(15),
    customer_address TEXT,
    estimate_date DATE NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    gst_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    grand_total DECIMAL(12,2) NOT NULL,
    show_gst_breakdown BOOLEAN DEFAULT true,
    notes TEXT,
    status ENUM('draft','sent','approved','rejected','converted') DEFAULT 'draft',
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    INDEX idx_number (estimate_number),
    INDEX idx_date (estimate_date),
    INDEX idx_status (status)
);

CREATE TABLE estimate_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    estimate_id INT NOT NULL,
    product_id INT NOT NULL,
    item_description VARCHAR(255),
    quantity DECIMAL(10,2) NOT NULL,
    area DECIMAL(10,2),
    mix_info TEXT,
    unit_price DECIMAL(10,2) NOT NULL,
    breakdown_cost TEXT,
    color_cost DECIMAL(10,2) DEFAULT 0,
    line_total DECIMAL(12,2) NOT NULL,
    display_order INT DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

INSERT INTO brands (name) VALUES 
    ('Asian Paints'),
    ('Berger Paints'),
    ('Nerolac'),
    ('Dulux'),
    ('Birla Opus');

INSERT INTO categories (name,description) VALUES 
    ('Interior Paints','Wall paints for interior'),
    ('Exterior Paints','Weather-resistant paints'),
    ('Primers','Base coats and primers'),
    ('Wood Finishes','Varnish and protection'),
    ('Accessories','Rollers, brushes, tools');

INSERT INTO products (brand_id,category_id,name,description,product_type,area_coverage,available_sizes,base_price,gst_percentage) VALUES 
    (5,3,'All Dry Wall N Roof 10','Birla Opus WaterProof Primer','area_wise',20.0,'[1,4,10,20]',280.00,18.00),
    (1,1,'Calista Pro White Primer','Birla Opus Interior Primer','area_wise',20.7,'[1,20]',2680.00,18.00),
    (1,1,'Calista Ever Clear Matt','Birla opus Premium Interior emulsion','area_wise',11.7,'[1,10]',3161.00,18.00),
    (1,3,'All Dry Total 2k - 3kg','Birla opus ALL Dry total 2k','unit_wise',null,'[1]',1760.00,18.00),
    (1,3,'All Dry Crack Master Paste 1kg','All Dry Crack Master Paste 1kg','unit_wise',null,'[1]',320.00,18.00),
    (1,5,'Interior Roller','padmashn interior roller','unit_wise',null,'[1]',250.00,18.00),
    (1,5,'Exterior Roller','padmashn exterior roller','unit_wise',null,'[1]',250.00,18.00),
    (1,5,'Brush 4 inch','padmashn brush','unit_wise',null,'[1]',250.00,18.00);

CREATE USER IF NOT EXISTS 'qc_admin'@'localhost' IDENTIFIED BY 'QC@dm1n2026!Secure';
GRANT ALL PRIVILEGES ON qc_business_manager.* TO 'qc_admin'@'localhost';
FLUSH PRIVILEGES;