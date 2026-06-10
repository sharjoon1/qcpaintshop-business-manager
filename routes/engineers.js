/**
 * Engineer Program — Phase 1 routes
 *
 * Public:  /register, /send-otp, /verify-otp
 * Self:    /me, /me/* (requires X-Engineer-Token)
 * Admin:   /, /:id, /:id/approve, /:id/reject, /:id/credit, /:id/suspend
 *          (requires engineers.view or engineers.manage permission)
 *
 * Mirrors the painter pattern (separate auth, sha256-hashed session token,
 * 30-day session, 10-min OTP). Engineers are B2B project-buyer accounts.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const smsService = require('../services/sms-service');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { otpLimiter } = require('../middleware/rateLimiter');
const notificationService = require('../services/notification-service');
const audit = require('../services/audit-log');
const { hashOtp, otpMatches, MAX_OTP_ATTEMPTS } = require('../services/otp-utils');

let pool;
let sessionManager;

function setPool(p) { pool = p; }
function setSessionManager(sm) { sessionManager = sm; }

// ═══════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

async function requireEngineerAuth(req, res, next) {
  const token = req.headers['x-engineer-token'];
  if (!token) return res.status(401).json({ success: false, message: 'Engineer authentication required' });
  try {
    const [rows] = await pool.query(
      `SELECT s.engineer_id, e.status, e.full_name
         FROM engineer_sessions s
         JOIN engineers e ON s.engineer_id = e.id
        WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW()`,
      [token]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    if (rows[0].status !== 'approved') {
      return res.status(403).json({ success: false, message: `Account is ${rows[0].status}` });
    }
    req.engineer = { id: rows[0].engineer_id, name: rows[0].full_name };
    next();
  } catch (err) {
    console.error('[engineers] auth error:', err);
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
}

// Accepts pending/suspended too — used by /me/status during onboarding.
async function requireEngineerSession(req, res, next) {
  const token = req.headers['x-engineer-token'];
  if (!token) return res.status(401).json({ success: false, message: 'Engineer authentication required' });
  try {
    const [rows] = await pool.query(
      `SELECT s.engineer_id, e.status, e.full_name
         FROM engineer_sessions s
         JOIN engineers e ON s.engineer_id = e.id
        WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW()`,
      [token]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    req.engineer = { id: rows[0].engineer_id, name: rows[0].full_name, status: rows[0].status };
    next();
  } catch (err) {
    console.error('[engineers] session auth error:', err);
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════

router.post('/register', async (req, res) => {
  try {
    const { full_name, phone, email, company_name, designation, gst_number, address, city, district, pincode } = req.body;
    if (!full_name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const [existing] = await pool.query('SELECT id, status FROM engineers WHERE phone = ?', [cleanPhone]);
    if (existing.length) {
      return res.status(400).json({ success: false, message: `Phone already registered (status: ${existing[0].status})` });
    }

    const [result] = await pool.query(
      `INSERT INTO engineers (full_name, phone, email, company_name, designation, gst_number, address, city, district, pincode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [full_name.trim(), cleanPhone, email || null, company_name || null, designation || null,
       gst_number || null, address || null, city || null, district || null, pincode || null]
    );

    // Notify admins
    try {
      const [admins] = await pool.query(
        "SELECT id FROM users WHERE role IN ('admin','manager') AND status = 'active'"
      );
      for (const admin of admins) {
        await notificationService.send(admin.id, {
          type: 'engineer_registered',
          title: 'New Engineer Registration',
          body: `${full_name}${company_name ? ' (' + company_name + ')' : ''} registered and is awaiting approval.`,
          data: { page: 'engineers', filter: 'pending' }
        });
      }
    } catch (nErr) {
      console.error('[engineers] registration notify error:', nErr.message);
    }

    res.json({ success: true, message: 'Registration submitted. Awaiting approval.', engineerId: result.insertId });
  } catch (err) {
    console.error('[engineers] register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

router.post('/send-otp', otpLimiter, async (req, res) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const [rows] = await pool.query('SELECT id, status, full_name FROM engineers WHERE phone = ?', [phone]);
    if (!rows.length) {
      return res.status(404).json({ success: false, code: 'NOT_REGISTERED', message: 'No engineer account found for this number. Please register first.' });
    }
    const eng = rows[0];

    const allowTestBypass = process.env.NODE_ENV !== 'production';
    const isTestAccount = allowTestBypass && (phone === '9999999999');
    const otp = isTestAccount ? '123456' : String(crypto.randomInt(100000, 1000000));
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await pool.query('DELETE FROM engineer_sessions WHERE engineer_id = ? AND expires_at < NOW()', [eng.id]);

    // S2: only the OTP's sha256 hash is stored.
    await pool.query(
      `INSERT INTO engineer_sessions (engineer_id, token, token_hash, otp, otp_expires_at, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [eng.id, token, tokenHash, hashOtp(otp)]
    );

    if (process.env.NODE_ENV !== 'production') console.log(`[Engineer OTP] ${phone} → ${otp}`);

    if (!isTestAccount) {
      // SMS (DLT-registered template; same wording as customer/painter OTP)
      {
        const smsText = `Your verification OTP for Quality Colours registration is ${otp}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
        const number = phone.startsWith('91') ? phone : '91' + phone;
        smsService.sendSms({ number, text: smsText, label: `Engineer OTP ${phone}` });
      }
      // WhatsApp secondary
      if (sessionManager) {
        try {
          const msg = `🏗️ *Quality Colours Engineer Program*\n\nYour OTP is: *${otp}*\n\nValid for 10 minutes. Do not share this code with anyone.`;
          await sessionManager.sendMessage(0, phone, msg, { source: 'engineer_otp' });
        } catch (e) { console.error('[Engineer OTP] WA failed:', e.message); }
      }
    }

    res.json({ success: true, message: 'OTP sent', status: eng.status });
  } catch (err) {
    console.error('[engineers] send-otp error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    const otp = String(req.body.otp || '').trim();
    if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP are required' });

    // S2: fetch the latest pending OTP session, compare the hash in Node,
    // and cap wrong guesses per issued code.
    const [rows] = await pool.query(
      `SELECT s.id, s.token, s.engineer_id, s.otp AS otp_hash, s.otp_attempts,
              e.status, e.full_name, e.phone, e.profile_photo, e.company_name
         FROM engineer_sessions s
         JOIN engineers e ON s.engineer_id = e.id
        WHERE e.phone = ? AND s.otp IS NOT NULL AND s.otp_expires_at > NOW()
        ORDER BY s.id DESC LIMIT 1`,
      [phone]
    );
    if (!rows.length) {
      // S4: audit failed engineer login
      audit.record(req, {
        action: 'ENGINEER_LOGIN_FAILED', entity_type: 'engineer', entity_id: null,
        after: { phone, reason: 'invalid_or_expired_otp' }
      });
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    const session = rows[0];

    if (session.otp_attempts >= MAX_OTP_ATTEMPTS) {
      await pool.query('UPDATE engineer_sessions SET otp = NULL, otp_expires_at = NULL WHERE id = ?', [session.id]);
      return res.status(400).json({ success: false, message: 'Too many wrong attempts. Request a new OTP.' });
    }
    if (!otpMatches(session.otp_hash, otp)) {
      await pool.query('UPDATE engineer_sessions SET otp_attempts = otp_attempts + 1 WHERE id = ?', [session.id]);
      audit.record(req, {
        action: 'ENGINEER_LOGIN_FAILED', entity_type: 'engineer', entity_id: session.engineer_id,
        after: { phone, reason: 'wrong_otp' }
      });
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await pool.query('UPDATE engineer_sessions SET otp = NULL, otp_expires_at = NULL WHERE id = ?', [session.id]);

    // S4: audit successful engineer login
    audit.record(req, {
      action: 'ENGINEER_LOGIN_SUCCESS', entity_type: 'engineer', entity_id: session.engineer_id,
      after: { phone: session.phone, status: session.status }
    });

    res.json({
      success: true,
      token: session.token,
      engineer: {
        id: session.engineer_id,
        full_name: session.full_name,
        phone: session.phone,
        company_name: session.company_name,
        profile_photo: session.profile_photo || null,
        status: session.status
      }
    });
  } catch (err) {
    console.error('[engineers] verify-otp error:', err);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

router.post('/logout', requireEngineerSession, async (req, res) => {
  try {
    const token = req.headers['x-engineer-token'];
    await pool.query('DELETE FROM engineer_sessions WHERE token_hash = LOWER(SHA2(?, 256))', [token]);
    res.json({ success: true });
  } catch (err) {
    console.error('[engineers] logout error:', err);
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SELF (X-Engineer-Token)
// ═══════════════════════════════════════════════════════════════

router.get('/me/status', requireEngineerSession, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, phone, email, company_name, designation, gst_number,
              address, city, district, pincode, status, credit_enabled, credit_limit,
              credit_used, total_spend, profile_photo, rejected_reason, created_at
         FROM engineers WHERE id = ?`,
      [req.engineer.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Engineer not found' });
    res.json({ success: true, engineer: rows[0] });
  } catch (err) {
    console.error('[engineers] me/status error:', err);
    res.status(500).json({ success: false, message: 'Failed to load profile' });
  }
});

router.get('/me', requireEngineerAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, phone, email, company_name, designation, gst_number,
              address, city, district, state, pincode, status, credit_enabled, credit_limit,
              credit_used, total_spend, profile_photo, created_at
         FROM engineers WHERE id = ?`,
      [req.engineer.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Engineer not found' });
    res.json({ success: true, engineer: rows[0] });
  } catch (err) {
    console.error('[engineers] me error:', err);
    res.status(500).json({ success: false, message: 'Failed to load profile' });
  }
});

router.put('/me', requireEngineerSession, async (req, res) => {
  try {
    // Onboarding steers PENDING engineers to complete their profile, so pending + approved
    // may edit their own (self-scoped, non-sensitive) fields. Suspended/rejected may not.
    if (req.engineer.status !== 'pending' && req.engineer.status !== 'approved') {
      return res.status(403).json({ success: false, message: `Account is ${req.engineer.status}` });
    }
    const allowed = ['full_name', 'email', 'company_name', 'designation', 'gst_number',
                     'address', 'city', 'district', 'pincode'];
    const sets = []; const vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(req.body[k] === '' ? null : req.body[k]);
      }
    }
    if (!sets.length) return res.json({ success: true, message: 'No changes' });
    vals.push(req.engineer.id);
    await pool.query(`UPDATE engineers SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    console.error('[engineers] me update error:', err);
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

// Submit a new B2B quote request for the logged-in engineer.
// Pre-fills customer_name + phone from the engineer record, maps to the
// existing estimate_requests table so the staff workflow stays unified.
router.post('/me/quotes', requireEngineerAuth, async (req, res) => {
  try {
    const PROJECT_TYPES = ['interior','exterior','both','commercial','renovation','new_construction'];
    const PROPERTY_TYPES = ['house','apartment','villa','office','shop','warehouse','other'];

    const project_type = PROJECT_TYPES.includes(req.body.project_type) ? req.body.project_type : 'commercial';
    const property_type = PROPERTY_TYPES.includes(req.body.property_type) ? req.body.property_type : 'other';
    const project_name = (req.body.project_name || '').toString().trim();
    const location_input = (req.body.location || '').toString().trim();
    const area_sqft = parseInt(req.body.area_sqft, 10);

    if (!project_name) {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }
    if (!location_input) {
      return res.status(400).json({ success: false, message: 'Site address / location is required' });
    }
    if (!Number.isFinite(area_sqft) || area_sqft <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid area in square feet' });
    }

    const [eng] = await pool.query(
      'SELECT id, full_name, phone, email, company_name FROM engineers WHERE id = ?',
      [req.engineer.id]
    );
    if (!eng.length) return res.status(404).json({ success: false, message: 'Engineer record not found' });
    const me = eng[0];

    const site_visit = req.body.site_visit ? 'YES' : 'NO';
    const company_line = me.company_name ? `Company: ${me.company_name}\n` : '';
    const notes_input = (req.body.additional_notes || '').toString().trim();
    const additional_notes = [
      `Engineer quote — Project: ${project_name}`,
      company_line.trim(),
      `Site visit requested: ${site_visit}`,
      notes_input ? `\nNotes:\n${notes_input}` : null
    ].filter(Boolean).join('\n');

    // Generate request_number (same pattern as routes/estimate-requests.js)
    const today = new Date();
    const yyyymm = today.getFullYear().toString() + String(today.getMonth() + 1).padStart(2, '0');
    const prefix = `ENG-${yyyymm}-`;
    const [last] = await pool.query(
      'SELECT request_number FROM estimate_requests WHERE request_number LIKE ? ORDER BY id DESC LIMIT 1',
      [prefix + '%']
    );
    let seq = 1;
    if (last.length) {
      const m = String(last[0].request_number).match(/-(\d+)$/);
      if (m) seq = parseInt(m[1], 10) + 1;
    }
    const request_number = prefix + String(seq).padStart(4, '0');

    const [result] = await pool.query(
      `INSERT INTO estimate_requests
        (request_number, customer_name, phone, email,
         project_type, property_type, location, area_sqft,
         preferred_brand, timeline, budget_range, additional_notes,
         status, priority, source, request_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'medium', 'engineer_portal', 'simple')`,
      [
        request_number,
        me.full_name,
        me.phone,
        me.email || null,
        project_type,
        property_type,
        location_input,
        area_sqft,
        req.body.preferred_brand || null,
        req.body.timeline || null,
        req.body.budget_range || null,
        additional_notes
      ]
    );

    // Notify staff
    try {
      const [admins] = await pool.query(
        "SELECT id FROM users WHERE role IN ('admin','manager','staff') AND status = 'active' LIMIT 50"
      );
      for (const admin of admins) {
        await notificationService.send(admin.id, {
          type: 'engineer_quote_requested',
          title: 'New Engineer Quote Request',
          body: `${me.full_name}${me.company_name ? ' (' + me.company_name + ')' : ''} requested a quote for "${project_name}" — ${area_sqft} sq ft.`,
          data: { page: 'estimate-requests', filter: 'new', request_number }
        });
      }
    } catch (nErr) { console.error('[engineers] quote notify error:', nErr.message); }

    res.json({ success: true, message: 'Quote request submitted', request_number, id: result.insertId });
  } catch (err) {
    console.error('[engineers] me/quotes error:', err);
    res.status(500).json({ success: false, message: 'Could not submit quote request' });
  }
});

// ───── Engineer rate resolver ─────
// Priority chain: per-engineer item > per-engineer brand > per-engineer category
//              > global default item > global default brand > global default category > 0
async function getEngineerRateResolver(engineerId) {
  const own = { item: new Map(), brand: new Map(), category: new Map() };
  const def = { item: new Map(), brand: new Map(), category: new Map() };

  async function readRates(table, params) {
    try {
      const [rows] = await pool.query(
        `SELECT scope, target_id, zoho_item_id, discount_pct FROM ${table}${params ? ' WHERE engineer_id = ?' : ''}`,
        params ? [params] : []
      );
      return rows;
    } catch (err) {
      if (err && err.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    }
  }

  if (engineerId) {
    const ownRows = await readRates('engineer_custom_rates', engineerId);
    for (const r of ownRows) {
      const pct = parseFloat(r.discount_pct || 0);
      if (r.scope === 'item' && r.zoho_item_id) own.item.set(String(r.zoho_item_id), pct);
      else if (r.scope === 'brand') own.brand.set(r.target_id, pct);
      else if (r.scope === 'category') own.category.set(r.target_id, pct);
    }
  }
  const defRows = await readRates('engineer_default_rates', null);
  for (const r of defRows) {
    const pct = parseFloat(r.discount_pct || 0);
    if (r.scope === 'item' && r.zoho_item_id) def.item.set(String(r.zoho_item_id), pct);
    else if (r.scope === 'brand') def.brand.set(r.target_id, pct);
    else if (r.scope === 'category') def.category.set(r.target_id, pct);
  }

  return (zohoItemId, brand, category) => {
    const k = zohoItemId ? String(zohoItemId) : null;
    let pct = 0;
    if (k && own.item.has(k)) pct = own.item.get(k);
    else if (brand && own.brand.has(brand)) pct = own.brand.get(brand);
    else if (category && own.category.has(category)) pct = own.category.get(category);
    else if (k && def.item.has(k)) pct = def.item.get(k);
    else if (brand && def.brand.has(brand)) pct = def.brand.get(brand);
    else if (category && def.category.has(category)) pct = def.category.get(category);
    return { discount_pct: pct };
  };
}

async function getHiddenItemIds() {
  try {
    const [rows] = await pool.query('SELECT zoho_item_id FROM engineer_hidden_items');
    return rows.map(r => r.zoho_item_id);
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }
}

function applyDiscount(rate, pct) {
  const r = parseFloat(rate || 0);
  const d = parseFloat(pct || 0);
  if (!r || !d) return r;
  return Math.round(r * (100 - d)) / 100;
}

// ───── Engineer catalog ─────
// Browse products with engineer's effective price (after applicable discount).
router.get('/me/catalog', requireEngineerAuth, async (req, res) => {
  try {
    const { search = '', brand = '', category = '' } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 24));
    const offset = (page - 1) * limit;

    const where = ["p.status = 'active'"];
    const params = [];
    if (search) {
      where.push('(p.name LIKE ? OR zim.zoho_item_name LIKE ? OR zim.zoho_brand LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (brand) { where.push('zim.zoho_brand = ?'); params.push(brand); }
    if (category) { where.push('zim.zoho_category_name = ?'); params.push(category); }

    const joins = `
      FROM products p
      INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
      INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
        AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
    `;

    // Exclude hidden items from the engineer catalogue
    const hidden = await getHiddenItemIds();
    if (hidden.length) {
      where.push(`ps.zoho_item_id NOT IN (${hidden.map(() => '?').join(',')})`);
      params.push(...hidden);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(DISTINCT p.id) AS total ${joins} ${whereSql}`,
      params
    );

    const [products] = await pool.query(
      `SELECT p.id AS product_id, p.name,
              MAX(zim.zoho_brand) AS brand,
              MAX(zim.zoho_category_name) AS category,
              MIN(CAST(zim.zoho_rate AS DECIMAL(10,2))) AS min_rate,
              MAX(CAST(zim.zoho_rate AS DECIMAL(10,2))) AS max_rate,
              COUNT(DISTINCT ps.id) AS variant_count,
              (SELECT z2.image_url FROM pack_sizes ps2
               INNER JOIN zoho_items_map z2 ON z2.zoho_item_id = ps2.zoho_item_id
               WHERE ps2.product_id = p.id AND ps2.is_active = 1 AND z2.image_url IS NOT NULL
               LIMIT 1) AS image_url,
              GROUP_CONCAT(DISTINCT ps.zoho_item_id) AS variant_zoho_ids
       ${joins} ${whereSql}
       GROUP BY p.id, p.name
       ORDER BY p.name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const resolver = await getEngineerRateResolver(req.engineer.id);
    const enriched = products.map(p => {
      const ids = (p.variant_zoho_ids || '').split(',').filter(Boolean);
      let bestPct = 0;
      for (const id of ids) {
        const { discount_pct } = resolver(id, p.brand, p.category);
        if (discount_pct > bestPct) bestPct = discount_pct;
      }
      if (!bestPct && (p.brand || p.category)) {
        bestPct = Math.max(
          resolver(null, p.brand, null).discount_pct,
          resolver(null, null, p.category).discount_pct
        );
      }
      return {
        product_id: p.product_id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        image_url: p.image_url,
        variant_count: p.variant_count,
        list_min: p.min_rate,
        list_max: p.max_rate,
        discount_pct: bestPct,
        effective_min: applyDiscount(p.min_rate, bestPct),
        effective_max: applyDiscount(p.max_rate, bestPct)
      };
    });

    res.json({
      success: true,
      products: enriched,
      total,
      page,
      limit,
      hasMore: offset + enriched.length < total
    });
  } catch (err) {
    console.error('[engineers] me/catalog error:', err);
    res.status(500).json({ success: false, message: 'Failed to load catalog' });
  }
});

// Filter options (brands + categories present in active products)
router.get('/me/catalog-filters', requireEngineerAuth, async (req, res) => {
  try {
    const [brands] = await pool.query(`
      SELECT DISTINCT zim.zoho_brand AS brand
        FROM products p
        INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
       WHERE p.status = 'active' AND zim.zoho_brand IS NOT NULL AND zim.zoho_brand <> ''
       ORDER BY zim.zoho_brand
    `);
    const [categories] = await pool.query(`
      SELECT DISTINCT zim.zoho_category_name AS category
        FROM products p
        INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
       WHERE p.status = 'active' AND zim.zoho_category_name IS NOT NULL AND zim.zoho_category_name <> ''
       ORDER BY zim.zoho_category_name
    `);
    res.json({
      success: true,
      brands: brands.map(b => b.brand),
      categories: categories.map(c => c.category)
    });
  } catch (err) {
    console.error('[engineers] me/catalog-filters error:', err);
    res.status(500).json({ success: false, message: 'Failed to load filters' });
  }
});

// Product detail with pack-size variants and engineer's effective price each
router.get('/me/catalog/:productId', requireEngineerAuth, async (req, res) => {
  try {
    const [[product]] = await pool.query(
      `SELECT id AS product_id, name, description, product_type, status
         FROM products WHERE id = ? AND status = 'active'`,
      [req.params.productId]
    );
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const hiddenIds = await getHiddenItemIds();
    const hiddenFilter = hiddenIds.length
      ? ` AND ps.zoho_item_id NOT IN (${hiddenIds.map(() => '?').join(',')})`
      : '';
    const [variants] = await pool.query(`
      SELECT ps.id AS pack_size_id, ps.size_label, ps.size, ps.unit, ps.color_name, ps.color_code,
             zim.zoho_item_id, zim.zoho_item_name, zim.zoho_brand AS brand,
             zim.zoho_category_name AS category, CAST(zim.zoho_rate AS DECIMAL(10,2)) AS list_rate,
             zim.image_url
        FROM pack_sizes ps
        INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
       WHERE ps.product_id = ? AND ps.is_active = 1
         AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
         ${hiddenFilter}
       ORDER BY CAST(zim.zoho_rate AS DECIMAL(10,2)) ASC
    `, [req.params.productId, ...hiddenIds]);

    const resolver = await getEngineerRateResolver(req.engineer.id);
    const out = variants.map(v => {
      const { discount_pct } = resolver(v.zoho_item_id, v.brand, v.category);
      return {
        ...v,
        discount_pct,
        effective_rate: applyDiscount(v.list_rate, discount_pct)
      };
    });

    res.json({ success: true, product, variants: out });
  } catch (err) {
    console.error('[engineers] me/catalog/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to load product' });
  }
});

// ───── Cart-based order/quotation submission ─────
// Engineer builds a cart of catalogue items in the browser, then submits
// it as a single quotation requisition tagged with all line items in
// estimate_requests.products_json.
router.post('/me/orders', requireEngineerAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty. Add at least one product before submitting.' });
    }
    const project_name = (req.body.project_name || '').toString().trim();
    const location_input = (req.body.location || '').toString().trim();
    if (!project_name) {
      return res.status(400).json({ success: false, message: 'Project name is required.' });
    }
    if (!location_input) {
      return res.status(400).json({ success: false, message: 'Site / delivery address is required.' });
    }

    // Re-fetch engineer's authoritative discount for each item so the
    // server-side total can't be tampered with from the browser.
    const resolver = await getEngineerRateResolver(req.engineer.id);
    let total_qty = 0;
    let subtotal_list = 0;
    let subtotal_net = 0;
    const safe_items = [];
    for (const raw of items) {
      const qty = parseInt(raw.quantity, 10);
      if (!Number.isFinite(qty) || qty < 1) continue;
      // Look up the variant row so we trust DB names/rates, not client values
      const [[v]] = await pool.query(
        `SELECT ps.id AS pack_size_id, ps.size_label, ps.color_name,
                zim.zoho_item_id, zim.zoho_item_name, zim.zoho_brand AS brand,
                zim.zoho_category_name AS category, CAST(zim.zoho_rate AS DECIMAL(10,2)) AS list_rate,
                p.id AS product_id, p.name AS product_name
           FROM pack_sizes ps
           INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
           INNER JOIN products p ON p.id = ps.product_id
          WHERE ps.id = ? AND ps.is_active = 1`,
        [raw.pack_size_id]
      );
      if (!v) continue;
      const { discount_pct } = resolver(v.zoho_item_id, v.brand, v.category);
      const list_rate = parseFloat(v.list_rate || 0);
      const eff_rate = discount_pct ? Math.round(list_rate * (100 - discount_pct)) / 100 : list_rate;
      total_qty += qty;
      subtotal_list += list_rate * qty;
      subtotal_net  += eff_rate  * qty;
      safe_items.push({
        product_id: v.product_id,
        product_name: v.product_name,
        pack_size_id: v.pack_size_id,
        zoho_item_id: v.zoho_item_id,
        zoho_item_name: v.zoho_item_name,
        size_label: v.size_label,
        color_name: v.color_name,
        brand: v.brand,
        category: v.category,
        quantity: qty,
        list_rate,
        discount_pct,
        effective_rate: eff_rate,
        line_total: Math.round(eff_rate * qty * 100) / 100
      });
    }
    if (!safe_items.length) {
      return res.status(400).json({ success: false, message: 'None of the cart items could be validated. Please re-add items.' });
    }

    // Engineer's profile for invoice/contact details
    const [[me]] = await pool.query(
      'SELECT id, full_name, phone, email, company_name FROM engineers WHERE id = ?',
      [req.engineer.id]
    );
    if (!me) return res.status(404).json({ success: false, message: 'Engineer record not found.' });

    // Build request_number (ENG-YYYYMM-####)
    const today = new Date();
    const yyyymm = today.getFullYear().toString() + String(today.getMonth() + 1).padStart(2, '0');
    const prefix = `ENG-${yyyymm}-`;
    const [last] = await pool.query(
      'SELECT request_number FROM estimate_requests WHERE request_number LIKE ? ORDER BY id DESC LIMIT 1',
      [prefix + '%']
    );
    let seq = 1;
    if (last.length) {
      const m = String(last[0].request_number).match(/-(\d+)$/);
      if (m) seq = parseInt(m[1], 10) + 1;
    }
    const request_number = prefix + String(seq).padStart(4, '0');

    const products_json = JSON.stringify({
      source: 'engineer_cart',
      items: safe_items,
      subtotal_list: Math.round(subtotal_list * 100) / 100,
      subtotal_net:  Math.round(subtotal_net  * 100) / 100,
      total_qty
    });

    const company_line = me.company_name ? `Company: ${me.company_name}\n` : '';
    const note_input = (req.body.additional_notes || '').toString().trim();
    const additional_notes = [
      `Engineer cart order — Project: ${project_name}`,
      company_line.trim(),
      `Total items: ${total_qty} units across ${safe_items.length} SKUs`,
      `Subtotal (list): ₹ ${Math.round(subtotal_list).toLocaleString('en-IN')}`,
      `Subtotal (after discount): ₹ ${Math.round(subtotal_net).toLocaleString('en-IN')}`,
      note_input ? `\nRemarks:\n${note_input}` : null
    ].filter(Boolean).join('\n');

    const [result] = await pool.query(
      `INSERT INTO estimate_requests
        (request_number, customer_name, phone, email,
         project_type, property_type, location, area_sqft,
         preferred_brand, additional_notes, products_json,
         estimated_amount, status, priority, source, request_method)
       VALUES (?, ?, ?, ?, 'commercial', 'other', ?, 0,
               NULL, ?, ?, ?, 'new', 'medium', 'engineer_portal', 'product')`,
      [
        request_number,
        me.full_name,
        me.phone,
        me.email || null,
        location_input,
        additional_notes,
        products_json,
        Math.round(subtotal_net * 100) / 100
      ]
    );

    // Notify staff
    try {
      const [admins] = await pool.query(
        "SELECT id FROM users WHERE role IN ('admin','manager','staff') AND status = 'active' LIMIT 50"
      );
      for (const admin of admins) {
        await notificationService.send(admin.id, {
          type: 'engineer_order_submitted',
          title: 'Engineer Cart Order',
          body: `${me.full_name}${me.company_name ? ' (' + me.company_name + ')' : ''} submitted ${safe_items.length} SKUs (${total_qty} units, ₹${Math.round(subtotal_net).toLocaleString('en-IN')}) for project "${project_name}".`,
          data: { page: 'estimate-requests', filter: 'new', request_number }
        });
      }
    } catch (nErr) { console.error('[engineers] order notify error:', nErr.message); }

    res.json({
      success: true,
      message: 'Order submitted',
      request_number,
      id: result.insertId,
      subtotal_list: Math.round(subtotal_list * 100) / 100,
      subtotal_net:  Math.round(subtotal_net  * 100) / 100,
      total_qty,
      item_count: safe_items.length
    });
  } catch (err) {
    console.error('[engineers] me/orders error:', err);
    res.status(500).json({ success: false, message: 'Could not submit order' });
  }
});

// Engineer's project requests (reads from estimate_requests by phone)
router.get('/me/projects', requireEngineerAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const [me] = await pool.query('SELECT phone FROM engineers WHERE id = ?', [req.engineer.id]);
    if (!me.length) return res.json({ success: true, data: [] });

    let rows = [];
    try {
      const [r] = await pool.query(
        `SELECT id, request_number, project_type, area_sqft, status, location, created_at
           FROM estimate_requests
          WHERE phone = ?
          ORDER BY id DESC LIMIT ?`,
        [me[0].phone, limit]
      );
      rows = r;
    } catch (e) {
      // estimate_requests schema may differ — degrade gracefully
      if (e && e.code === 'ER_NO_SUCH_TABLE') rows = [];
      else throw e;
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[engineers] me/projects error:', err);
    res.status(500).json({ success: false, message: 'Failed to load projects' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// List with filters
router.get('/', requirePermission('engineers', 'view'), async (req, res) => {
  try {
    const { status, q, branch_id, page = 1, per_page = 20 } = req.query;
    const perPage = Math.min(parseInt(per_page) || 20, 100);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * perPage;

    const where = []; const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (branch_id) { where.push('branch_id = ?'); params.push(branch_id); }
    if (q) {
      where.push('(full_name LIKE ? OR phone LIKE ? OR company_name LIKE ? OR gst_number LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT id, full_name, phone, company_name, designation, gst_number, city,
              status, credit_enabled, credit_limit, credit_used, total_spend,
              profile_photo, created_at
         FROM engineers ${whereSql}
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM engineers ${whereSql}`, params
    );
    const [[counts]] = await pool.query(
      `SELECT
         SUM(status='pending')   AS pending,
         SUM(status='approved')  AS approved,
         SUM(status='suspended') AS suspended,
         SUM(status='rejected')  AS rejected
       FROM engineers`
    );
    res.json({ success: true, data: rows, total, counts, page: parseInt(page) || 1, per_page: perPage });
  } catch (err) {
    console.error('[engineers] list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list engineers' });
  }
});

router.get('/:id', requirePermission('engineers', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM engineers WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Engineer not found' });
    res.json({ success: true, engineer: rows[0] });
  } catch (err) {
    console.error('[engineers] get error:', err);
    res.status(500).json({ success: false, message: 'Failed to load engineer' });
  }
});

router.post('/:id/approve', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, full_name, phone, status FROM engineers WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Engineer not found' });
    if (rows[0].status === 'approved') return res.json({ success: true, message: 'Already approved' });

    await pool.query(
      `UPDATE engineers SET status = 'approved', approved_by = ?, approved_at = NOW(), rejected_reason = NULL WHERE id = ?`,
      [req.user?.id || null, req.params.id]
    );

    // Notify the engineer (if a notification mechanism exists for the phone)
    try {
      if (sessionManager) {
        const msg = `🏗️ *Quality Colours Engineer Program*\n\nGood news ${rows[0].full_name} — your engineer account has been approved! Sign in any time at https://act.qcpaintshop.com/engineer-login.html`;
        await sessionManager.sendMessage(0, rows[0].phone, msg, { source: 'engineer_approved' });
      }
    } catch (_) {}
    res.json({ success: true, message: 'Engineer approved' });
  } catch (err) {
    console.error('[engineers] approve error:', err);
    res.status(500).json({ success: false, message: 'Approval failed' });
  }
});

router.post('/:id/reject', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    await pool.query(
      'UPDATE engineers SET status = "rejected", rejected_reason = ? WHERE id = ?',
      [reason, req.params.id]
    );
    res.json({ success: true, message: 'Engineer rejected' });
  } catch (err) {
    console.error('[engineers] reject error:', err);
    res.status(500).json({ success: false, message: 'Reject failed' });
  }
});

router.post('/:id/suspend', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    await pool.query('UPDATE engineers SET status = "suspended" WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Engineer suspended' });
  } catch (err) {
    console.error('[engineers] suspend error:', err);
    res.status(500).json({ success: false, message: 'Suspend failed' });
  }
});

router.post('/:id/reinstate', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    await pool.query('UPDATE engineers SET status = "approved" WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Engineer reinstated' });
  } catch (err) {
    console.error('[engineers] reinstate error:', err);
    res.status(500).json({ success: false, message: 'Reinstate failed' });
  }
});

router.put('/:id', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    const allowed = ['full_name','email','company_name','designation','gst_number','pan_number',
                     'address','city','district','state','pincode','branch_id','notes',
                     'credit_enabled','credit_limit'];
    const sets = []; const vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(req.body[k] === '' ? null : req.body[k]);
      }
    }
    if (!sets.length) return res.json({ success: true, message: 'No changes' });
    vals.push(req.params.id);
    await pool.query(`UPDATE engineers SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true, message: 'Engineer updated' });
  } catch (err) {
    console.error('[engineers] update error:', err);
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

router.put('/:id/credit', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    const limit = parseFloat(req.body.credit_limit);
    const enabled = req.body.credit_enabled ? 1 : 0;
    if (Number.isNaN(limit) || limit < 0) {
      return res.status(400).json({ success: false, message: 'credit_limit must be a non-negative number' });
    }
    await pool.query(
      'UPDATE engineers SET credit_limit = ?, credit_enabled = ? WHERE id = ?',
      [limit, enabled, req.params.id]
    );
    res.json({ success: true, message: 'Credit settings updated' });
  } catch (err) {
    console.error('[engineers] credit error:', err);
    res.status(500).json({ success: false, message: 'Credit update failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: GLOBAL ENGINEER CATALOGUE & PRICE MANAGEMENT
// (must come before /:id parameterised routes)
// ═══════════════════════════════════════════════════════════════

// Brands + categories present in active zoho items (for admin dropdowns)
router.get('/admin/filters', requirePermission('engineers', 'view'), async (req, res) => {
  try {
    const [brands] = await pool.query(`
      SELECT DISTINCT zoho_brand AS brand FROM zoho_items_map
       WHERE zoho_brand IS NOT NULL AND zoho_brand <> ''
         AND (zoho_status = 'active' OR zoho_status IS NULL)
       ORDER BY zoho_brand
    `);
    const [categories] = await pool.query(`
      SELECT DISTINCT zoho_category_name AS category FROM zoho_items_map
       WHERE zoho_category_name IS NOT NULL AND zoho_category_name <> ''
         AND (zoho_status = 'active' OR zoho_status IS NULL)
       ORDER BY zoho_category_name
    `);
    res.json({
      success: true,
      brands: brands.map(b => b.brand),
      categories: categories.map(c => c.category)
    });
  } catch (err) {
    console.error('[engineers] admin/filters error:', err);
    res.status(500).json({ success: false, message: 'Failed to load filters' });
  }
});

// Search Zoho items by name / brand / item id (admin item selection)
router.get('/admin/items/search', requirePermission('engineers', 'view'), async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 2) return res.json({ success: true, items: [] });
    const like = `%${q}%`;
    const [rows] = await pool.query(`
      SELECT zoho_item_id, zoho_item_name, zoho_brand, zoho_category_name,
             CAST(zoho_rate AS DECIMAL(10,2)) AS zoho_rate, image_url
        FROM zoho_items_map
       WHERE (zoho_status = 'active' OR zoho_status IS NULL)
         AND (zoho_item_name LIKE ? OR zoho_brand LIKE ? OR zoho_item_id LIKE ?)
       ORDER BY zoho_item_name
       LIMIT 30
    `, [like, like, like]);
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error('[engineers] admin/items/search error:', err);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// Default rates (apply to ALL engineers)
router.get('/admin/default-rates', requirePermission('engineers', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, scope, target_id, zoho_item_id, discount_pct, notes, created_at, updated_at
         FROM engineer_default_rates
        ORDER BY scope ASC, updated_at DESC`
    );
    const itemIds = rows.filter(r => r.scope === 'item').map(r => r.zoho_item_id).filter(Boolean);
    let nameById = new Map();
    if (itemIds.length) {
      const placeholders = itemIds.map(() => '?').join(',');
      const [items] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, zoho_brand
           FROM zoho_items_map WHERE zoho_item_id IN (${placeholders})`,
        itemIds
      );
      nameById = new Map(items.map(i => [i.zoho_item_id, i]));
    }
    const enriched = rows.map(r => {
      const info = r.scope === 'item' && r.zoho_item_id ? nameById.get(r.zoho_item_id) : null;
      return {
        ...r,
        display_name: r.scope === 'item'
          ? (info ? `${info.zoho_item_name}${info.zoho_brand ? ' · ' + info.zoho_brand : ''}` : r.zoho_item_id)
          : r.target_id
      };
    });
    res.json({ success: true, rates: enriched });
  } catch (err) {
    console.error('[engineers] admin/default-rates list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load default rates' });
  }
});

router.post('/admin/default-rates', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    const SCOPES = ['item', 'brand', 'category'];
    const scope = SCOPES.includes(req.body.scope) ? req.body.scope : null;
    if (!scope) return res.status(400).json({ success: false, message: "scope must be 'item', 'brand', or 'category'" });
    const target_id = (req.body.target_id || '').toString().trim();
    if (!target_id) return res.status(400).json({ success: false, message: 'target_id is required' });
    const discount_pct = parseFloat(req.body.discount_pct);
    if (Number.isNaN(discount_pct) || discount_pct < 0 || discount_pct > 100) {
      return res.status(400).json({ success: false, message: 'discount_pct must be between 0 and 100' });
    }
    const zoho_item_id = scope === 'item' ? target_id : (req.body.zoho_item_id || null);

    await pool.query(
      `INSERT INTO engineer_default_rates (scope, target_id, zoho_item_id, discount_pct, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE discount_pct = VALUES(discount_pct), notes = VALUES(notes), zoho_item_id = VALUES(zoho_item_id), updated_at = NOW()`,
      [scope, target_id, zoho_item_id, discount_pct, req.body.notes || null, req.user?.id || null]
    );
    res.json({ success: true, message: 'Default rate saved' });
  } catch (err) {
    console.error('[engineers] admin/default-rates save error:', err);
    res.status(500).json({ success: false, message: 'Failed to save default rate' });
  }
});

router.delete('/admin/default-rates/:id', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    await pool.query('DELETE FROM engineer_default_rates WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Default rate removed' });
  } catch (err) {
    console.error('[engineers] admin/default-rates delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove default rate' });
  }
});

// Hidden items (catalogue visibility)
router.get('/admin/hidden-items', requirePermission('engineers', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT h.zoho_item_id, h.reason, h.created_at,
             zim.zoho_item_name, zim.zoho_brand, zim.zoho_category_name,
             CAST(zim.zoho_rate AS DECIMAL(10,2)) AS zoho_rate
        FROM engineer_hidden_items h
        LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = h.zoho_item_id
       ORDER BY h.created_at DESC
    `);
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error('[engineers] admin/hidden-items list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load hidden items' });
  }
});

router.post('/admin/hidden-items', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    const zoho_item_id = (req.body.zoho_item_id || '').toString().trim();
    if (!zoho_item_id) return res.status(400).json({ success: false, message: 'zoho_item_id is required' });
    await pool.query(
      `INSERT IGNORE INTO engineer_hidden_items (zoho_item_id, reason, created_by)
       VALUES (?, ?, ?)`,
      [zoho_item_id, req.body.reason || null, req.user?.id || null]
    );
    res.json({ success: true, message: 'Item hidden from engineer catalogue' });
  } catch (err) {
    console.error('[engineers] admin/hidden-items add error:', err);
    res.status(500).json({ success: false, message: 'Failed to hide item' });
  }
});

router.delete('/admin/hidden-items/:zoho_item_id', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    await pool.query('DELETE FROM engineer_hidden_items WHERE zoho_item_id = ?', [req.params.zoho_item_id]);
    res.json({ success: true, message: 'Item restored to engineer catalogue' });
  } catch (err) {
    console.error('[engineers] admin/hidden-items remove error:', err);
    res.status(500).json({ success: false, message: 'Failed to restore item' });
  }
});

// ───── Admin: engineer custom rates ─────
router.get('/:id/rates', requirePermission('engineers', 'view'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, scope, target_id, zoho_item_id, discount_pct, notes, created_at, updated_at
         FROM engineer_custom_rates
        WHERE engineer_id = ?
        ORDER BY scope ASC, updated_at DESC`,
      [req.params.id]
    );
    // Enrich item-scope rows with product/item names
    const itemIds = rows.filter(r => r.scope === 'item').map(r => r.zoho_item_id).filter(Boolean);
    let nameById = new Map();
    if (itemIds.length) {
      const placeholders = itemIds.map(() => '?').join(',');
      const [items] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, zoho_brand
           FROM zoho_items_map WHERE zoho_item_id IN (${placeholders})`,
        itemIds
      );
      nameById = new Map(items.map(i => [i.zoho_item_id, i]));
    }
    const enriched = rows.map(r => {
      const info = r.scope === 'item' && r.zoho_item_id ? nameById.get(r.zoho_item_id) : null;
      return {
        ...r,
        display_name: r.scope === 'item'
          ? (info ? `${info.zoho_item_name}${info.zoho_brand ? ' · ' + info.zoho_brand : ''}` : r.zoho_item_id)
          : r.target_id
      };
    });
    res.json({ success: true, rates: enriched });
  } catch (err) {
    console.error('[engineers] rates list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load rates' });
  }
});

router.post('/:id/rates', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    const SCOPES = ['item', 'brand', 'category'];
    const scope = SCOPES.includes(req.body.scope) ? req.body.scope : null;
    if (!scope) return res.status(400).json({ success: false, message: "scope must be 'item', 'brand', or 'category'" });

    const target_id = (req.body.target_id || '').toString().trim();
    if (!target_id) return res.status(400).json({ success: false, message: 'target_id is required' });

    const discount_pct = parseFloat(req.body.discount_pct);
    if (Number.isNaN(discount_pct) || discount_pct < 0 || discount_pct > 100) {
      return res.status(400).json({ success: false, message: 'discount_pct must be between 0 and 100' });
    }

    const zoho_item_id = scope === 'item' ? target_id : (req.body.zoho_item_id || null);

    // Verify engineer exists
    const [[eng]] = await pool.query('SELECT id FROM engineers WHERE id = ?', [req.params.id]);
    if (!eng) return res.status(404).json({ success: false, message: 'Engineer not found' });

    await pool.query(
      `INSERT INTO engineer_custom_rates (engineer_id, scope, target_id, zoho_item_id, discount_pct, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE discount_pct = VALUES(discount_pct), notes = VALUES(notes), zoho_item_id = VALUES(zoho_item_id), updated_at = NOW()`,
      [req.params.id, scope, target_id, zoho_item_id, discount_pct, req.body.notes || null, req.user?.id || null]
    );
    res.json({ success: true, message: 'Rate saved' });
  } catch (err) {
    console.error('[engineers] rate save error:', err);
    res.status(500).json({ success: false, message: 'Failed to save rate' });
  }
});

router.delete('/:id/rates/:rateId', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM engineer_custom_rates WHERE id = ? AND engineer_id = ?',
      [req.params.rateId, req.params.id]
    );
    res.json({ success: true, message: 'Rate removed' });
  } catch (err) {
    console.error('[engineers] rate delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove rate' });
  }
});

router.delete('/:id', requirePermission('engineers', 'manage'), async (req, res) => {
  try {
    await pool.query('DELETE FROM engineers WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Engineer deleted' });
  } catch (err) {
    console.error('[engineers] delete error:', err);
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
});

module.exports = { router, setPool, setSessionManager };
