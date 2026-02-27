# QC Painters Dedicated App — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated Android app for painters with product catalog (images + offers), training hub, shop attendance, push notifications, and Tamil/English language support.

**Architecture:** WebView Android app (new "painter" build flavor) + enhanced painter web pages on existing Express.js backend. Same DB, same APIs, new pages and endpoints.

**Tech Stack:** Kotlin (Android), Express.js, MySQL, Multer (uploads), Firebase FCM, Tailwind CSS, vanilla JS

**Design Doc:** `docs/plans/2026-02-28-painter-dedicated-app-design.md`

---

## Phase 1: Database & Backend Foundation

### Task 1: Migration — New Tables & Column Additions

**Files:**
- Create: `migrations/migrate-painter-app.js`

**Step 1: Write migration script**

```javascript
// migrations/migrate-painter-app.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const migrations = [
    // 1. Special offers table
    `CREATE TABLE IF NOT EXISTS painter_special_offers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      title_ta VARCHAR(255),
      description TEXT,
      description_ta TEXT,
      offer_type ENUM('multiplier','bonus_points','free_product','discount') NOT NULL DEFAULT 'multiplier',
      multiplier_value DECIMAL(4,2) DEFAULT 1.00,
      bonus_points DECIMAL(12,2) DEFAULT 0,
      applies_to ENUM('all','brand','category','product') NOT NULL DEFAULT 'all',
      target_id VARCHAR(100) DEFAULT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_active TINYINT(1) DEFAULT 1,
      banner_image_url VARCHAR(500),
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_active_dates (is_active, start_date, end_date),
      INDEX idx_applies_to (applies_to, target_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // 2. Painter FCM tokens table
    `CREATE TABLE IF NOT EXISTS painter_fcm_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      painter_id INT NOT NULL,
      fcm_token VARCHAR(500) NOT NULL,
      device_info VARCHAR(255),
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY idx_token (fcm_token),
      INDEX idx_painter (painter_id),
      FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // 3. Painter notifications table (separate from staff notifications)
    `CREATE TABLE IF NOT EXISTS painter_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      painter_id INT NOT NULL,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      title_ta VARCHAR(255),
      body TEXT,
      body_ta TEXT,
      data JSON,
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_painter_read (painter_id, is_read),
      INDEX idx_created (created_at),
      FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // 4. Painter training content table (extends guides pattern)
    `CREATE TABLE IF NOT EXISTS painter_training_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      name_ta VARCHAR(100),
      icon VARCHAR(10) DEFAULT '📄',
      sort_order INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS painter_training_content (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT,
      title VARCHAR(255) NOT NULL,
      title_ta VARCHAR(255),
      content_type ENUM('article','video','pdf') NOT NULL DEFAULT 'article',
      content_en LONGTEXT,
      content_ta LONGTEXT,
      summary VARCHAR(500),
      summary_ta VARCHAR(500),
      youtube_url VARCHAR(500),
      pdf_url VARCHAR(500),
      thumbnail_url VARCHAR(500),
      language ENUM('en','ta','both') DEFAULT 'both',
      is_featured TINYINT(1) DEFAULT 0,
      status ENUM('draft','published','archived') DEFAULT 'draft',
      view_count INT DEFAULT 0,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (category_id),
      INDEX idx_status (status),
      INDEX idx_featured (is_featured, status),
      FOREIGN KEY (category_id) REFERENCES painter_training_categories(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // 5. Add image_url to zoho_items_map (for product catalog images)
    `ALTER TABLE zoho_items_map ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) DEFAULT NULL AFTER zoho_category_name`,

    // 6. Enhance painter_attendance table
    `ALTER TABLE painter_attendance ADD COLUMN IF NOT EXISTS check_in_photo_url VARCHAR(500) DEFAULT NULL AFTER check_out_at`,
    `ALTER TABLE painter_attendance ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8) DEFAULT NULL AFTER check_in_photo_url`,
    `ALTER TABLE painter_attendance ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8) DEFAULT NULL AFTER latitude`,
    `ALTER TABLE painter_attendance ADD COLUMN IF NOT EXISTS distance_from_shop INT DEFAULT NULL AFTER longitude`,
    `ALTER TABLE painter_attendance ADD COLUMN IF NOT EXISTS branch_id INT DEFAULT NULL AFTER distance_from_shop`,

    // 7. Default training categories
    `INSERT IGNORE INTO painter_training_categories (name, name_ta, icon, sort_order) VALUES
      ('Products', 'தயாரிப்புகள்', '🎨', 1),
      ('Techniques', 'நுட்பங்கள்', '🖌️', 2),
      ('Color Guide', 'நிற வழிகாட்டி', '🌈', 3),
      ('Videos', 'வீடியோக்கள்', '🎥', 4),
      ('Safety', 'பாதுகாப்பு', '⚠️', 5)`,

    // 8. Config entries for painter app
    `INSERT IGNORE INTO ai_config (config_key, config_value) VALUES
      ('painter_attendance_geofence_radius', '100'),
      ('painter_attendance_daily_points', '5'),
      ('painter_attendance_photo_required', 'false'),
      ('painter_training_enabled', 'true'),
      ('painter_offers_enabled', 'true'),
      ('painter_fcm_enabled', 'true'),
      ('painter_attendance_reminder_enabled', 'true')`
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
      console.log('OK:', sql.substring(0, 60) + '...');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_ENTRY' || err.message.includes('Duplicate column')) {
        console.log('SKIP (already exists):', sql.substring(0, 60) + '...');
      } else {
        console.error('FAIL:', err.message);
      }
    }
  }

  console.log('\nPainter app migration complete.');
  await pool.end();
}

migrate().catch(console.error);
```

**Step 2: Run migration locally**

Run: `node migrations/migrate-painter-app.js`
Expected: All OK messages, tables created

**Step 3: Commit**

```bash
git add migrations/migrate-painter-app.js
git commit -m "feat: add painter app migration — offers, FCM, training, attendance columns"
```

