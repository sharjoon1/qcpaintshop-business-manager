/**
 * Staff Task Generator Service
 * Uses Clawdbot to generate personalized daily tasks in Tamil for each staff member.
 * Analyzes: pending leads, overdue followups, branch outstanding, conversion targets.
 */

const aiEngine = require('./ai-engine');
const notificationService = require('./notification-service');

let pool = null;

function setPool(p) { pool = p; }

// ─── Config Helper ─────────────────────────────────────────────

async function getConfig(key) {
    try {
        const [rows] = await pool.query('SELECT config_value FROM ai_config WHERE config_key = ?', [key]);
        return rows[0]?.config_value || null;
    } catch (e) {
        return null;
    }
}

// ─── Gather Staff Context ──────────────────────────────────────

async function gatherStaffContext(userId, branchId) {
    const context = {};

    // 1. Lead stats
    const [leadStats] = await pool.query(`
        SELECT
            COUNT(*) as total_leads,
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
            SUM(CASE WHEN status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as active_leads,
            SUM(CASE WHEN next_followup_date = CURDATE() THEN 1 ELSE 0 END) as followups_today,
            SUM(CASE WHEN next_followup_date < CURDATE() AND status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as overdue_followups,
            SUM(CASE WHEN status = 'won' AND MONTH(converted_at) = MONTH(CURDATE()) THEN 1 ELSE 0 END) as converted_this_month,
            SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as added_today
        FROM leads WHERE assigned_to = ?
    `, [userId]);
    context.leads = leadStats[0];

    // 2. Today's followup leads (names & details)
    const [todayLeads] = await pool.query(`
        SELECT id, name, phone, status, priority, next_followup_date, total_followups, estimated_budget
        FROM leads
        WHERE assigned_to = ? AND next_followup_date = CURDATE() AND status NOT IN ('won','lost','inactive')
        ORDER BY priority DESC LIMIT 10
    `, [userId]);
    context.todayFollowups = todayLeads;

    // 3. Overdue leads
    const [overdueLeads] = await pool.query(`
        SELECT id, name, phone, status, priority, next_followup_date, total_followups,
               DATEDIFF(CURDATE(), next_followup_date) as days_overdue
        FROM leads
        WHERE assigned_to = ? AND next_followup_date < CURDATE() AND status NOT IN ('won','lost','inactive')
        ORDER BY next_followup_date ASC LIMIT 10
    `, [userId]);
    context.overdueLeads = overdueLeads;

    // 4. Branch outstanding customers (top 10)
    if (branchId) {
        const [outstanding] = await pool.query(`
            SELECT zcm.zoho_contact_name as customer_name, zcm.zoho_outstanding as outstanding,
                   COUNT(zi.id) as invoice_count,
                   MIN(zi.due_date) as oldest_due
            FROM zoho_customers_map zcm
            LEFT JOIN zoho_invoices zi ON zi.zoho_customer_id = zcm.zoho_contact_id AND zi.balance > 0
            WHERE zcm.branch_id = ? AND zcm.zoho_outstanding > 0
            GROUP BY zcm.zoho_contact_id
            ORDER BY zcm.zoho_outstanding DESC LIMIT 10
        `, [branchId]);
        context.outstanding = outstanding;
    }

    // 5. Incentive stats this month
    const [incentives] = await pool.query(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as approved_amount,
            SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount
        FROM staff_incentives
        WHERE user_id = ? AND incentive_month = DATE_FORMAT(CURDATE(), '%Y-%m')
    `, [userId]);
    context.incentives = incentives[0];

    return context;
}

// ─── Generate Tamil Tasks via Clawdbot ─────────────────────────

async function generateTamilTasks(staffName, context) {
    const prompt = `நீ Quality Colours நிறுவனத்தின் AI மேலாளர். இன்றைய தேதி: ${new Date().toLocaleDateString('ta-IN')}.

${staffName} என்ற ஊழியருக்கு இன்றைய வேலைகளை தமிழில் உருவாக்கு.

இவருடைய தற்போதைய நிலை:
- மொத்த leads: ${context.leads.total_leads}, புதியவை: ${context.leads.new_leads}, active: ${context.leads.active_leads}
- இன்று follow-up செய்ய வேண்டியவை: ${context.leads.followups_today}
- காலாவதியான follow-ups: ${context.leads.overdue_followups}
- இந்த மாதம் convert செய்தவை: ${context.leads.converted_this_month}
- இன்று add செய்தவை: ${context.leads.added_today}

${context.todayFollowups.length > 0 ? `இன்று follow-up செய்ய வேண்டிய leads:\n${context.todayFollowups.map(l => `- ${l.name} (${l.phone}) - Status: ${l.status}, Priority: ${l.priority}, Budget: ₹${l.estimated_budget || 0}`).join('\n')}` : 'இன்று follow-up leads இல்லை.'}

${context.overdueLeads.length > 0 ? `காலாவதியான leads (உடனடியாக செய்ய வேண்டும்):\n${context.overdueLeads.map(l => `- ${l.name} (${l.phone}) - ${l.days_overdue} நாள் தாமதம், Status: ${l.status}`).join('\n')}` : ''}

${context.outstanding?.length > 0 ? `Branch outstanding customers:\n${context.outstanding.map(c => `- ${c.customer_name}: ₹${Number(c.outstanding).toLocaleString('en-IN')} outstanding, ${c.invoice_count} invoices`).join('\n')}` : ''}

Incentive நிலை: Approved ₹${context.incentives.approved_amount || 0}, Pending ₹${context.incentives.pending_amount || 0}

கீழே உள்ள JSON format-ல் 5-8 tasks உருவாக்கு. ஒவ்வொரு task-க்கும் specific names மற்றும் phone numbers கொடு (data-வில் இருந்து). Abstract ஆக எழுதாதே.

JSON format (ONLY return valid JSON, no other text):
{
  "summary": "இன்றைய summary (2-3 lines in Tamil)",
  "tasks": [
    {
      "title": "Task title in Tamil",
      "description": "Detailed description in Tamil with specific lead/customer names",
      "category": "lead_followup|lead_add|outstanding_followup|conversion|general",
      "priority": "high|medium|low"
    }
  ],
  "motivation": "Motivational message in Tamil (1 line)"
}`;

    try {
        const result = await aiEngine.generate(prompt, {
            maxTokens: 2048,
            temperature: 0.6,
            systemPrompt: 'You are a Tamil-speaking AI business manager for a paint retail company. Always respond in Tamil. Return ONLY valid JSON.'
        });

        // Parse JSON from response
        const text = result.text || result;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('No valid JSON in response');
    } catch (e) {
        console.error('[StaffTaskGen] Clawdbot generation failed:', e.message);
        // Return fallback tasks in Tamil
        return generateFallbackTasks(context);
    }
}

// ─── Fallback Tasks (no AI needed) ─────────────────────────────

function generateFallbackTasks(context) {
    const tasks = [];

    // Overdue followups - highest priority
    if (context.overdueLeads.length > 0) {
        for (const lead of context.overdueLeads.slice(0, 3)) {
            tasks.push({
                title: `${lead.name} - காலாவதியான follow-up`,
                description: `${lead.name} (${lead.phone}) - ${lead.days_overdue} நாள் தாமதம். உடனடியாக தொடர்பு கொள்ளவும்.`,
                category: 'lead_followup',
                priority: 'high'
            });
        }
    }

    // Today's followups
    if (context.todayFollowups.length > 0) {
        for (const lead of context.todayFollowups.slice(0, 3)) {
            tasks.push({
                title: `${lead.name} - இன்றைய follow-up`,
                description: `${lead.name} (${lead.phone}) உடன் பேசவும். Status: ${lead.status}, Budget: ₹${lead.estimated_budget || 0}`,
                category: 'lead_followup',
                priority: 'medium'
            });
        }
    }

    // Add new lead if less than 2 today
    if ((context.leads.added_today || 0) < 2) {
        tasks.push({
            title: 'புதிய lead சேர்க்கவும்',
            description: 'இன்று குறைந்தது 2 புதிய leads சேர்க்க வேண்டும். Walk-in, phone call அல்லது referral மூலம் leads கொண்டு வரவும்.',
            category: 'lead_add',
            priority: 'medium'
        });
    }

    // Outstanding followup
    if (context.outstanding?.length > 0) {
        const top = context.outstanding[0];
        tasks.push({
            title: `${top.customer_name} - Outstanding follow-up`,
            description: `${top.customer_name} - ₹${Number(top.outstanding).toLocaleString('en-IN')} outstanding உள்ளது. Payment குறித்து தொடர்பு கொள்ளவும்.`,
            category: 'outstanding_followup',
            priority: 'high'
        });
    }

    // General daily task
    tasks.push({
        title: 'Daily report update',
        description: 'இன்றைய அனைத்து activities-ஐ app-ல் update செய்யவும். Follow-up notes, lead status மாற்றங்கள் எல்லாம் பதிவு செய்யவும்.',
        category: 'general',
        priority: 'low'
    });

    return {
        summary: `இன்று ${context.leads.followups_today || 0} follow-ups, ${context.leads.overdue_followups || 0} overdue leads உள்ளன. ${context.outstanding?.length || 0} customers-க்கு outstanding உள்ளது.`,
        tasks,
        motivation: 'ஒவ்வொரு நாளும் ஒரு புதிய வாய்ப்பு. உங்கள் முழு முயற்சியை செலுத்துங்கள்!'
    };
}

// ─── Generate for Single Staff ─────────────────────────────────

async function generateForStaff(userId) {
    const [users] = await pool.query(
        'SELECT id, full_name, branch_id, role FROM users WHERE id = ? AND status = ?',
        [userId, 'active']
    );
    if (users.length === 0) return null;

    const user = users[0];
    const context = await gatherStaffContext(userId, user.branch_id);
    const result = await generateTamilTasks(user.full_name, context);

    const tasks = (result.tasks || []).map(t => ({ ...t, completed: false }));

    // Upsert into DB
    await pool.query(`
        INSERT INTO staff_daily_ai_tasks (user_id, task_date, tasks_json, summary, lead_context, total_count)
        VALUES (?, CURDATE(), ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            tasks_json = VALUES(tasks_json),
            summary = VALUES(summary),
            lead_context = VALUES(lead_context),
            total_count = VALUES(total_count),
            completed_count = 0,
            generated_at = CURRENT_TIMESTAMP
    `, [userId, JSON.stringify(tasks), result.summary || '', JSON.stringify(context), tasks.length]);

    // Send notification
    try {
        await notificationService.send(userId, {
            type: 'daily_tasks',
            title: 'இன்றைய வேலைகள் தயார்!',
            body: result.summary || `${tasks.length} tasks உங்களுக்காக உருவாக்கப்பட்டுள்ளன`,
            data: { page: 'staff-daily-work' }
        });
    } catch (e) {
        console.error(`[StaffTaskGen] Notification failed for user ${userId}:`, e.message);
    }

    return { userId, tasks, summary: result.summary, motivation: result.motivation };
}

// ─── Generate for All Active Staff ─────────────────────────────

async function generateForAllStaff() {
    const enabled = await getConfig('staff_daily_tasks_enabled');
    if (enabled !== '1') {
        console.log('[StaffTaskGen] Staff daily tasks disabled');
        return;
    }

    console.log('[StaffTaskGen] Generating daily tasks for all staff...');

    const [staff] = await pool.query(`
        SELECT id, full_name, branch_id FROM users
        WHERE status = 'active' AND role NOT IN ('super_admin')
        ORDER BY branch_id, full_name
    `);

    let generated = 0;
    let failed = 0;

    for (const user of staff) {
        try {
            await generateForStaff(user.id);
            generated++;
            // Small delay between AI calls to avoid overwhelming Clawdbot
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error(`[StaffTaskGen] Failed for ${user.full_name} (${user.id}):`, e.message);
            failed++;
        }
    }

    console.log(`[StaffTaskGen] Done: ${generated} generated, ${failed} failed out of ${staff.length} staff`);
    return { generated, failed, total: staff.length };
}

// ─── Get Today's Tasks for Staff ───────────────────────────────

async function getTodayTasks(userId) {
    const [rows] = await pool.query(
        'SELECT * FROM staff_daily_ai_tasks WHERE user_id = ? AND task_date = CURDATE()',
        [userId]
    );
    return rows[0] || null;
}

// ─── Mark Task Complete ────────────────────────────────────────

async function markTaskComplete(userId, taskIndex) {
    const [rows] = await pool.query(
        'SELECT id, tasks_json, completed_count FROM staff_daily_ai_tasks WHERE user_id = ? AND task_date = CURDATE()',
        [userId]
    );
    if (rows.length === 0) return null;

    const record = rows[0];
    const tasks = JSON.parse(record.tasks_json);

    if (taskIndex < 0 || taskIndex >= tasks.length) return null;

    tasks[taskIndex].completed = !tasks[taskIndex].completed;
    const completedCount = tasks.filter(t => t.completed).length;

    await pool.query(
        'UPDATE staff_daily_ai_tasks SET tasks_json = ?, completed_count = ? WHERE id = ?',
        [JSON.stringify(tasks), completedCount, record.id]
    );

    return { tasks, completedCount };
}

module.exports = {
    setPool,
    generateForStaff,
    generateForAllStaff,
    getTodayTasks,
    markTaskComplete
};
