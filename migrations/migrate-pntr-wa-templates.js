require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool } = require('../config/database');
const pool = createPool();

async function migrate() {
    console.log('=== PNTR WhatsApp templates + points rate config ===');
    const kv = [
        ['painter_self_billing_annual_rate', '0.005'],
        ['painter_customer_billing_regular_rate', '0.005'],
        ['painter_customer_billing_annual_rate', '0.005'],
        ['painter_marketing_wa_template',
            '{painter_name} அவர்களே,\nஇது Quality Colours {branch_name}.\nநாங்க புதுசா painter loyalty program start பண்றோம் — billing total-க்கு points கிடைக்கும், withdrawal-உம் பண்ணலாம்.\nவிரிவா பேசணும்-னா: {staff_phone}'],
        ['painter_activation_wa_template',
            'வரவேற்கிறோம் {painter_name}!\nQuality Colours Painter Program-ல உங்களை சேர்த்துக்கொள்கிறோம் 🎨\n\nApp download → OTP login = activation:\n🔗 https://act.qcpaintshop.com/painter-onboard?ref={painter_id}\n\nOTP login பண்ணினா உங்க Dec 2025-ல இருந்து இதுவரை வாங்கின billing-க்கு annual points automatic-ஆ credit ஆகும்.']
    ];
    for (const [k, v] of kv) {
        const [ex] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [k]);
        if (ex.length) {
            console.log('  skip (exists):', k);
        } else {
            await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [k, v]);
            console.log('  added:', k);
        }
    }
    console.log('Done.');
    await pool.end();
}
migrate().catch(err => { console.error(err); process.exit(1); });