---

### Task 2: Upload Config for Product Images & Offer Banners

**Files:**
- Modify: `config/uploads.js`

**Step 1: Add product image and offer banner upload configs**

Add to `config/uploads.js` after existing upload configs:

```javascript
// Product images (for painter catalog)
const uploadProductImage = multer({
    storage: createDiskStorage('public/uploads/products/', 'product'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Offer banners
const uploadOfferBanner = multer({
    storage: createDiskStorage('public/uploads/offers/', 'offer'),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: imageFilter
});

// Training content thumbnails and PDFs
const uploadTraining = multer({
    storage: createDiskStorage('public/uploads/training/', 'training'),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|pdf/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext && mime);
    }
});

// Painter attendance photos
const uploadPainterAttendance = multer({
    storage: createDiskStorage('public/uploads/painter-attendance/', 'checkin'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});
```

Export all new configs.

**Step 2: Create upload directories**

```bash
mkdir -p public/uploads/products public/uploads/offers public/uploads/training public/uploads/painter-attendance
```

**Step 3: Commit**

```bash
git add config/uploads.js
git commit -m "feat: add upload configs for product images, offers, training, painter attendance"
```

---

### Task 3: Painter Notification Service

**Files:**
- Create: `services/painter-notification-service.js`

**Step 1: Create notification service**

```javascript
// services/painter-notification-service.js
// Handles FCM push + in-app notifications for painters

let pool, io;

function setDependencies(p, socketIO) {
  pool = p;
  io = socketIO;
}

// Send notification to single painter
async function sendToPainter(painterId, { type, title, title_ta, body, body_ta, data }) {
  // 1. Store in painter_notifications table
  const [result] = await pool.query(
    `INSERT INTO painter_notifications (painter_id, type, title, title_ta, body, body_ta, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [painterId, type, title, title_ta || null, body, body_ta || null, data ? JSON.stringify(data) : null]
  );

  // 2. Emit via Socket.io
  if (io) {
    io.to(`painter_${painterId}`).emit('painter_notification', {
      id: result.insertId, type, title, body, data
    });
  }

  // 3. Send FCM push
  await sendFCM(painterId, { title, body, type, data });

  return result.insertId;
}

// Send notification to all painters
async function sendToAll({ type, title, title_ta, body, body_ta, data }) {
  const [painters] = await pool.query('SELECT id FROM painters WHERE status = ?', ['approved']);
  const results = [];
  for (const p of painters) {
    try {
      const id = await sendToPainter(p.id, { type, title, title_ta, body, body_ta, data });
      results.push({ painterId: p.id, notificationId: id });
    } catch (err) {
      console.error(`Failed to notify painter ${p.id}:`, err.message);
    }
  }
  return results;
}

// FCM push via HTTP v1
async function sendFCM(painterId, { title, body, type, data }) {
  const [tokens] = await pool.query(
    'SELECT fcm_token FROM painter_fcm_tokens WHERE painter_id = ? AND is_active = 1',
    [painterId]
  );
  if (tokens.length === 0) return;

  const serverKey = process.env.FIREBASE_SERVER_KEY;
  if (!serverKey) return;

  for (const { fcm_token } of tokens) {
    try {
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Authorization': `key=${serverKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: fcm_token,
          notification: { title, body },
          data: { type, ...data }
        })
      });
      const result = await response.json();
      // Remove invalid tokens
      if (result.failure > 0 && result.results) {
        for (const r of result.results) {
          if (r.error === 'NotRegistered' || r.error === 'InvalidRegistration') {
            await pool.query('UPDATE painter_fcm_tokens SET is_active = 0 WHERE fcm_token = ?', [fcm_token]);
          }
        }
      }
    } catch (err) {
      console.error('FCM send error:', err.message);
    }
  }
}

// Get painter's notifications
async function getNotifications(painterId, { limit = 20, offset = 0, unreadOnly = false } = {}) {
  let sql = 'SELECT * FROM painter_notifications WHERE painter_id = ?';
  const params = [painterId];
  if (unreadOnly) {
    sql += ' AND is_read = 0';
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const [rows] = await pool.query(sql, params);

  const [countResult] = await pool.query(
    'SELECT COUNT(*) as total FROM painter_notifications WHERE painter_id = ? AND is_read = 0',
    [painterId]
  );

  return { notifications: rows, unreadCount: countResult[0].total };
}

// Mark as read
async function markRead(painterId, notificationId) {
  if (notificationId === 'all') {
    await pool.query('UPDATE painter_notifications SET is_read = 1 WHERE painter_id = ?', [painterId]);
  } else {
    await pool.query('UPDATE painter_notifications SET is_read = 1 WHERE id = ? AND painter_id = ?', [notificationId, painterId]);
  }
}

module.exports = { setDependencies, sendToPainter, sendToAll, getNotifications, markRead };
```

**Step 2: Commit**

```bash
git add services/painter-notification-service.js
git commit -m "feat: add painter notification service — FCM push + in-app notifications"
```

---

### Task 4: i18n Translation Files

**Files:**
- Create: `public/i18n/painter-en.json`
- Create: `public/i18n/painter-ta.json`
- Create: `public/js/painter-i18n.js`

**Step 1: Create English translations**

```json
{
  "common": {
    "home": "Home",
    "catalog": "Catalog",
    "estimate": "Estimate",
    "training": "Training",
    "attendance": "Attendance",
    "back": "Back",
    "search": "Search",
    "filter": "Filter",
    "loading": "Loading...",
    "no_data": "No data available",
    "save": "Save",
    "cancel": "Cancel",
    "submit": "Submit",
    "logout": "Logout",
    "points": "Points",
    "pts": "pts"
  },
  "dashboard": {
    "welcome": "Welcome",
    "regular_points": "Regular Points",
    "annual_points": "Annual Points",
    "total_earned": "Total Earned",
    "referrals": "Referrals",
    "withdraw": "Withdraw",
    "recent_transactions": "Recent Transactions",
    "active_offers": "Active Offers",
    "my_estimates": "My Estimates",
    "no_transactions": "No transactions yet",
    "share_referral": "Share Referral Code",
    "quick_actions": "Quick Actions"
  },
  "catalog": {
    "title": "Product Catalog",
    "all_brands": "All Brands",
    "all_categories": "All Categories",
    "special_offers": "Special Offers",
    "your_incentives": "Your Incentives",
    "regular_points_per_unit": "Regular Points per Unit",
    "annual_eligible": "Annual Eligible",
    "current_offer": "Current Offer",
    "create_estimate": "Create Estimate",
    "product_details": "Product Details",
    "mrp": "MRP",
    "available_sizes": "Available Sizes",
    "in_stock": "In Stock",
    "low_stock": "Low Stock",
    "out_of_stock": "Out of Stock",
    "no_products": "No products found"
  },
  "training": {
    "title": "Training Hub",
    "featured_videos": "Featured Videos",
    "guides_articles": "Guides & Articles",
    "download_pdf": "Download PDF",
    "read_more": "Read More",
    "watch_video": "Watch Video",
    "no_content": "No training content available"
  },
  "attendance": {
    "title": "Shop Attendance",
    "today": "Today",
    "not_checked_in": "Not Checked In",
    "checked_in": "Checked In",
    "check_in_now": "Check In Now",
    "check_out": "Check Out",
    "points_today": "Points Today",
    "this_month": "This Month",
    "visits": "Visits",
    "recent_visits": "Recent Visits",
    "location_required": "Location access required",
    "too_far": "You are too far from the shop",
    "already_checked_in": "Already checked in today",
    "check_in_success": "Check-in successful!"
  },
  "notifications": {
    "title": "Notifications",
    "mark_all_read": "Mark All Read",
    "no_notifications": "No notifications"
  }
}
```

**Step 2: Create Tamil translations**

```json
{
  "common": {
    "home": "முகப்பு",
    "catalog": "தயாரிப்புகள்",
    "estimate": "மதிப்பீடு",
    "training": "பயிற்சி",
    "attendance": "வருகை",
    "back": "பின்",
    "search": "தேடு",
    "filter": "வடிகட்டு",
    "loading": "ஏற்றுகிறது...",
    "no_data": "தரவு இல்லை",
    "save": "சேமி",
    "cancel": "ரத்து",
    "submit": "சமர்ப்பி",
    "logout": "வெளியேறு",
    "points": "புள்ளிகள்",
    "pts": "புள்ளிகள்"
  },
  "dashboard": {
    "welcome": "வரவேற்கிறோம்",
    "regular_points": "வழக்கமான புள்ளிகள்",
    "annual_points": "வருடாந்திர புள்ளிகள்",
    "total_earned": "மொத்தம் பெற்றது",
    "referrals": "பரிந்துரைகள்",
    "withdraw": "திரும்பப் பெறு",
    "recent_transactions": "சமீபத்திய பரிவர்த்தனைகள்",
    "active_offers": "செயலில் சலுகைகள்",
    "my_estimates": "எனது மதிப்பீடுகள்",
    "no_transactions": "பரிவர்த்தனைகள் இல்லை",
    "share_referral": "பரிந்துரை குறியீட்டை பகிரு",
    "quick_actions": "விரைவு செயல்கள்"
  },
  "catalog": {
    "title": "தயாரிப்பு பட்டியல்",
    "all_brands": "அனைத்து பிராண்டுகள்",
    "all_categories": "அனைத்து வகைகள்",
    "special_offers": "சிறப்பு சலுகைகள்",
    "your_incentives": "உங்கள் சலுகைகள்",
    "regular_points_per_unit": "ஒரு யூனிட்டுக்கு புள்ளிகள்",
    "annual_eligible": "வருடாந்திர தகுதி",
    "current_offer": "நடப்பு சலுகை",
    "create_estimate": "மதிப்பீடு உருவாக்கு",
    "product_details": "தயாரிப்பு விவரங்கள்",
    "mrp": "MRP",
    "available_sizes": "கிடைக்கும் அளவுகள்",
    "in_stock": "கையிருப்பில்",
    "low_stock": "குறைந்த கையிருப்பு",
    "out_of_stock": "கையிருப்பில் இல்லை",
    "no_products": "தயாரிப்புகள் இல்லை"
  },
  "training": {
    "title": "பயிற்சி மையம்",
    "featured_videos": "சிறப்பு வீடியோக்கள்",
    "guides_articles": "வழிகாட்டிகள் & கட்டுரைகள்",
    "download_pdf": "PDF பதிவிறக்கம்",
    "read_more": "மேலும் படிக்க",
    "watch_video": "வீடியோ பார்",
    "no_content": "பயிற்சி உள்ளடக்கம் இல்லை"
  },
  "attendance": {
    "title": "கடை வருகை",
    "today": "இன்று",
    "not_checked_in": "உள்நுழையவில்லை",
    "checked_in": "உள்நுழைந்தது",
    "check_in_now": "இப்போது உள்நுழை",
    "check_out": "வெளியேறு",
    "points_today": "இன்றைய புள்ளிகள்",
    "this_month": "இந்த மாதம்",
    "visits": "வருகைகள்",
    "recent_visits": "சமீபத்திய வருகைகள்",
    "location_required": "இருப்பிட அணுகல் தேவை",
    "too_far": "நீங்கள் கடையிலிருந்து மிகத் தொலைவில் உள்ளீர்கள்",
    "already_checked_in": "இன்று ஏற்கனவே உள்நுழைந்துள்ளீர்கள்",
    "check_in_success": "உள்நுழைவு வெற்றி!"
  },
  "notifications": {
    "title": "அறிவிப்புகள்",
    "mark_all_read": "அனைத்தையும் படித்தது எனக் குறி",
    "no_notifications": "அறிவிப்புகள் இல்லை"
  }
}
```

**Step 3: Create i18n loader script**

```javascript
// public/js/painter-i18n.js
(function() {
  const STORAGE_KEY = 'painter_lang';
  let translations = {};
  let currentLang = localStorage.getItem(STORAGE_KEY) || 'ta'; // Default Tamil

  async function loadTranslations(lang) {
    try {
      const res = await fetch(`/i18n/painter-${lang}.json`);
      translations = await res.json();
      currentLang = lang;
      localStorage.setItem(STORAGE_KEY, lang);
      applyTranslations();
    } catch (err) {
      console.error('Failed to load translations:', err);
    }
  }

  function t(key) {
    const keys = key.split('.');
    let val = translations;
    for (const k of keys) {
      val = val?.[k];
    }
    return val || key;
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      if (translated !== key) {
        if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
          el.placeholder = translated;
        } else {
          el.textContent = translated;
        }
      }
    });
    // Update toggle button
    const toggleBtn = document.getElementById('langToggle');
    if (toggleBtn) {
      toggleBtn.textContent = currentLang === 'ta' ? 'EN' : 'தமிழ்';
    }
  }

  function toggleLanguage() {
    loadTranslations(currentLang === 'ta' ? 'en' : 'ta');
  }

  function getLang() { return currentLang; }

  // Auto-load on script include
  loadTranslations(currentLang);

  window.painterI18n = { t, loadTranslations, toggleLanguage, getLang };
})();
```

**Step 4: Commit**

```bash
git add public/i18n/ public/js/painter-i18n.js
git commit -m "feat: add Tamil/English i18n system for painter app"
```

---

## Phase 2: Backend API Endpoints

### Task 5: Product Catalog API

**Files:**
- Modify: `routes/painters.js` — Add catalog endpoints after existing `/me/estimates/products`

**Step 1: Add catalog endpoints**

Add these routes in `routes/painters.js` (after existing painter-auth routes, before admin routes):

```javascript
// ============ CATALOG ============

// GET /api/painters/me/catalog — Browse products with images, points, offers
router.get('/me/catalog', requirePainterAuth, async (req, res) => {
  try {
    const { search, brand, category, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `SELECT zim.zoho_item_id as item_id, zim.zoho_item_name as name,
      zim.zoho_brand as brand, zim.zoho_category_name as category,
      zim.zoho_rate as mrp, zim.image_url,
      zim.zoho_stock_on_hand as stock,
      ppr.regular_points_per_unit, ppr.annual_eligible, ppr.annual_pct
      FROM zoho_items_map zim
      LEFT JOIN painter_product_point_rates ppr ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
      WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)`;
    const params = [];

    if (search) {
      sql += ` AND (zim.zoho_item_name LIKE ? OR zim.zoho_brand LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (brand) {
      sql += ` AND zim.zoho_brand = ?`;
      params.push(brand);
    }
    if (category) {
      sql += ` AND zim.zoho_category_name = ?`;
      params.push(category);
    }

    sql += ` ORDER BY zim.zoho_brand, zim.zoho_item_name LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [products] = await pool.query(sql, params);

    // Get active offers
    const [offers] = await pool.query(
      `SELECT * FROM painter_special_offers WHERE is_active = 1 AND start_date <= CURDATE() AND end_date >= CURDATE() ORDER BY created_at DESC`
    );

    // Map offers to products
    const offerMap = {};
    for (const offer of offers) {
      if (offer.applies_to === 'all') {
        offerMap['_all'] = offer;
      } else {
        offerMap[`${offer.applies_to}_${offer.target_id}`] = offer;
      }
    }

    const productsWithOffers = products.map(p => {
      const productOffer = offerMap[`product_${p.item_id}`]
        || offerMap[`brand_${p.brand}`]
        || offerMap[`category_${p.category}`]
        || offerMap['_all']
        || null;
      return { ...p, offer: productOffer };
    });

    // Get filter options
    const [brands] = await pool.query(
      `SELECT DISTINCT zoho_brand FROM zoho_items_map WHERE zoho_brand IS NOT NULL AND zoho_brand != '' AND (zoho_status = 'active' OR zoho_status IS NULL) ORDER BY zoho_brand`
    );
    const [categories] = await pool.query(
      `SELECT DISTINCT zoho_category_name FROM zoho_items_map WHERE zoho_category_name IS NOT NULL AND zoho_category_name != '' AND (zoho_status = 'active' OR zoho_status IS NULL) ORDER BY zoho_category_name`
    );

    res.json({
      success: true,
      products: productsWithOffers,
      offers: offers.filter(o => o.banner_image_url),
      brands: brands.map(b => b.zoho_brand),
      categories: categories.map(c => c.zoho_category_name)
    });
  } catch (err) {
    console.error('Catalog error:', err);
    res.status(500).json({ success: false, message: 'Failed to load catalog' });
  }
});

// GET /api/painters/me/catalog/:itemId — Product detail
router.get('/me/catalog/:itemId', requirePainterAuth, async (req, res) => {
  try {
    const [products] = await pool.query(
      `SELECT zim.*, ppr.regular_points_per_unit, ppr.annual_eligible, ppr.annual_pct
       FROM zoho_items_map zim
       LEFT JOIN painter_product_point_rates ppr ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
       WHERE zim.zoho_item_id = ?`,
      [req.params.itemId]
    );
    if (products.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Active offers for this product
    const product = products[0];
    const [offers] = await pool.query(
      `SELECT * FROM painter_special_offers
       WHERE is_active = 1 AND start_date <= CURDATE() AND end_date >= CURDATE()
       AND (applies_to = 'all'
         OR (applies_to = 'product' AND target_id = ?)
         OR (applies_to = 'brand' AND target_id = ?)
         OR (applies_to = 'category' AND target_id = ?))`,
      [product.zoho_item_id, product.zoho_brand, product.zoho_category_name]
    );

    res.json({ success: true, product, offers });
  } catch (err) {
    console.error('Product detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load product' });
  }
});

// GET /api/painters/me/offers — Active offers list
router.get('/me/offers', requirePainterAuth, async (req, res) => {
  try {
    const [offers] = await pool.query(
      `SELECT * FROM painter_special_offers WHERE is_active = 1 AND start_date <= CURDATE() AND end_date >= CURDATE() ORDER BY created_at DESC`
    );
    res.json({ success: true, offers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load offers' });
  }
});
```

**Step 2: Commit**

```bash
git add routes/painters.js
git commit -m "feat: add painter catalog API — products with images, points, offers"
```

---

### Task 6: Training Hub API

**Files:**
- Modify: `routes/painters.js` — Add training endpoints

**Step 1: Add training endpoints**

```javascript
// ============ TRAINING ============

// GET /api/painters/me/training — List training content
router.get('/me/training', requirePainterAuth, async (req, res) => {
  try {
    const { category, type, search } = req.query;
    const lang = req.query.lang || 'both';

    let sql = `SELECT tc.*, cat.name as category_name, cat.name_ta as category_name_ta, cat.icon as category_icon
      FROM painter_training_content tc
      LEFT JOIN painter_training_categories cat ON tc.category_id = cat.id
      WHERE tc.status = 'published'`;
    const params = [];

    if (category) {
      sql += ` AND tc.category_id = ?`;
      params.push(category);
    }
    if (type) {
      sql += ` AND tc.content_type = ?`;
      params.push(type);
    }
    if (search) {
      sql += ` AND (tc.title LIKE ? OR tc.title_ta LIKE ? OR tc.summary LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY tc.is_featured DESC, tc.created_at DESC`;
    const [content] = await pool.query(sql, params);

    const [categories] = await pool.query(
      'SELECT * FROM painter_training_categories WHERE is_active = 1 ORDER BY sort_order'
    );

    res.json({ success: true, content, categories });
  } catch (err) {
    console.error('Training list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load training content' });
  }
});

// GET /api/painters/me/training/:id — Single training content
router.get('/me/training/:id', requirePainterAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT tc.*, cat.name as category_name, cat.name_ta as category_name_ta
       FROM painter_training_content tc
       LEFT JOIN painter_training_categories cat ON tc.category_id = cat.id
       WHERE tc.id = ? AND tc.status = 'published'`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }
    // Increment view count
    await pool.query('UPDATE painter_training_content SET view_count = view_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true, content: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load content' });
  }
});
```

**Step 2: Commit**

```bash
git add routes/painters.js
git commit -m "feat: add painter training hub API"
```

---

### Task 7: Shop Attendance API

**Files:**
- Modify: `routes/painters.js` — Add attendance endpoints

**Step 1: Add attendance endpoints**

```javascript
// ============ ATTENDANCE ============

// GET /api/painters/me/attendance/today — Today's check-in status
router.get('/me/attendance/today', requirePainterAuth, async (req, res) => {
  try {
    const painterId = req.painter.id;
    const [rows] = await pool.query(
      `SELECT * FROM painter_attendance WHERE painter_id = ? AND DATE(check_in_at) = CURDATE() ORDER BY check_in_at DESC LIMIT 1`,
      [painterId]
    );
    const checkedIn = rows.length > 0;
    res.json({
      success: true,
      checked_in: checkedIn,
      attendance: checkedIn ? rows[0] : null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to check attendance' });
  }
});

// POST /api/painters/me/attendance/check-in — GPS + photo check-in
router.post('/me/attendance/check-in', requirePainterAuth, uploadPainterAttendance.single('photo'), async (req, res) => {
  try {
    const painterId = req.painter.id;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Location is required' });
    }

    // Check if already checked in today
    const [existing] = await pool.query(
      `SELECT id FROM painter_attendance WHERE painter_id = ? AND DATE(check_in_at) = CURDATE()`,
      [painterId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Already checked in today' });
    }

    // Get nearest branch geofence
    const [branches] = await pool.query(
      `SELECT id, name, latitude as shop_lat, longitude as shop_lng, geo_fence_radius FROM branches WHERE is_active = 1 AND latitude IS NOT NULL`
    );

    let nearestBranch = null;
    let minDistance = Infinity;

    for (const branch of branches) {
      const dist = haversineDistance(
        parseFloat(latitude), parseFloat(longitude),
        parseFloat(branch.shop_lat), parseFloat(branch.shop_lng)
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearestBranch = branch;
      }
    }

    const maxRadius = nearestBranch
      ? (nearestBranch.geo_fence_radius || 100)
      : 100;

    if (!nearestBranch || minDistance > maxRadius) {
      return res.status(400).json({
        success: false,
        message: `You are ${Math.round(minDistance)}m from the nearest shop. Must be within ${maxRadius}m.`,
        distance: Math.round(minDistance)
      });
    }

    // Award points
    const [config] = await pool.query(
      "SELECT config_value FROM ai_config WHERE config_key = 'painter_attendance_daily_points'"
    );
    const dailyPoints = config.length > 0 ? parseFloat(config[0].config_value) : 5;

    const photoUrl = req.file ? `/uploads/painter-attendance/${req.file.filename}` : null;

    const [result] = await pool.query(
      `INSERT INTO painter_attendance (painter_id, check_in_at, check_in_photo_url, latitude, longitude, distance_from_shop, branch_id, points_awarded)
       VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)`,
      [painterId, photoUrl, latitude, longitude, Math.round(minDistance), nearestBranch.id, dailyPoints]
    );

    // Award points via points engine
    const pointsEngine = require('./painter-points-engine-ref'); // Will wire in server.js
    if (pointsEngine && pointsEngine.awardAttendancePoints) {
      await pointsEngine.awardAttendancePoints(painterId, result.insertId);
    }

    res.json({
      success: true,
      message: `Checked in! ${dailyPoints} points earned.`,
      attendance: { id: result.insertId, branch: nearestBranch.name, distance: Math.round(minDistance), points: dailyPoints }
    });
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ success: false, message: 'Check-in failed' });
  }
});

// GET /api/painters/me/attendance/monthly — Monthly calendar data
router.get('/me/attendance/monthly', requirePainterAuth, async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();

    const [rows] = await pool.query(
      `SELECT DATE(check_in_at) as date, points_awarded, branch_id,
        TIME(check_in_at) as check_in_time
       FROM painter_attendance
       WHERE painter_id = ? AND MONTH(check_in_at) = ? AND YEAR(check_in_at) = ?
       ORDER BY check_in_at`,
      [req.painter.id, m, y]
    );

    const totalVisits = rows.length;
    const totalPoints = rows.reduce((sum, r) => sum + (r.points_awarded || 0), 0);

    res.json({ success: true, visits: rows, totalVisits, totalPoints });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load attendance' });
  }
});

// Haversine distance helper (meters)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

**Step 2: Commit**

```bash
git add routes/painters.js
git commit -m "feat: add painter shop attendance API with GPS geofence"
```

---

### Task 8: Notification & FCM Endpoints

**Files:**
- Modify: `routes/painters.js` — Add notification + FCM token endpoints

**Step 1: Add notification endpoints**

```javascript
// ============ NOTIFICATIONS ============

// POST /api/painters/me/fcm/register — Register FCM token
router.post('/me/fcm/register', requirePainterAuth, async (req, res) => {
  try {
    const { fcm_token, device_info } = req.body;
    if (!fcm_token) return res.status(400).json({ success: false, message: 'FCM token required' });

    await pool.query(
      `INSERT INTO painter_fcm_tokens (painter_id, fcm_token, device_info) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE painter_id = VALUES(painter_id), device_info = VALUES(device_info), is_active = 1, updated_at = NOW()`,
      [req.painter.id, fcm_token, device_info || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to register token' });
  }
});

// DELETE /api/painters/me/fcm/unregister
router.delete('/me/fcm/unregister', requirePainterAuth, async (req, res) => {
  try {
    const { fcm_token } = req.body;
    await pool.query('UPDATE painter_fcm_tokens SET is_active = 0 WHERE fcm_token = ?', [fcm_token]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to unregister' });
  }
});

// GET /api/painters/me/notifications
router.get('/me/notifications', requirePainterAuth, async (req, res) => {
  try {
    const { limit = 20, offset = 0, unread } = req.query;
    const result = await painterNotificationService.getNotifications(req.painter.id, {
      limit: parseInt(limit), offset: parseInt(offset), unreadOnly: unread === '1'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
});

// PUT /api/painters/me/notifications/:id/read
router.put('/me/notifications/:id/read', requirePainterAuth, async (req, res) => {
  try {
    await painterNotificationService.markRead(req.painter.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark read' });
  }
});
```

**Step 2: Commit**

```bash
git add routes/painters.js
git commit -m "feat: add painter notifications + FCM registration endpoints"
```

---

### Task 9: Admin Endpoints — Offers, Training, Product Images

**Files:**
- Modify: `routes/painters.js` — Add admin CRUD for offers and training

**Step 1: Add admin offer CRUD endpoints**

```javascript
// ============ ADMIN: OFFERS ============

// GET /api/painters/offers — List all offers (admin)
router.get('/offers', requireAuth, requirePermission('painters.manage'), async (req, res) => {
  const [offers] = await pool.query('SELECT * FROM painter_special_offers ORDER BY created_at DESC');
  res.json({ success: true, offers });
});

// POST /api/painters/offers — Create offer
router.post('/offers', requireAuth, requirePermission('painters.manage'), uploadOfferBanner.single('banner'), async (req, res) => {
  const { title, title_ta, description, description_ta, offer_type, multiplier_value, bonus_points, applies_to, target_id, start_date, end_date } = req.body;
  const banner_image_url = req.file ? `/uploads/offers/${req.file.filename}` : null;
  const [result] = await pool.query(
    `INSERT INTO painter_special_offers (title, title_ta, description, description_ta, offer_type, multiplier_value, bonus_points, applies_to, target_id, start_date, end_date, banner_image_url, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, title_ta, description, description_ta, offer_type, multiplier_value || 1, bonus_points || 0, applies_to, target_id, start_date, end_date, banner_image_url, req.user.id]
  );
  res.json({ success: true, id: result.insertId });
});

// PUT /api/painters/offers/:id — Update offer
router.put('/offers/:id', requireAuth, requirePermission('painters.manage'), uploadOfferBanner.single('banner'), async (req, res) => {
  const { title, title_ta, description, description_ta, offer_type, multiplier_value, bonus_points, applies_to, target_id, start_date, end_date, is_active } = req.body;
  let sql = `UPDATE painter_special_offers SET title=?, title_ta=?, description=?, description_ta=?, offer_type=?, multiplier_value=?, bonus_points=?, applies_to=?, target_id=?, start_date=?, end_date=?, is_active=?`;
  const params = [title, title_ta, description, description_ta, offer_type, multiplier_value, bonus_points, applies_to, target_id, start_date, end_date, is_active ?? 1];
  if (req.file) {
    sql += `, banner_image_url=?`;
    params.push(`/uploads/offers/${req.file.filename}`);
  }
  sql += ` WHERE id=?`;
  params.push(req.params.id);
  await pool.query(sql, params);
  res.json({ success: true });
});

// DELETE /api/painters/offers/:id
router.delete('/offers/:id', requireAuth, requirePermission('painters.manage'), async (req, res) => {
  await pool.query('DELETE FROM painter_special_offers WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ============ ADMIN: TRAINING ============

// GET /api/painters/training — List all training content (admin)
router.get('/training', requireAuth, requirePermission('painters.manage'), async (req, res) => {
  const [content] = await pool.query(
    `SELECT tc.*, cat.name as category_name FROM painter_training_content tc
     LEFT JOIN painter_training_categories cat ON tc.category_id = cat.id ORDER BY tc.created_at DESC`
  );
  const [categories] = await pool.query('SELECT * FROM painter_training_categories ORDER BY sort_order');
  res.json({ success: true, content, categories });
});

// POST /api/painters/training — Create training content
router.post('/training', requireAuth, requirePermission('painters.manage'), uploadTraining.single('file'), async (req, res) => {
  const { title, title_ta, category_id, content_type, content_en, content_ta, summary, summary_ta, youtube_url, language, is_featured } = req.body;
  let pdf_url = null, thumbnail_url = null;
  if (req.file) {
    const filePath = `/uploads/training/${req.file.filename}`;
    if (content_type === 'pdf') pdf_url = filePath;
    else thumbnail_url = filePath;
  }
  const [result] = await pool.query(
    `INSERT INTO painter_training_content (title, title_ta, category_id, content_type, content_en, content_ta, summary, summary_ta, youtube_url, pdf_url, thumbnail_url, language, is_featured, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
    [title, title_ta, category_id, content_type, content_en, content_ta, summary, summary_ta, youtube_url, pdf_url, thumbnail_url, language || 'both', is_featured || 0, req.user.id]
  );
  res.json({ success: true, id: result.insertId });
});

// PUT /api/painters/training/:id — Update training content
router.put('/training/:id', requireAuth, requirePermission('painters.manage'), uploadTraining.single('file'), async (req, res) => {
  const { title, title_ta, category_id, content_type, content_en, content_ta, summary, summary_ta, youtube_url, language, is_featured, status } = req.body;
  let updates = 'title=?, title_ta=?, category_id=?, content_type=?, content_en=?, content_ta=?, summary=?, summary_ta=?, youtube_url=?, language=?, is_featured=?, status=?';
  const params = [title, title_ta, category_id, content_type, content_en, content_ta, summary, summary_ta, youtube_url, language, is_featured || 0, status || 'published'];
  if (req.file) {
    const filePath = `/uploads/training/${req.file.filename}`;
    if (content_type === 'pdf') { updates += ', pdf_url=?'; params.push(filePath); }
    else { updates += ', thumbnail_url=?'; params.push(filePath); }
  }
  params.push(req.params.id);
  await pool.query(`UPDATE painter_training_content SET ${updates} WHERE id=?`, params);
  res.json({ success: true });
});

// DELETE /api/painters/training/:id
router.delete('/training/:id', requireAuth, requirePermission('painters.manage'), async (req, res) => {
  await pool.query('DELETE FROM painter_training_content WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ============ ADMIN: PRODUCT IMAGES ============

// POST /api/painters/products/:itemId/image — Upload product image
router.post('/products/:itemId/image', requireAuth, requirePermission('painters.manage'), uploadProductImage.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
  const imageUrl = `/uploads/products/${req.file.filename}`;
  await pool.query('UPDATE zoho_items_map SET image_url = ? WHERE zoho_item_id = ?', [imageUrl, req.params.itemId]);
  res.json({ success: true, image_url: imageUrl });
});

// ============ ADMIN: BULK NOTIFICATIONS ============

// POST /api/painters/notifications/send-all — Send notification to all painters
router.post('/notifications/send-all', requireAuth, requirePermission('painters.manage'), async (req, res) => {
  const { type, title, title_ta, body, body_ta, data } = req.body;
  const results = await painterNotificationService.sendToAll({ type, title, title_ta, body, body_ta, data });
  res.json({ success: true, sent: results.length });
});
```

**Step 2: Commit**

```bash
git add routes/painters.js
git commit -m "feat: add admin endpoints — offers CRUD, training CRUD, product images, bulk notifications"
```

---

### Task 10: Wire Services into server.js

**Files:**
- Modify: `server.js` — Import and initialize painter notification service

**Step 1: Add imports and initialization**

After existing service imports in server.js, add:

```javascript
const painterNotificationService = require('./services/painter-notification-service');
```

After pool/io initialization (where other services get their dependencies set):

```javascript
painterNotificationService.setDependencies(pool, io);
```

Pass to painters route if needed (or painters.js can require it directly).

Also add Socket.io room join for painters:

```javascript
// In the io.on('connection') handler, add painter room join
socket.on('join_painter_room', (painterId) => {
  socket.join(`painter_${painterId}`);
});
```

**Step 2: Commit**

```bash
git add server.js
git commit -m "feat: wire painter notification service into server.js"
```

---

## Phase 3: Frontend — Painter Web Pages

### Task 11: Redesign painter-dashboard.html with Bottom Navigation

**Files:**
- Modify: `public/painter-dashboard.html` — Add bottom nav bar, language toggle, notification bell

The dashboard should have a persistent bottom navigation bar:
```
[Home] [Catalog] [Estimate] [Training] [Attendance]
```

Home tab shows existing dashboard content (balance cards, transactions, referrals) plus active offers carousel. Notification bell icon in header with unread count badge. Language toggle button in header.

Include `painter-i18n.js` script and add `data-i18n` attributes to all text elements.

**Step: Implement and commit**

```bash
git add public/painter-dashboard.html
git commit -m "feat: redesign painter dashboard with bottom nav, i18n, notifications"
```

---

### Task 12: Create painter-catalog.html

**Files:**
- Create: `public/painter-catalog.html`

Full product catalog page with:
- Header (search, language toggle, notification bell)
- Brand filter chips (horizontal scroll)
- Category filter chips
- Offer banners carousel
- Product grid (2 columns, card layout with image, name, brand, points badge, offer badge)
- Product detail slide-up panel (full image, details, incentives, "Create Estimate" CTA)
- Bottom navigation bar
- i18n support

**Step: Implement and commit**

```bash
git add public/painter-catalog.html
git commit -m "feat: add painter product catalog page with images, offers, points"
```

---

### Task 13: Create painter-training.html

**Files:**
- Create: `public/painter-training.html`

Training hub page with:
- Category tabs (All, Products, Techniques, Color Guide, Videos, Safety)
- Featured videos section (YouTube embed cards)
- Articles section (card list with thumbnail, title, summary)
- PDF download buttons
- Article detail view (Quill rendered content or YouTube embed)
- Bottom navigation bar
- i18n support

**Step: Implement and commit**

```bash
git add public/painter-training.html
git commit -m "feat: add painter training hub page with videos, articles, PDFs"
```

---

### Task 14: Create painter-attendance.html

**Files:**
- Create: `public/painter-attendance.html`

Shop attendance page with:
- Today's status card (checked in / not checked in)
- Check-in button (requests GPS, validates geofence, optional photo)
- Monthly calendar heatmap (days with check-ins highlighted)
- Monthly stats (visits, points)
- Recent visits list
- Bottom navigation bar
- i18n support

GPS flow: Use `navigator.geolocation.getCurrentPosition()` with high accuracy, send lat/lng to backend.

**Step: Implement and commit**

```bash
git add public/painter-attendance.html
git commit -m "feat: add painter shop attendance page with GPS geofence check-in"
```

---

### Task 15: Add Offers & Training Admin Tabs (admin-painters.html)

**Files:**
- Modify: `public/admin-painters.html` — Add Tab 7 (Offers) and Tab 8 (Training)

**Tab 7: Offers**
- Create offer form (title en/ta, type, target, dates, banner upload)
- Active/expired offers table
- Edit/delete actions

**Tab 8: Training**
- Create content form (title en/ta, type article/video/pdf, category, content editor)
- Content list table with status, views, actions
- Category management sub-section

**Step: Implement and commit**

```bash
git add public/admin-painters.html
git commit -m "feat: add offers and training admin tabs to painter management"
```

---

## Phase 4: Android App

### Task 16: Add Painter Build Flavor to Android Project

**Files:**
- Modify: `qcpaintshop-android/app/build.gradle.kts` — Add painter flavor
- Create: `qcpaintshop-android/app/src/painter/res/values/` (for painter-specific resources if needed)

**Step 1: Add painter flavor to build.gradle.kts**

In the `productFlavors` block, add:

```kotlin
create("painter") {
    dimension = "app"
    applicationId = "com.qcpaintshop.painter"
    resValue("string", "app_name", "QC Painters")
    buildConfigField("String", "START_PATH", "\"/painter-login.html\"")
    buildConfigField("String", "APP_TYPE", "\"painter\"")
}
```

**Step 2: Update FCM deep links**

In `QCFirebaseMessagingService.kt`, update `getDeepLinkPath()`:

```kotlin
private fun getDeepLinkPath(type: String, conversationId: String?): String {
    val appType = BuildConfig.APP_TYPE
    if (appType == "painter") {
        return when (type) {
            "points_earned", "withdrawal_approved", "withdrawal_paid" -> "/painter-dashboard.html"
            "estimate_approved", "estimate_rejected" -> "/painter-dashboard.html#estimates"
            "new_offer" -> "/painter-catalog.html"
            "training_new" -> "/painter-training.html"
            "attendance_reminder" -> "/painter-attendance.html"
            else -> "/painter-dashboard.html"
        }
    }
    return when (type) {
        "chat_message" -> "/chat.html?conversation=$conversationId"
        "task_assigned", "task_completed" -> "/staff/tasks.html"
        "advance_approved", "advance_rejected" -> "/staff/salary.html"
        "permission_approved", "permission_rejected" -> "/staff/dashboard.html"
        "new_registration" -> "/admin-staff-registrations.html"
        else -> "/staff/dashboard.html"
    }
}
```

**Step 3: Build painter APK**

```bash
cd qcpaintshop-android
./gradlew assemblePainterRelease
```

**Step 4: Commit**

```bash
git add app/build.gradle.kts app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt
git commit -m "feat: add QC Painters Android build flavor with painter-specific FCM routing"
```

---

### Task 17: Firebase Setup for Painter App

**Manual Steps (Play Console + Firebase Console):**

1. **Firebase Console** → Add new Android app with package `com.qcpaintshop.painter`
2. Download updated `google-services.json` (will contain all 3 app configs)
3. Replace `app/google-services.json` in Android project
4. **Play Console** → Create new app listing "QC Painters"
5. Upload painter APK to internal testing track
6. Set up app access declaration with test credentials (same as staff app)

---

## Phase 5: Deploy & Test

### Task 18: Deploy Backend to Production

**Step 1: Push to master and deploy**

```bash
git checkout master && git merge development --no-edit && git push origin master
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

**Step 2: Run migration on production**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-painter-app.js"
```

**Step 3: Create upload directories on production**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && mkdir -p public/uploads/products public/uploads/offers public/uploads/training public/uploads/painter-attendance"
```

**Step 4: Verify APIs**

Test painter catalog API:
```bash
curl -s https://act.qcpaintshop.com/api/painters/me/catalog -H "X-Painter-Token: <token>" | head -c 200
```

---

### Task 19: Build & Publish Painter APK

**Step 1: Build release APK**

```bash
cd qcpaintshop-android
./gradlew assemblePainterRelease
```

APK location: `app/build/outputs/apk/painter/release/app-painter-release.apk`

**Step 2: Publish to Play Store internal track**

Use publish script or manual upload via Play Console.

**Step 3: Set up Play Store listing**

- App name: QC Painters
- Description: Paint shop loyalty app for painters
- Screenshots from painter pages
- Test credentials in App Access declaration

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| **Phase 1** | 1-4 | Database migration, uploads, notification service, i18n |
| **Phase 2** | 5-10 | Backend APIs: catalog, training, attendance, notifications, admin, wiring |
| **Phase 3** | 11-15 | Frontend: dashboard redesign, catalog, training, attendance, admin tabs |
| **Phase 4** | 16-17 | Android: painter flavor, Firebase setup |
| **Phase 5** | 18-19 | Deploy backend, build & publish APK |

**Total Tasks:** 19
**Estimated Commits:** ~15-18
